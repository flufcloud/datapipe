import Config

config :orchestrator, :graph_store_dir, Path.expand("../tmp/test_graphs", __DIR__)
config :orchestrator, :execution_engine_client, Orchestrator.TestSupport.FakeExecutionEngineClient
config :orchestrator, :training_poll_interval_ms, 10

config :orchestrator, OrchestratorWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  server: false,
  secret_key_base:
    "test_secret_key_base_must_be_at_least_64_characters_long_for_phoenix_xxxxxx",
  check_origin: false

config :logger, level: :warning
