defmodule Orchestrator.ClassifierRuntime do
  @moduledoc false

  alias Orchestrator.Packet

  @default_window_size 8
  @default_epochs 20

  def record_start(graph, node_id, label) when is_binary(label) and label != "" do
    update_classifier(graph, node_id, fn node ->
      configuration =
        node
        |> classifier_config()
        |> Map.put("recording_label", label)
        |> Map.put("recording_samples", [])

      {:ok,
       node
       |> Map.put("configuration", Map.put(node["configuration"] || %{}, "classifier", configuration))
       |> Map.put("status", "recording")}
    end)
  end

  def record_start(_graph, _node_id, _label),
    do: {:error, err("invalid_payload", "recording label is required", %{})}

  def record_stop(graph, node_id) do
    update_classifier(graph, node_id, fn node ->
      configuration = classifier_config(node)
      recording_label = configuration["recording_label"]
      recording_samples = configuration["recording_samples"] || []
      dataset = configuration["dataset"] || %{"labels" => [], "samples" => []}

      dataset =
        dataset
        |> Map.update("labels", [recording_label], fn labels -> Enum.uniq(labels ++ [recording_label]) end)
        |> Map.update("samples", [%{"label" => recording_label, "vectors" => recording_samples}], fn samples ->
          samples ++ [%{"label" => recording_label, "vectors" => recording_samples}]
        end)

      configuration =
        configuration
        |> Map.put("dataset", dataset)
        |> Map.delete("recording_label")
        |> Map.delete("recording_samples")

      {:ok,
       node
       |> Map.put("configuration", Map.put(node["configuration"] || %{}, "classifier", configuration))
       |> Map.put("status", "idle")}
    end)
  end

  def training_request(graph, node_id, attrs \\ %{}) do
    with {:ok, node} <- classifier_node(graph, node_id) do
      configuration = classifier_config(node)
      dataset = configuration["dataset"] || %{"labels" => [], "samples" => []}
      labels = dataset["labels"] || []
      samples = dataset["samples"] || []

      cond do
        length(labels) == 0 ->
          {:error, err("invalid_payload", "Classifier dataset must contain at least one label", %{})}

        length(samples) == 0 ->
          {:error, err("invalid_payload", "Classifier dataset must contain samples", %{})}

        true ->
          train_config = %{
            "window_size" => attrs["window_size"] || configuration["window_size"] || @default_window_size,
            "epochs" => attrs["epochs"] || configuration["epochs"] || @default_epochs
          }

          {:ok,
           %{
             "project_id" => get_in(graph, ["project", "id"]),
             "node_id" => node_id,
             "dataset" => dataset,
             "config" => train_config
           }}
      end
    end
  end

  def training_started(graph, node_id, job_id, train_config) do
    update_classifier(graph, node_id, fn node ->
      configuration =
        classifier_config(node)
        |> Map.put("training_job_id", job_id)
        |> Map.put("window_size", train_config["window_size"])
        |> Map.put("epochs", train_config["epochs"])

      {:ok,
       node
       |> Map.put("configuration", Map.put(node["configuration"] || %{}, "classifier", configuration))
       |> Map.put("status", "training")}
    end)
  end

  def training_completed(graph, node_id, result) do
    update_classifier(graph, node_id, fn node ->
      configuration =
        classifier_config(node)
        |> Map.put("model_id", result["model_id"])
        |> Map.put("labels", result["labels"] || [])
        |> Map.put("window_size", result["window_size"] || classifier_config(node)["window_size"] || @default_window_size)
        |> Map.put("inference_window", [])
        |> Map.delete("training_job_id")

      {:ok,
       node
       |> Map.put("configuration", Map.put(node["configuration"] || %{}, "classifier", configuration))
       |> Map.put("status", "inferencing")}
    end)
  end

  def training_failed(graph, node_id, reason) do
    update_classifier(graph, node_id, fn node ->
      configuration =
        classifier_config(node)
        |> Map.delete("training_job_id")
        |> Map.put("last_error", reason)

      {:ok,
       node
       |> Map.put("configuration", Map.put(node["configuration"] || %{}, "classifier", configuration))
       |> Map.put("status", "error")}
    end)
  end

  def inference_start(graph, node_id) do
    update_classifier(graph, node_id, fn node ->
      configuration = classifier_config(node)

      cond do
        not is_binary(configuration["model_id"]) ->
          {:error, err("invalid_payload", "Classifier requires a trained model before live inference", %{})}

        true ->
          {:ok,
           node
           |> Map.put("configuration", Map.put(node["configuration"] || %{}, "classifier", configuration))
           |> Map.put("status", "inferencing")}
      end
    end)
  end

  def inference_stop(graph, node_id) do
    update_classifier(graph, node_id, fn node ->
      {:ok, Map.put(node, "status", "idle")}
    end)
  end

  def process_packet(graph, packet, infer_fun) when is_function(infer_fun, 1) do
    route_targets = Packet.route_targets(graph, packet)

    Enum.reduce_while(route_targets, {:ok, graph, []}, fn route_target, {:ok, current_graph, emitted_packets} ->
      case classifier_node(current_graph, route_target["node_id"]) do
        {:ok, node} ->
          case classifier_status(node) do
            "recording" ->
              case append_recording_sample(current_graph, node["id"], packet["payload"]) do
                {:ok, updated_graph} -> {:cont, {:ok, updated_graph, emitted_packets}}
                {:error, error} -> {:halt, {:error, error}}
              end

            "inferencing" ->
              case run_inference(current_graph, node["id"], packet, infer_fun) do
                {:ok, updated_graph, nil} -> {:cont, {:ok, updated_graph, emitted_packets}}
                {:ok, updated_graph, emitted_packet} -> {:cont, {:ok, updated_graph, emitted_packets ++ [emitted_packet]}}
                {:error, error} -> {:halt, {:error, error}}
              end

            _ ->
              {:cont, {:ok, current_graph, emitted_packets}}
          end

        {:error, _} ->
          {:cont, {:ok, current_graph, emitted_packets}}
      end
    end)
  end

  def dataset_summary(node) do
    configuration = classifier_config(node)
    dataset = configuration["dataset"] || %{"labels" => [], "samples" => []}

    %{
      "labels" => dataset["labels"] || [],
      "sample_count" => length(dataset["samples"] || []),
      "model_id" => configuration["model_id"],
      "window_size" => configuration["window_size"] || @default_window_size
    }
  end

  defp append_recording_sample(graph, node_id, payload) do
    update_classifier(graph, node_id, fn node ->
      configuration = classifier_config(node)
      recording_samples = configuration["recording_samples"] || []

      configuration =
        configuration
        |> Map.put("recording_samples", recording_samples ++ [payload])

      {:ok,
       node
       |> Map.put("configuration", Map.put(node["configuration"] || %{}, "classifier", configuration))
       |> Map.put("status", "recording")}
    end)
  end

  defp run_inference(graph, node_id, packet, infer_fun) do
    with {:ok, node} <- classifier_node(graph, node_id) do
      configuration = classifier_config(node)
      model_id = configuration["model_id"]
      window_size = configuration["window_size"] || @default_window_size
      inference_window = (configuration["inference_window"] || []) ++ [packet["payload"]]
      inference_window = Enum.take(inference_window, -window_size)

      updated_configuration = Map.put(configuration, "inference_window", inference_window)

      {:ok, updated_graph} =
        update_classifier(graph, node_id, fn classifier_node ->
          {:ok,
           classifier_node
           |> Map.put("configuration", Map.put(classifier_node["configuration"] || %{}, "classifier", updated_configuration))
           |> Map.put("status", "inferencing")}
        end)

      if length(inference_window) < window_size or not is_binary(model_id) do
        {:ok, updated_graph, nil}
      else
        case infer_fun.(%{
               "project_id" => packet["project_id"],
               "node_id" => node_id,
               "model_id" => model_id,
               "vector_window" => inference_window
             }) do
          {:ok, %{"label" => label, "confidence" => confidence}} ->
            emitted_packet = %{
              "packet_id" => emitted_packet_id(packet, node_id),
              "project_id" => packet["project_id"],
              "node_id" => node_id,
              "timestamp" => DateTime.utc_now() |> DateTime.truncate(:millisecond) |> DateTime.to_iso8601(),
              "schema" => "label/string",
              "payload" => %{"label" => label, "confidence" => confidence}
            }

            {:ok, updated_graph, emitted_packet}

          {:error, error} ->
            case training_failed(updated_graph, node_id, error["message"] || "Inference failed") do
              {:ok, failed_graph} -> {:ok, failed_graph, nil}
              {:error, runtime_error} -> {:error, runtime_error}
            end
        end
      end
    end
  end

  defp update_classifier(graph, node_id, fun) do
    case classifier_node(graph, node_id) do
      {:ok, _node} ->
        update_classifier!(graph, node_id, fun)

      {:error, error} ->
        {:error, error}
    end
  end

  defp update_classifier!(graph, node_id, fun) do
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

  defp classifier_node(graph, node_id) do
    case Enum.find(Map.get(graph, "nodes", []), &(&1["id"] == node_id)) do
      %{"type" => "Modifier.Classifier"} = node -> {:ok, node}
      nil -> {:error, err("node_not_found", "Classifier node not found", %{id: node_id})}
      _ -> {:error, err("invalid_payload", "Target node is not a classifier", %{id: node_id})}
    end
  end

  defp classifier_status(node), do: node["status"] || "idle"

  defp emitted_packet_id(packet, node_id) do
    ["pkt_classifier", node_id, packet["packet_id"]]
    |> Enum.join(":")
  end

  defp classifier_config(node) do
    node
    |> Map.get("configuration", %{})
    |> Map.get("classifier", %{
      "dataset" => %{"labels" => [], "samples" => []},
      "window_size" => @default_window_size,
      "epochs" => @default_epochs
    })
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
