defmodule Orchestrator.ConsumerRuntime do
  @moduledoc false

  alias Orchestrator.Packet

  @history_limit 10
  @processed_packet_limit 25

  def sync_spotify_auth(graph, node_id, auth_response) when is_map(auth_response) do
    update_consumer(graph, node_id, fn node ->
      spotify = spotify_config(node)

      updated_spotify =
        spotify
        |> Map.put("auth", normalize_auth(auth_response))
        |> Map.put("last_error", nil)

      {:ok,
       node
       |> Map.put("configuration", Map.put(node["configuration"] || %{}, "spotify", updated_spotify))
       |> Map.put("status", spotify_status_from_auth(auth_response))}
    end)
  end

  def sync_spotify_error(graph, node_id, error) do
    update_consumer(graph, node_id, fn node ->
      spotify = spotify_config(node)
      normalized_error = normalize_error(error)
      entry = %{
        "packet_id" => nil,
        "timestamp" => timestamp_now(),
        "label" => nil,
        "action" => nil,
        "status" => "error",
        "message" => normalized_error["message"],
        "error" => normalized_error
      }

      updated_spotify =
        spotify
        |> Map.put("last_action", entry)
        |> Map.put("last_error", normalized_error)
        |> prepend_history(entry)

      {:ok,
       node
       |> Map.put("configuration", Map.put(node["configuration"] || %{}, "spotify", updated_spotify))
       |> Map.put("status", "error")}
    end)
  end

  def process_packet(graph, packet, spotify_action_fun) when is_function(spotify_action_fun, 1) do
    graph
    |> Packet.route_targets(packet)
    |> Enum.reduce_while({:ok, graph}, fn route_target, {:ok, current_graph} ->
      case consumer_node(current_graph, route_target["node_id"]) do
        {:ok, %{"type" => "Consumer.Spotify"} = node} ->
          case handle_spotify_packet(current_graph, node, packet, spotify_action_fun) do
            {:ok, updated_graph} -> {:cont, {:ok, updated_graph}}
            {:error, error} -> {:halt, {:error, error}}
          end

        {:ok, _node} ->
          {:cont, {:ok, current_graph}}

        {:error, _error} ->
          {:cont, {:ok, current_graph}}
      end
    end)
  end

  defp handle_spotify_packet(graph, node, packet, spotify_action_fun) do
    spotify = spotify_config(node)
    packet_id = packet["packet_id"]
    label = get_in(packet, ["payload", "label"])
    action = spotify_action(spotify, label)

    cond do
      packet_processed?(spotify, packet_id) ->
        {:ok, graph}

      not is_binary(label) or label == "" ->
        {:ok, mark_spotify_failure(graph, node["id"], packet, action, invalid_label_error())}

      not is_binary(action) or action == "" ->
        {:ok, mark_spotify_failure(graph, node["id"], packet, nil, unconfigured_error(label))}

      true ->
        request = %{
          "project_id" => packet["project_id"],
          "node_id" => node["id"],
          "action" => action,
          "idempotency_key" => packet_id
        }

        case spotify_action_fun.(request) do
          {:ok, response} when is_map(response) ->
            mark_spotify_success(graph, node["id"], packet, action, response)

          {:error, error} ->
            {:ok, mark_spotify_failure(graph, node["id"], packet, action, normalize_error(error))}
        end
    end
  end

  defp mark_spotify_success(graph, node_id, packet, action, response) do
    update_consumer(graph, node_id, fn node ->
      spotify = spotify_config(node)

      entry = %{
        "packet_id" => packet["packet_id"],
        "timestamp" => timestamp_now(),
        "label" => get_in(packet, ["payload", "label"]),
        "action" => action,
        "status" => Map.get(response, "status", "ok"),
        "message" => success_message(action, response),
        "response" => response
      }

      updated_spotify =
        spotify
        |> Map.put("last_action", entry)
        |> Map.put("last_error", nil)
        |> remember_packet(packet["packet_id"])
        |> prepend_history(entry)

      {:ok,
       node
       |> Map.put("configuration", Map.put(node["configuration"] || %{}, "spotify", updated_spotify))
       |> Map.put("status", "triggered")}
    end)
  end

  defp mark_spotify_failure(graph, node_id, packet, action, error) do
    {:ok, updated_graph} =
      update_consumer(graph, node_id, fn node ->
        spotify = spotify_config(node)

        entry = %{
          "packet_id" => packet["packet_id"],
          "timestamp" => timestamp_now(),
          "label" => get_in(packet, ["payload", "label"]),
          "action" => action,
          "status" => "error",
          "message" => error["message"],
          "error" => error
        }

        updated_spotify =
          spotify
          |> Map.put("last_action", entry)
          |> Map.put("last_error", error)
          |> prepend_history(entry)

        {:ok,
         node
         |> Map.put("configuration", Map.put(node["configuration"] || %{}, "spotify", updated_spotify))
         |> Map.put("status", "error")}
      end)

    updated_graph
  end

  defp spotify_action(spotify, label) do
    label_actions = Map.get(spotify, "label_actions", %{})

    case Map.get(label_actions, label) do
      action when is_binary(action) and action != "" -> action
      _ -> Map.get(spotify, "action")
    end
  end

  defp packet_processed?(spotify, packet_id) do
    spotify
    |> Map.get("processed_packet_ids", [])
    |> Enum.member?(packet_id)
  end

  defp remember_packet(spotify, packet_id) do
    processed =
      spotify
      |> Map.get("processed_packet_ids", [])
      |> Kernel.++([packet_id])
      |> Enum.take(-@processed_packet_limit)

    Map.put(spotify, "processed_packet_ids", processed)
  end

  defp prepend_history(spotify, entry) do
    history =
      spotify
      |> Map.get("history", [])
      |> List.wrap()
      |> then(&[entry | &1])
      |> Enum.take(@history_limit)

    Map.put(spotify, "history", history)
  end

  defp update_consumer(graph, node_id, fun) do
    case consumer_node(graph, node_id) do
      {:ok, _node} ->
        update_consumer!(graph, node_id, fun)

      {:error, error} ->
        {:error, error}
    end
  end

  defp update_consumer!(graph, node_id, fun) do
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

  defp consumer_node(graph, node_id) do
    case Enum.find(Map.get(graph, "nodes", []), &(&1["id"] == node_id)) do
      %{"type" => "Consumer." <> _} = node -> {:ok, node}
      nil -> {:error, err("node_not_found", "Consumer node not found", %{id: node_id})}
      _ -> {:error, err("invalid_payload", "Target node is not a consumer", %{id: node_id})}
    end
  end

  defp spotify_config(node) do
    node
    |> Map.get("configuration", %{})
    |> Map.get("spotify", %{
      "action" => nil,
      "label_actions" => %{},
      "auth" => %{"status" => "unknown"},
      "last_action" => nil,
      "last_error" => nil,
      "history" => [],
      "processed_packet_ids" => []
    })
  end

  defp normalize_auth(response) do
    %{
      "provider" => response["provider"],
      "project_id" => response["project_id"],
      "status" => response["status"] || "unknown",
      "mode" => response["mode"],
      "available_actions" => response["available_actions"] || [],
      "authorization_url" => response["authorization_url"],
      "state" => response["state"],
      "connection" => response["connection"] || %{"connected" => false}
    }
  end

  defp spotify_status_from_auth(%{"status" => "connected"}), do: "idle"
  defp spotify_status_from_auth(%{"status" => "authorization_required"}), do: "idle"
  defp spotify_status_from_auth(_response), do: "idle"

  defp success_message(action, response) do
    result = response["result"] || %{}
    playback = result["playback"] || %{}

    case action do
      "next_track" -> "Triggered next track"
      "previous_track" -> "Triggered previous track"
      "play_pause" -> "Playback is now " <> if(playback["is_playing"], do: "playing", else: "paused")
      _ -> "Spotify action succeeded"
    end
  end

  defp invalid_label_error do
    err("invalid_payload", "Spotify consumer requires a label/string packet", %{})
  end

  defp unconfigured_error(label) do
    err("consumer_unconfigured", "Spotify consumer has no configured action for label", %{label: label})
  end

  defp normalize_error(%{code: _code, message: _message, details: _details} = error), do: error

  defp normalize_error(%{"code" => _code, "message" => _message, "details" => _details} = error),
    do: error

  defp normalize_error(error) do
    err("consumer_error", "Spotify consumer action failed", %{reason: inspect(error)})
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
