defmodule Orchestrator.GraphPersistence do
  @moduledoc false

  @app :orchestrator

  def load_all do
    dir = ensure_store_dir!()

    dir
    |> Path.join("*.json")
    |> Path.wildcard()
    |> Enum.reduce(%{}, fn path, acc ->
      case File.read(path) do
        {:ok, contents} ->
          case Jason.decode(contents) do
            {:ok, %{"project" => %{"id" => project_id}} = graph} when is_binary(project_id) ->
              Map.put(acc, project_id, graph)

            _ ->
              acc
          end

        _ ->
          acc
      end
    end)
  end

  def save_project(project_id, graph) when is_binary(project_id) and is_map(graph) do
    dir = ensure_store_dir!()
    path = project_file(dir, project_id)

    with {:ok, encoded} <- Jason.encode(graph, pretty: true),
         :ok <- File.write(path, encoded) do
      :ok
    end
  end

  defp ensure_store_dir! do
    dir = Application.get_env(@app, :graph_store_dir, default_dir())
    File.mkdir_p!(dir)
    dir
  end

  defp project_file(dir, project_id), do: Path.join(dir, "#{project_id}.json")

  defp default_dir, do: Path.expand("../data/graphs", __DIR__)
end
