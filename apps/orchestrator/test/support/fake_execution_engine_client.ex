defmodule Orchestrator.TestSupport.FakeExecutionEngineClient do
  @moduledoc false

  use Agent

  @name __MODULE__

  def train_classifier(%{"dataset" => dataset, "config" => config}) do
    ensure_started!()

    job_id = "job_" <> Integer.to_string(System.unique_integer([:positive]))
    model_id = "model_" <> Integer.to_string(System.unique_integer([:positive]))

    Agent.update(@name, fn state ->
      put_in(state, ["jobs", job_id], %{
        "job_id" => job_id,
        "polls" => 0,
        "result" => %{
          "model_id" => model_id,
          "labels" => dataset["labels"] || [],
          "window_size" => config["window_size"] || 8
        }
      })
    end)

    {:ok, %{"job_id" => job_id, "status" => "queued"}}
  end

  def get_job_status(job_id) do
    ensure_started!()

    Agent.get_and_update(@name, fn state ->
      job = get_in(state, ["jobs", job_id]) || raise KeyError, key: job_id, term: state["jobs"]
      polls = job["polls"] + 1

      if polls >= 2 do
        response =
          job
          |> Map.take(["job_id"])
          |> Map.merge(%{
            "status" => "completed",
            "progress" => 100,
            "result" => job["result"]
          })

        {response, put_in(state, ["jobs", job_id], Map.put(job, "polls", polls))}
      else
        response =
          job
          |> Map.take(["job_id"])
          |> Map.merge(%{"status" => "running", "progress" => 50})

        {response, put_in(state, ["jobs", job_id], Map.put(job, "polls", polls))}
      end
    end)
    |> then(&{:ok, &1})
  end

  def infer_classifier(%{"vector_window" => vector_window, "model_id" => model_id}) do
    avg_x =
      vector_window
      |> Enum.map(&Map.get(&1, "x", 0))
      |> average()

    {positive_label, negative_label} =
      if String.contains?(model_id, "active") do
        {"active", "inactive"}
      else
        {"clockwise", "counterclockwise"}
      end

    label = if avg_x >= 0, do: positive_label, else: negative_label
    confidence = min(0.99, 0.6 + abs(avg_x))

    {:ok, %{"label" => label, "confidence" => Float.round(confidence, 2)}}
  end

  def infer_fusion(%{"inputs" => %{"left" => left, "right" => right}, "config" => %{"rules" => rules}}) do
    case Enum.find(rules, fn rule ->
           rule["left_label"] == left["label"] and rule["right_label"] == right["label"]
         end) do
      nil ->
        {:ok, %{"matched" => false, "reason" => "no_rule_match"}}

      rule ->
        left_confidence = left["confidence"] || 0.75
        right_confidence = right["confidence"] || 0.75
        confidence = rule["confidence"] || Float.round((left_confidence + right_confidence) / 2, 2)

        {:ok,
         %{
           "matched" => true,
           "label" => rule["output_label"],
           "confidence" => confidence,
           "matched_rule" => %{
             "left_label" => rule["left_label"],
             "right_label" => rule["right_label"],
             "output_label" => rule["output_label"]
           },
           "inputs" => [
             %{
               "port" => "left",
               "label" => left["label"],
               "confidence" => left_confidence,
               "source_node_id" => left["source_node_id"]
             },
             %{
               "port" => "right",
               "label" => right["label"],
               "confidence" => right_confidence,
               "source_node_id" => right["source_node_id"]
             }
           ]
         }}
    end
  end

  def trigger_spotify_action(%{
        "project_id" => project_id,
        "node_id" => node_id,
        "action" => action,
        "idempotency_key" => idempotency_key
      }) do
    ensure_started!()

    Agent.get_and_update(@name, fn state ->
      state =
        update_in(state, ["spotify_calls"], fn calls ->
          (calls || []) ++
            [
              %{
                "project_id" => project_id,
                "node_id" => node_id,
                "action" => action,
                "idempotency_key" => idempotency_key
              }
            ]
        end)

      case state["spotify_failure"] do
        nil ->
          response = %{"status" => "ok"}
          {response, state}

        error ->
          {{:error, error}, Map.put(state, "spotify_failure", nil)}
      end
    end)
    |> case do
      {:error, _error} = error -> error
      response -> {:ok, response}
    end
  end

  def connect_spotify(project_id) do
    ensure_started!()

    Agent.get_and_update(@name, fn state ->
      case state["spotify_connect_failure"] do
        nil ->
          response = spotify_connected_response(project_id)
          {response, Map.put(state, "spotify_auth_state", response)}

        error ->
          {{:error, error}, Map.put(state, "spotify_connect_failure", nil)}
      end
    end)
    |> case do
      {:error, _error} = error -> error
      response -> {:ok, response}
    end
  end

  def get_spotify_auth_state(project_id) do
    ensure_started!()

    Agent.get_and_update(@name, fn state ->
      case state["spotify_auth_state_failure"] do
        nil ->
          response =
            state["spotify_auth_state"] ||
              %{
                "provider" => "spotify",
                "project_id" => project_id,
                "status" => "not_connected",
                "mode" => "mock",
                "available_actions" => ["next_track", "previous_track", "play_pause"],
                "connection" => %{"connected" => false}
              }

          {response, state}

        error ->
          {{:error, error}, Map.put(state, "spotify_auth_state_failure", nil)}
      end
    end)
    |> case do
      {:error, _error} = error -> error
      response -> {:ok, response}
    end
  end

  def spotify_calls do
    ensure_started!()
    Agent.get(@name, &Map.get(&1, "spotify_calls", []))
  end

  def fail_next_spotify_action(error \\ nil) do
    ensure_started!()

    Agent.update(@name, fn state ->
      Map.put(
        state,
        "spotify_failure",
        error ||
          %{
            "code" => "spotify_action_failed",
            "message" => "Spotify action failed",
            "details" => %{"provider" => "spotify"}
          }
      )
    end)
  end

  def fail_next_spotify_connect(error \\ nil) do
    ensure_started!()

    Agent.update(@name, fn state ->
      Map.put(
        state,
        "spotify_connect_failure",
        error ||
          %{
            "code" => "spotify_connect_failed",
            "message" => "Spotify connection failed",
            "details" => %{"provider" => "spotify"}
          }
      )
    end)
  end

  def fail_next_spotify_auth_state(error \\ nil) do
    ensure_started!()

    Agent.update(@name, fn state ->
      Map.put(
        state,
        "spotify_auth_state_failure",
        error ||
          %{
            "code" => "spotify_auth_state_failed",
            "message" => "Spotify auth state lookup failed",
            "details" => %{"provider" => "spotify"}
          }
      )
    end)
  end

  def reset! do
    ensure_started!()
    Agent.update(@name, fn _state -> initial_state() end)
  end

  defp average([]), do: 0.0
  defp average(values), do: Enum.sum(values) / length(values)

  defp ensure_started! do
    case Process.whereis(@name) do
      nil -> start_link([])
      _pid -> :ok
    end
  end

  def start_link(_opts) do
    Agent.start_link(fn -> initial_state() end, name: @name)
  end

  defp initial_state do
    %{
      "jobs" => %{},
      "spotify_calls" => [],
      "spotify_failure" => nil,
      "spotify_auth_state" => nil,
      "spotify_connect_failure" => nil,
      "spotify_auth_state_failure" => nil
    }
  end

  defp spotify_connected_response(project_id) do
    %{
      "provider" => "spotify",
      "project_id" => project_id,
      "status" => "connected",
      "mode" => "mock",
      "available_actions" => ["next_track", "previous_track", "play_pause"],
      "connection" => %{
        "connected" => true,
        "account" => %{
          "id" => "mock-user",
          "display_name" => "Local Mock Spotify",
          "product" => "dev"
        }
      }
    }
  end
end
