graph_store_dir = Application.get_env(:orchestrator, :graph_store_dir)

if graph_store_dir do
  File.rm_rf!(graph_store_dir)
  File.mkdir_p!(graph_store_dir)
end

ExUnit.start()
