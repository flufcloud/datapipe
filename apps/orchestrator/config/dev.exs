import Config

config :orchestrator, OrchestratorWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4000],
  check_origin: false,
  code_reloader: true,
  debug_errors: true,
  secret_key_base:
    "dev_secret_key_base_must_be_at_least_64_characters_long_for_phoenix_xxxxxxxx",
  watchers: []

config :logger, level: :debug
