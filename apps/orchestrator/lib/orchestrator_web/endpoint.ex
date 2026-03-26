defmodule OrchestratorWeb.Endpoint do
  @moduledoc false
  use Phoenix.Endpoint, otp_app: :orchestrator

  socket "/socket", OrchestratorWeb.UserSocket,
    websocket: true,
    longpoll: false

  plug Plug.RequestId
  plug Plug.Telemetry, event_prefix: [:phoenix, :endpoint]
  plug Plug.Parsers,
    parsers: [:json],
    pass: ["application/json"],
    json_decoder: Jason

  plug Plug.MethodOverride
  plug Plug.Head
  plug OrchestratorWeb.Router
end
