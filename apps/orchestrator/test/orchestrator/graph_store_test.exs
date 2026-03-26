defmodule Orchestrator.GraphStoreTest do
  use ExUnit.Case, async: false

  alias Orchestrator.GraphStore

  test "get_or_init persists the initial graph snapshot to disk" do
    project_id = "persisted_#{System.unique_integer([:positive])}_#{System.system_time(:microsecond)}"

    graph = GraphStore.get_or_init(project_id)

    assert graph["project"]["id"] == project_id

    store_dir = Application.fetch_env!(:orchestrator, :graph_store_dir)
    persisted = Path.join(store_dir, "#{project_id}.json")

    assert File.exists?(persisted)
    assert {:ok, contents} = File.read(persisted)
    assert contents =~ project_id
  end
end
