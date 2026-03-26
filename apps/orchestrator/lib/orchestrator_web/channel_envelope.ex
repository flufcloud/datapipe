defmodule OrchestratorWeb.ChannelEnvelope do
  @moduledoc false

  def success(event, request_id, project_id, payload) when is_binary(event) and is_binary(project_id) do
    %{
      "event" => event,
      "request_id" => request_id,
      "project_id" => project_id,
      "payload" => payload
    }
  end

  def error(request_id, project_id, %{code: code, message: message, details: details})
      when is_binary(project_id) do
    success("error", request_id, project_id, %{
      "code" => code,
      "message" => message,
      "details" => details
    })
  end

  def error(request_id, project_id, %{"code" => code, "message" => message, "details" => details})
      when is_binary(project_id) do
    success("error", request_id, project_id, %{
      "code" => code,
      "message" => message,
      "details" => details
    })
  end
end
