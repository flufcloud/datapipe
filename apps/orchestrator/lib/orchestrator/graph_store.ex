defmodule Orchestrator.GraphStore do
  @moduledoc false
  use GenServer

  @name __MODULE__

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: @name)
  end

  def get_or_init(project_id) do
    GenServer.call(@name, {:get_or_init, project_id})
  end

  def put(project_id, graph) do
    GenServer.call(@name, {:put, project_id, graph})
  end

  def get(project_id) do
    GenServer.call(@name, {:get, project_id})
  end

  def update(project_id, fun) when is_function(fun, 1) do
    GenServer.call(@name, {:update, project_id, fun})
  end

  def classifier_record_start(project_id, node_id, label) do
    GenServer.call(@name, {:classifier_record_start, project_id, node_id, label})
  end

  def classifier_record_stop(project_id, node_id) do
    GenServer.call(@name, {:classifier_record_stop, project_id, node_id})
  end

  def classifier_train(project_id, node_id, attrs \\ %{}) do
    GenServer.call(@name, {:classifier_train, project_id, node_id, attrs})
  end

  def classifier_inference_start(project_id, node_id) do
    GenServer.call(@name, {:classifier_inference_start, project_id, node_id})
  end

  def classifier_inference_stop(project_id, node_id) do
    GenServer.call(@name, {:classifier_inference_stop, project_id, node_id})
  end

  def process_packet(project_id, packet) do
    GenServer.call(@name, {:process_packet, project_id, packet})
  end

  def consumer_spotify_connect(project_id, node_id) do
    GenServer.call(@name, {:consumer_spotify_connect, project_id, node_id})
  end

  def consumer_spotify_auth_state(project_id, node_id) do
    GenServer.call(@name, {:consumer_spotify_auth_state, project_id, node_id})
  end

  @impl true
  def init(_opts) do
    {:ok, Orchestrator.GraphPersistence.load_all()}
  end

  @impl true
  def handle_call({:get_or_init, project_id}, _from, state) do
    case Map.fetch(state, project_id) do
      {:ok, graph} ->
        {:reply, graph, state}

      :error ->
        graph = Orchestrator.Graph.empty(project_id)
        persist!(project_id, graph)
        {:reply, graph, Map.put(state, project_id, graph)}
    end
  end

  def handle_call({:put, project_id, graph}, _from, state) do
    persist!(project_id, graph)
    {:reply, :ok, Map.put(state, project_id, graph)}
  end

  def handle_call({:get, project_id}, _from, state) do
    {:reply, Map.get(state, project_id), state}
  end

  def handle_call({:update, project_id, fun}, _from, state) do
    graph = Map.get(state, project_id) || Orchestrator.Graph.empty(project_id)

    case fun.(graph) do
      {:ok, new_graph} ->
        persist!(project_id, new_graph)
        {:reply, {:ok, new_graph}, Map.put(state, project_id, new_graph)}

      {:error, _} = err ->
        {:reply, err, state}
    end
  end

  def handle_call({:classifier_record_start, project_id, node_id, label}, _from, state) do
    with {:ok, graph} <- classifier_graph_update(state, project_id, &Orchestrator.ClassifierRuntime.record_start(&1, node_id, label)) do
      {:reply, {:ok, graph}, Map.put(state, project_id, graph)}
    else
      {:error, error} -> {:reply, {:error, error}, state}
    end
  end

  def handle_call({:classifier_record_stop, project_id, node_id}, _from, state) do
    with {:ok, graph} <- classifier_graph_update(state, project_id, &Orchestrator.ClassifierRuntime.record_stop(&1, node_id)) do
      {:reply, {:ok, graph}, Map.put(state, project_id, graph)}
    else
      {:error, error} -> {:reply, {:error, error}, state}
    end
  end

  def handle_call({:classifier_inference_start, project_id, node_id}, _from, state) do
    with {:ok, graph} <- classifier_graph_update(state, project_id, &Orchestrator.ClassifierRuntime.inference_start(&1, node_id)) do
      {:reply, {:ok, graph}, Map.put(state, project_id, graph)}
    else
      {:error, error} -> {:reply, {:error, error}, state}
    end
  end

  def handle_call({:classifier_inference_stop, project_id, node_id}, _from, state) do
    with {:ok, graph} <- classifier_graph_update(state, project_id, &Orchestrator.ClassifierRuntime.inference_stop(&1, node_id)) do
      {:reply, {:ok, graph}, Map.put(state, project_id, graph)}
    else
      {:error, error} -> {:reply, {:error, error}, state}
    end
  end

  def handle_call({:classifier_train, project_id, node_id, attrs}, _from, state) do
    graph = Map.get(state, project_id) || Orchestrator.Graph.empty(project_id)

    with {:ok, request} <- Orchestrator.ClassifierRuntime.training_request(graph, node_id, attrs),
         {:ok, %{"job_id" => job_id}} <- apply(execution_engine_client(), :train_classifier, [request]),
         {:ok, updated_graph} <- Orchestrator.ClassifierRuntime.training_started(graph, node_id, job_id, request["config"]) do
      persist!(project_id, updated_graph)
      schedule_training_poll(project_id, node_id, job_id)
      {:reply, {:ok, updated_graph}, Map.put(state, project_id, updated_graph)}
    else
      {:error, error} ->
        {:reply, {:error, error}, state}
    end
  end

  def handle_call({:process_packet, project_id, packet}, _from, state) do
    graph = Map.get(state, project_id) || Orchestrator.Graph.empty(project_id)

    with {:ok, updated_graph, emitted_packets} <- process_runtime_packets(graph, [packet], []) do
      persist!(project_id, updated_graph)
      {:reply, {:ok, updated_graph, emitted_packets}, Map.put(state, project_id, updated_graph)}
    else
      {:error, error} ->
        {:reply, {:error, error}, state}
    end
  end

  def handle_call({:consumer_spotify_connect, project_id, node_id}, _from, state) do
    graph = Map.get(state, project_id) || Orchestrator.Graph.empty(project_id)

    case apply(execution_engine_client(), :connect_spotify, [project_id]) do
      {:ok, response} ->
        with {:ok, updated_graph} <- Orchestrator.ConsumerRuntime.sync_spotify_auth(graph, node_id, response) do
          persist!(project_id, updated_graph)
          {:reply, {:ok, updated_graph}, Map.put(state, project_id, updated_graph)}
        else
          {:error, error} -> {:reply, {:error, error}, state}
        end

      {:error, error} ->
        case Orchestrator.ConsumerRuntime.sync_spotify_error(graph, node_id, error) do
          {:ok, updated_graph} ->
            persist!(project_id, updated_graph)
            {:reply, {:error, error}, Map.put(state, project_id, updated_graph)}

          {:error, runtime_error} ->
            {:reply, {:error, runtime_error}, state}
        end
    end
  end

  def handle_call({:consumer_spotify_auth_state, project_id, node_id}, _from, state) do
    graph = Map.get(state, project_id) || Orchestrator.Graph.empty(project_id)

    case apply(execution_engine_client(), :get_spotify_auth_state, [project_id]) do
      {:ok, response} ->
        with {:ok, updated_graph} <- Orchestrator.ConsumerRuntime.sync_spotify_auth(graph, node_id, response) do
          persist!(project_id, updated_graph)
          {:reply, {:ok, updated_graph}, Map.put(state, project_id, updated_graph)}
        else
          {:error, error} -> {:reply, {:error, error}, state}
        end

      {:error, error} ->
        case Orchestrator.ConsumerRuntime.sync_spotify_error(graph, node_id, error) do
          {:ok, updated_graph} ->
            persist!(project_id, updated_graph)
            {:reply, {:error, error}, Map.put(state, project_id, updated_graph)}

          {:error, runtime_error} ->
            {:reply, {:error, runtime_error}, state}
        end
    end
  end

  defp process_runtime_packets(graph, [], emitted_packets), do: {:ok, graph, emitted_packets}

  defp process_runtime_packets(graph, [packet | remaining_packets], emitted_packets) do
    with {:ok, classifier_graph, classifier_packets} <-
           Orchestrator.ClassifierRuntime.process_packet(
             graph,
             packet,
             &apply(execution_engine_client(), :infer_classifier, [&1])
           ),
         {:ok, fusion_graph, fusion_packets} <-
           Orchestrator.FusionRuntime.process_packet(
             classifier_graph,
             packet,
             &apply(execution_engine_client(), :infer_fusion, [&1])
           ),
         {:ok, consumer_graph} <-
           Orchestrator.ConsumerRuntime.process_packet(
             fusion_graph,
             packet,
             &apply(execution_engine_client(), :trigger_spotify_action, [&1])
           ) do
      new_packets = classifier_packets ++ fusion_packets
      process_runtime_packets(consumer_graph, remaining_packets ++ new_packets, emitted_packets ++ new_packets)
    end
  end

  @impl true
  def handle_info({:poll_training_job, project_id, node_id, job_id}, state) do
    case apply(execution_engine_client(), :get_job_status, [job_id]) do
      {:ok, %{"status" => status}} when status in ["queued", "running"] ->
        schedule_training_poll(project_id, node_id, job_id)
        {:noreply, state}

      {:ok, %{"status" => "completed", "result" => result}} ->
        graph = Map.get(state, project_id) || Orchestrator.Graph.empty(project_id)

        case Orchestrator.ClassifierRuntime.training_completed(graph, node_id, result) do
          {:ok, updated_graph} ->
            persist!(project_id, updated_graph)
            broadcast_graph_update(project_id, updated_graph, "training:completed")
            {:noreply, Map.put(state, project_id, updated_graph)}

          {:error, _error} ->
            {:noreply, state}
        end

      {:ok, %{"status" => "failed"} = response} ->
        state = mark_training_failure(state, project_id, node_id, response["message"] || "Training failed")
        {:noreply, state}

      {:error, error} ->
        state = mark_training_failure(state, project_id, node_id, error["message"] || "Training request failed")
        {:noreply, state}
    end
  end

  defp persist!(project_id, graph) do
    case Orchestrator.GraphPersistence.save_project(project_id, graph) do
      :ok -> :ok
      {:error, reason} -> raise "failed to persist graph #{project_id}: #{inspect(reason)}"
    end
  end

  defp classifier_graph_update(state, project_id, fun) do
    graph = Map.get(state, project_id) || Orchestrator.Graph.empty(project_id)

    with {:ok, updated_graph} <- fun.(graph) do
      persist!(project_id, updated_graph)
      {:ok, updated_graph}
    end
  end

  defp execution_engine_client do
    Application.get_env(:orchestrator, :execution_engine_client, Orchestrator.ExecutionEngineClient)
  end

  defp schedule_training_poll(project_id, node_id, job_id) do
    poll_ms = Application.get_env(:orchestrator, :training_poll_interval_ms, 100)
    Process.send_after(self(), {:poll_training_job, project_id, node_id, job_id}, poll_ms)
  end

  defp broadcast_graph_update(project_id, graph, request_id) do
    Phoenix.PubSub.broadcast(
      Orchestrator.PubSub,
      "graph-updates:#{project_id}",
      {:graph_updated, request_id, project_id, graph}
    )
  end

  defp mark_training_failure(state, project_id, node_id, message) do
    graph = Map.get(state, project_id) || Orchestrator.Graph.empty(project_id)

    case Orchestrator.ClassifierRuntime.training_failed(graph, node_id, message) do
      {:ok, updated_graph} ->
        persist!(project_id, updated_graph)
        broadcast_graph_update(project_id, updated_graph, "training:failed")
        Map.put(state, project_id, updated_graph)

      {:error, _error} ->
        state
    end
  end
end
