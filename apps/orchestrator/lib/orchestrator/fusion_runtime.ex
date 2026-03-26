defmodule Orchestrator.FusionRuntime do
  @moduledoc false

  alias Orchestrator.Packet

  @default_window_ms 5_000
  @default_rule %{
    "left_label" => "clockwise",
    "right_label" => "active",
    "output_label" => "music_control",
    "confidence" => 0.95
  }

  def process_packet(graph, packet, infer_fun) when is_function(infer_fun, 1) do
    graph
    |> Packet.route_targets(packet)
    |> Enum.reduce_while({:ok, graph, []}, fn route_target, {:ok, current_graph, emitted_packets} ->
      case fusion_node(current_graph, route_target["node_id"]) do
        {:ok, _node} ->
          case process_fusion_target(current_graph, route_target, packet, infer_fun) do
            {:ok, updated_graph, nil} ->
              {:cont, {:ok, updated_graph, emitted_packets}}

            {:ok, updated_graph, emitted_packet} ->
              {:cont, {:ok, updated_graph, emitted_packets ++ [emitted_packet]}}

            {:error, error} ->
              {:halt, {:error, error}}
          end

        {:error, _error} ->
          {:cont, {:ok, current_graph, emitted_packets}}
      end
    end)
  end

  defp process_fusion_target(graph, route_target, packet, infer_fun) do
    with {:ok, input} <- normalize_input(packet),
         {:ok, updated_graph} <- remember_input(graph, route_target["node_id"], route_target["target_port"], input) do
      evaluate_fusion(updated_graph, route_target["node_id"], infer_fun)
    end
  end

  defp normalize_input(%{"schema" => "label/string", "payload" => %{"label" => label} = payload} = packet)
       when is_binary(label) and label != "" do
    {:ok,
     %{
       "packet_id" => packet["packet_id"],
       "timestamp" => packet["timestamp"],
       "label" => label,
       "confidence" => normalize_confidence(payload["confidence"]),
       "source_node_id" => packet["node_id"]
     }}
  end

  defp normalize_input(_packet), do: {:error, err("invalid_payload", "Fusion nodes require label/string packets", %{})}

  defp remember_input(graph, node_id, port, input) do
    update_fusion(graph, node_id, fn node ->
      fusion =
        fusion_config(node)
        |> Map.update("latest_inputs", %{}, &Map.put(&1, port, input))

      {:ok,
       node
       |> put_fusion_config(fusion)
       |> Map.put("status", "waiting")}
    end)
  end

  defp evaluate_fusion(graph, node_id, infer_fun) do
    with {:ok, node} <- fusion_node(graph, node_id) do
      fusion = fusion_config(node)
      left = get_in(fusion, ["latest_inputs", "left"])
      right = get_in(fusion, ["latest_inputs", "right"])

      cond do
        is_nil(left) or is_nil(right) ->
          awaiting_ports =
            [{"left", left}, {"right", right}]
            |> Enum.filter(fn {_port, input} -> is_nil(input) end)
            |> Enum.map_join(", ", fn {port, _input} -> port end)

          diagnostic = err("awaiting_inputs", "Waiting for fusion input on #{awaiting_ports}", %{})
          {:ok, set_diagnostic(graph, node_id, diagnostic), nil}

        not within_window?(left["timestamp"], right["timestamp"], fusion["window_ms"] || @default_window_ms) ->
          diagnostic =
            err(
              "fusion_timeout",
              "Fusion inputs arrived outside the configured window",
              %{"window_ms" => fusion["window_ms"] || @default_window_ms}
            )

          {:ok, set_diagnostic(graph, node_id, diagnostic), nil}

        fusion["last_combination_id"] == combination_id(left, right) ->
          {:ok, graph, nil}

        true ->
          case infer_fun.(fusion_request(graph, node_id, fusion, left, right)) do
            {:ok, %{"matched" => true, "label" => label, "confidence" => confidence} = response} ->
              emitted_packet = %{
                "packet_id" => emitted_packet_id(node_id, left, right),
                "project_id" => get_in(graph, ["project", "id"]),
                "node_id" => node_id,
                "timestamp" => DateTime.utc_now() |> DateTime.truncate(:millisecond) |> DateTime.to_iso8601(),
                "schema" => "label/string",
                "payload" => %{
                  "label" => label,
                  "confidence" => confidence
                }
              }

              {:ok, mark_success(graph, node_id, left, right, response), emitted_packet}

            {:ok, %{"matched" => false} = response} ->
              diagnostic =
                err(
                  "fusion_no_match",
                  "Fusion inputs did not match any configured rule",
                  %{"reason" => response["reason"] || "no_rule_match"}
                )

              {:ok, set_diagnostic(graph, node_id, diagnostic), nil}

            {:error, error} ->
              {:ok, set_failure(graph, node_id, error), nil}
          end
      end
    end
  end

  defp mark_success(graph, node_id, left, right, response) do
    {:ok, updated_graph} =
      update_fusion(graph, node_id, fn node ->
        fusion =
          fusion_config(node)
          |> Map.put("last_output", %{
            "label" => response["label"],
            "confidence" => response["confidence"],
            "timestamp" => timestamp_now(),
            "inputs" => response["inputs"] || []
          })
          |> Map.put("last_error", nil)
          |> Map.put("last_combination_id", combination_id(left, right))

        {:ok,
         node
         |> put_fusion_config(fusion)
         |> Map.put("status", "ready")}
      end)

    updated_graph
  end

  defp set_diagnostic(graph, node_id, diagnostic) do
    {:ok, updated_graph} =
      update_fusion(graph, node_id, fn node ->
        fusion =
          fusion_config(node)
          |> Map.put("last_error", diagnostic)

        {:ok,
         node
         |> put_fusion_config(fusion)
         |> Map.put("status", "waiting")}
      end)

    updated_graph
  end

  defp set_failure(graph, node_id, error) do
    {:ok, updated_graph} =
      update_fusion(graph, node_id, fn node ->
        fusion =
          fusion_config(node)
          |> Map.put("last_error", normalize_error(error))

        {:ok,
         node
         |> put_fusion_config(fusion)
         |> Map.put("status", "error")}
      end)

    updated_graph
  end

  defp fusion_request(graph, node_id, fusion, left, right) do
    %{
      "project_id" => get_in(graph, ["project", "id"]),
      "node_id" => node_id,
      "inputs" => %{
        "left" => left,
        "right" => right
      },
      "config" => %{
        "window_ms" => fusion["window_ms"] || @default_window_ms,
        "rules" => fusion["rules"] || [@default_rule]
      }
    }
  end

  defp update_fusion(graph, node_id, fun) do
    case fusion_node(graph, node_id) do
      {:ok, _node} ->
        update_fusion!(graph, node_id, fun)

      {:error, error} ->
        {:error, error}
    end
  end

  defp update_fusion!(graph, node_id, fun) do
    case Enum.reduce_while(Map.get(graph, "nodes", []), {:ok, []}, fn node, {:ok, acc} ->
           if node["id"] == node_id do
             case fun.(node) do
               {:ok, updated_node} -> {:cont, {:ok, [updated_node | acc]}}
               {:error, error} -> {:halt, {:error, error}}
             end
           else
             {:cont, {:ok, [node | acc]}}
           end
         end) do
      {:ok, nodes} ->
        {:ok, %{graph | "nodes" => Enum.reverse(nodes)}}

      {:error, error} ->
        {:error, error}
    end
  end

  defp fusion_node(graph, node_id) do
    case Enum.find(Map.get(graph, "nodes", []), &(&1["id"] == node_id)) do
      %{"type" => "Modifier.Fusion"} = node -> {:ok, node}
      nil -> {:error, err("node_not_found", "Fusion node not found", %{id: node_id})}
      _ -> {:error, err("invalid_payload", "Target node is not a fusion node", %{id: node_id})}
    end
  end

  defp fusion_config(node) do
    node
    |> Map.get("configuration", %{})
    |> Map.get("fusion", %{
      "window_ms" => @default_window_ms,
      "rules" => [@default_rule],
      "latest_inputs" => %{},
      "last_output" => nil,
      "last_error" => nil,
      "last_combination_id" => nil
    })
  end

  defp put_fusion_config(node, fusion) do
    Map.put(node, "configuration", Map.put(node["configuration"] || %{}, "fusion", fusion))
  end

  defp combination_id(left, right), do: Enum.join([left["packet_id"], right["packet_id"]], "|")

  defp emitted_packet_id(node_id, left, right) do
    Enum.join(["pkt_fusion", node_id, left["packet_id"], right["packet_id"]], ":")
  end

  defp normalize_confidence(confidence) when is_number(confidence), do: confidence
  defp normalize_confidence(_confidence), do: nil

  defp within_window?(left_ts, right_ts, window_ms) do
    with {:ok, left_dt, _offset} <- DateTime.from_iso8601(left_ts),
         {:ok, right_dt, _offset} <- DateTime.from_iso8601(right_ts) do
      abs(DateTime.diff(left_dt, right_dt, :millisecond)) <= window_ms
    else
      _ -> false
    end
  end

  defp normalize_error(%{code: _code, message: _message, details: _details} = error), do: error

  defp normalize_error(%{"code" => _code, "message" => _message, "details" => _details} = error),
    do: error

  defp normalize_error(error) do
    err("fusion_error", "Fusion inference failed", %{"reason" => inspect(error)})
  end

  defp timestamp_now do
    DateTime.utc_now()
    |> DateTime.truncate(:millisecond)
    |> DateTime.to_iso8601()
  end

  defp err(code, message, details) do
    %{code: code, message: message, details: stringify_details(details)}
  end

  defp stringify_details(details) when is_map(details) do
    details
    |> Enum.map(fn {k, v} -> {to_string(k), v} end)
    |> Map.new()
  end
end
