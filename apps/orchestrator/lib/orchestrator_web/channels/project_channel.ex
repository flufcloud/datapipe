defmodule OrchestratorWeb.ProjectChannel do
  use Phoenix.Channel

  alias Orchestrator.Graph
  alias Orchestrator.Packet
  alias Orchestrator.GraphStore
  alias OrchestratorWeb.ChannelEnvelope

  @impl true
  def join("project:" <> project_id, _params, socket) when byte_size(project_id) > 0 do
    Phoenix.PubSub.subscribe(Orchestrator.PubSub, "graph-updates:#{project_id}")

    socket =
      socket
      |> assign(:project_id, project_id)
      |> assign(:topic_project_id, project_id)

    send(self(), :push_initial_graph)
    {:ok, socket}
  end

  def join(_topic, _params, _socket), do: {:error, %{reason: "invalid_topic"}}

  @impl true
  def handle_in("graph:init", message, socket) do
    with {:ok, request_id, project_id, _payload} <- normalize_message("graph:init", message, socket) do
      graph = GraphStore.get_or_init(project_id)

      push(
        socket,
        "graph:updated",
        ChannelEnvelope.success("graph:updated", request_id, project_id, %{"graph" => graph})
      )

      {:noreply, socket}
    else
      {:error, error} ->
        push_error(socket, error)
        {:noreply, socket}
    end
  end

  def handle_in("packet:ingest", message, socket) do
    with {:ok, request_id, project_id, payload} <- normalize_message("packet:ingest", message, socket),
         graph <- GraphStore.get_or_init(project_id),
         {:ok, packet} <- Packet.validate(graph, payload),
         {:ok, updated_graph, emitted_packets} <- GraphStore.process_packet(project_id, packet) do
      broadcast_packet(socket, request_id, project_id, packet, Packet.route_targets(graph, packet))

      Enum.each(emitted_packets, fn emitted_packet ->
        broadcast_packet(socket, request_id, project_id, emitted_packet, Packet.route_targets(updated_graph, emitted_packet))
      end)

      if updated_graph != graph do
        broadcast_graph(socket, request_id, project_id, updated_graph)
      end

      {:noreply, socket}
    else
      {:error, %{ "event" => "error"} = envelope} ->
        push_error(socket, envelope)
        {:noreply, socket}

      {:error, error} ->
        push_error(
          socket,
          ChannelEnvelope.error(message["request_id"], socket.assigns.topic_project_id, error)
        )

        {:noreply, socket}
    end
  end

  def handle_in("classifier:record_start", message, socket) do
    with {:ok, request_id, project_id, %{"id" => node_id, "label" => label}} <-
           normalize_message("classifier:record_start", message, socket),
         {:ok, graph} <- GraphStore.classifier_record_start(project_id, node_id, label) do
      broadcast_graph(socket, request_id, project_id, graph)
      {:noreply, socket}
    else
      {:error, error} ->
        push_error(socket, envelope_error(message, socket, error))
        {:noreply, socket}
    end
  end

  def handle_in("classifier:record_stop", message, socket) do
    with {:ok, request_id, project_id, %{"id" => node_id}} <-
           normalize_message("classifier:record_stop", message, socket),
         {:ok, graph} <- GraphStore.classifier_record_stop(project_id, node_id) do
      broadcast_graph(socket, request_id, project_id, graph)
      {:noreply, socket}
    else
      {:error, error} ->
        push_error(socket, envelope_error(message, socket, error))
        {:noreply, socket}
    end
  end

  def handle_in("classifier:train", message, socket) do
    with {:ok, request_id, project_id, %{"id" => node_id} = payload} <-
           normalize_message("classifier:train", message, socket),
         {:ok, graph} <- GraphStore.classifier_train(project_id, node_id, payload) do
      broadcast_graph(socket, request_id, project_id, graph)
      {:noreply, socket}
    else
      {:error, error} ->
        push_error(socket, envelope_error(message, socket, error))
        {:noreply, socket}
    end
  end

  def handle_in("classifier:inference_start", message, socket) do
    with {:ok, request_id, project_id, %{"id" => node_id}} <-
           normalize_message("classifier:inference_start", message, socket),
         {:ok, graph} <- GraphStore.classifier_inference_start(project_id, node_id) do
      broadcast_graph(socket, request_id, project_id, graph)
      {:noreply, socket}
    else
      {:error, error} ->
        push_error(socket, envelope_error(message, socket, error))
        {:noreply, socket}
    end
  end

  def handle_in("classifier:inference_stop", message, socket) do
    with {:ok, request_id, project_id, %{"id" => node_id}} <-
           normalize_message("classifier:inference_stop", message, socket),
         {:ok, graph} <- GraphStore.classifier_inference_stop(project_id, node_id) do
      broadcast_graph(socket, request_id, project_id, graph)
      {:noreply, socket}
    else
      {:error, error} ->
        push_error(socket, envelope_error(message, socket, error))
        {:noreply, socket}
    end
  end

  def handle_in("consumer:spotify_connect", message, socket) do
    case normalize_message("consumer:spotify_connect", message, socket) do
      {:ok, request_id, project_id, %{"id" => node_id}} ->
        case GraphStore.consumer_spotify_connect(project_id, node_id) do
          {:ok, graph} ->
            broadcast_graph(socket, request_id, project_id, graph)
            {:noreply, socket}

          {:error, error} ->
            if graph = GraphStore.get(project_id), do: broadcast_graph(socket, request_id, project_id, graph)
            push_error(socket, envelope_error(message, socket, error))
            {:noreply, socket}
        end

      {:error, error} ->
        push_error(socket, envelope_error(message, socket, error))
        {:noreply, socket}
    end
  end

  def handle_in("consumer:spotify_auth_state", message, socket) do
    case normalize_message("consumer:spotify_auth_state", message, socket) do
      {:ok, request_id, project_id, %{"id" => node_id}} ->
        case GraphStore.consumer_spotify_auth_state(project_id, node_id) do
          {:ok, graph} ->
            broadcast_graph(socket, request_id, project_id, graph)
            {:noreply, socket}

          {:error, error} ->
            if graph = GraphStore.get(project_id), do: broadcast_graph(socket, request_id, project_id, graph)
            push_error(socket, envelope_error(message, socket, error))
            {:noreply, socket}
        end

      {:error, error} ->
        push_error(socket, envelope_error(message, socket, error))
        {:noreply, socket}
    end
  end

  def handle_in(event, message, socket) do
    case normalize_message(event, message, socket) do
      {:ok, request_id, project_id, payload} ->
        case GraphStore.update(project_id, &Graph.apply_event(event, &1, payload)) do
          {:ok, graph} ->
            broadcast!(
              socket,
              "graph:updated",
              ChannelEnvelope.success("graph:updated", request_id, project_id, %{"graph" => graph})
            )

          {:error, error} ->
            push_error(socket, ChannelEnvelope.error(request_id, project_id, error))
        end

        {:noreply, socket}

      {:error, error} ->
        push_error(socket, error)
        {:noreply, socket}
    end
  end

  @impl true
  def handle_info(:push_initial_graph, socket) do
    project_id = socket.assigns.project_id
    graph = GraphStore.get_or_init(project_id)

    push(
      socket,
      "graph:updated",
      ChannelEnvelope.success("graph:updated", nil, project_id, %{"graph" => graph})
    )

    {:noreply, socket}
  end

  @impl true
  def handle_info({:graph_updated, request_id, project_id, graph}, socket) do
    push(
      socket,
      "graph:updated",
      ChannelEnvelope.success("graph:updated", request_id, project_id, %{"graph" => graph})
    )

    {:noreply, socket}
  end

  defp normalize_message(
         expected_event,
         %{
           "event" => event,
           "request_id" => request_id,
           "project_id" => project_id,
           "payload" => payload
         },
         socket
       )
       when is_binary(expected_event) and is_binary(event) and is_binary(request_id) and
              request_id != "" and is_binary(project_id) and is_map(payload) do
    topic_project_id = socket.assigns.topic_project_id

    cond do
      event != expected_event ->
        {:error,
         ChannelEnvelope.error(
           request_id,
           topic_project_id,
           %{code: "invalid_payload", message: "event does not match channel event", details: %{}}
         )}

      project_id != topic_project_id ->
        {:error,
         ChannelEnvelope.error(
           request_id,
           topic_project_id,
           %{code: "invalid_payload", message: "project_id does not match topic", details: %{}}
         )}

      true ->
        {:ok, request_id, project_id, payload}
    end
  end

  defp normalize_message(expected_event, %{"event" => event, "request_id" => request_id, "project_id" => project_id}, socket)
       when is_binary(expected_event) and is_binary(event) and is_binary(request_id) and
              request_id != "" and is_binary(project_id) do
    normalize_message(
      expected_event,
      %{"event" => event, "request_id" => request_id, "project_id" => project_id, "payload" => %{}},
      socket
    )
  end

  defp normalize_message(_expected_event, _message, socket) do
    {:error,
     ChannelEnvelope.error(
       nil,
       socket.assigns.topic_project_id,
       %{
         code: "invalid_payload",
         message: "Expected event, request_id, project_id, and payload",
         details: %{}
       }
     )}
  end

  defp push_error(socket, error_envelope) do
    push(socket, "error", error_envelope)
  end

  defp broadcast_graph(socket, request_id, project_id, graph) do
    broadcast!(
      socket,
      "graph:updated",
      ChannelEnvelope.success("graph:updated", request_id, project_id, %{"graph" => graph})
    )
  end

  defp broadcast_packet(socket, request_id, project_id, packet, route_targets) do
    broadcast!(
      socket,
      "packet:observed",
      ChannelEnvelope.success("packet:observed", request_id, project_id, %{
        "packet" => packet,
        "route_targets" => route_targets
      })
    )
  end

  defp envelope_error(_message, _socket, %{"event" => "error"} = envelope), do: envelope

  defp envelope_error(message, socket, error) do
    ChannelEnvelope.error(message["request_id"], socket.assigns.topic_project_id, error)
  end
end
