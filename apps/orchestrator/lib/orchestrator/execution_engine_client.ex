defmodule Orchestrator.ExecutionEngineClient do
  @moduledoc false

  @base_path "/api/v1"

  def train_classifier(payload) when is_map(payload) do
    post("#{@base_path}/classifier/train", payload)
  end

  def get_job_status(job_id) when is_binary(job_id) do
    get("#{@base_path}/jobs/#{job_id}")
  end

  def infer_classifier(payload) when is_map(payload) do
    post("#{@base_path}/classifier/infer", payload)
  end

  def infer_fusion(payload) when is_map(payload) do
    post("#{@base_path}/fusion/infer", payload)
  end

  def trigger_spotify_action(payload) when is_map(payload) do
    post("#{@base_path}/integrations/spotify/action", payload)
  end

  def get_spotify_auth_state(project_id) when is_binary(project_id) do
    query = URI.encode_query(%{"project_id" => project_id})
    get("#{@base_path}/integrations/spotify/auth-state?" <> query)
  end

  def connect_spotify(project_id) when is_binary(project_id) do
    payload = %{
      "project_id" => project_id,
      "redirect_uri" => spotify_callback_url()
    }

    post("#{@base_path}/integrations/spotify/connect", payload)
  end

  defp post(path, payload) do
    with {:ok, body} <- Jason.encode(payload),
         {:ok, response} <- post_request(path, body) do
      decode_response(response)
    end
  end

  defp get(path) do
    with {:ok, response} <- get_request(path) do
      decode_response(response)
    end
  end

  defp post_request(path, body) do
    url = base_url() <> path
    headers = [{~c"content-type", ~c"application/json"}]

    case :httpc.request(:post, {String.to_charlist(url), headers, ~c"application/json", String.to_charlist(body)}, [], []) do
      {:ok, response} -> {:ok, response}
      {:error, reason} -> {:error, %{code: "engine_unavailable", message: "Execution engine request failed", details: %{reason: inspect(reason)}}}
    end
  end

  defp get_request(path) do
    url = base_url() <> path

    case :httpc.request(:get, {String.to_charlist(url), []}, [], []) do
      {:ok, response} -> {:ok, response}
      {:error, reason} -> {:error, %{code: "engine_unavailable", message: "Execution engine request failed", details: %{reason: inspect(reason)}}}
    end
  end

  defp decode_response({{_, status, _}, _headers, raw_body}) when status in 200..299 do
    Jason.decode(to_string(raw_body))
  end

  defp decode_response({{_, _status, _}, _headers, raw_body}) do
    case Jason.decode(to_string(raw_body)) do
      {:ok, %{"code" => code, "message" => message, "details" => details}} ->
        {:error, %{code: code, message: message, details: details}}

      _ ->
        {:error, %{code: "engine_error", message: "Execution engine returned an unexpected error", details: %{}}}
    end
  end

  defp base_url do
    Application.get_env(:orchestrator, :execution_engine_base_url, "http://127.0.0.1:4001")
  end

  defp spotify_callback_url do
    base_url() <> "#{@base_path}/integrations/spotify/callback"
  end
end
