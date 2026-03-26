import Config

config :orchestrator, :dns_cluster_query, :ignore
config :orchestrator, :graph_store_dir, Path.expand("../data/graphs", __DIR__)
config :orchestrator, :execution_engine_base_url, "http://127.0.0.1:4001"
config :orchestrator, :execution_engine_client, Orchestrator.ExecutionEngineClient
config :orchestrator, :training_poll_interval_ms, 100

config :orchestrator, OrchestratorWeb.Endpoint,
  url: [host: "localhost"],
  render_errors: [
    formats: [json: OrchestratorWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: Orchestrator.PubSub,
  live_view: [signing_salt: "orchestrator_lv_salt_change_in_prod"]

config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

config :phoenix, :json_library, Jason

import_config "#{config_env()}.exs"
