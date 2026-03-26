defmodule Orchestrator.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    children = [
      OrchestratorWeb.Telemetry,
      {DNSCluster, query: Application.get_env(:orchestrator, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Orchestrator.PubSub},
      Orchestrator.GraphStore,
      OrchestratorWeb.Endpoint
    ]

    opts = [strategy: :one_for_one, name: Orchestrator.Supervisor]
    Supervisor.start_link(children, opts)
  end

  @impl true
  def config_change(changed, _new, removed) do
    OrchestratorWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
