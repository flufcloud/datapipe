defmodule Orchestrator.Graph do
  @moduledoc false

  @doc "Canonical empty graph snapshot for a project id."
  def empty(project_id) do
    %{
      "project" => %{
        "id" => project_id,
        "name" => "Untitled Project",
        "version" => 1
      },
      "nodes" => [],
      "edges" => []
    }
  end

  @doc "Returns the current canonical graph for graph:init."
  def init(graph, _payload), do: {:ok, graph}

  def apply_event(event, graph, payload) when is_binary(event) and is_map(payload) do
    case event do
      "graph:init" -> init(graph, payload)
      "node:create" -> create_node(graph, payload)
      "node:update" -> update_node(graph, payload)
      "node:update_position" -> update_position(graph, payload)
      "node:delete" -> delete_node(graph, payload)
      "edge:create" -> create_edge(graph, payload)
      "edge:delete" -> delete_edge(graph, payload)
      _ -> {:error, err("unsupported_event", "Unsupported event", %{event: event})}
    end
  end

  def apply_event(_event, _graph, _payload) do
    {:error, err("invalid_payload", "Payload must be an object", %{})}
  end

  def create_node(graph, attrs) do
    with {:ok, node} <- normalize_new_node(attrs) do
      nodes = Map.get(graph, "nodes", [])

      if Enum.any?(nodes, &(&1["id"] == node["id"])) do
        {:error, err("duplicate_node", "Node id already exists", %{id: node["id"]})}
      else
        {:ok, %{graph | "nodes" => nodes ++ [node]}}
      end
    end
  end

  def update_node(graph, %{"id" => id} = patch) do
    nodes = Map.get(graph, "nodes", [])

    case Enum.find_index(nodes, &(&1["id"] == id)) do
      nil ->
        {:error, err("node_not_found", "Node not found", %{id: id})}

      idx ->
        updated =
          nodes
          |> List.update_at(idx, fn n ->
            n
            |> merge_optional("label", patch["label"])
            |> merge_optional("configuration", patch["configuration"])
            |> merge_optional("ports", patch["ports"])
            |> merge_optional("status", patch["status"])
          end)

        {:ok, %{graph | "nodes" => updated}}
    end
  end

  def update_position(graph, %{"id" => id} = payload) do
    pos =
      case payload do
        %{"position" => %{"x" => x, "y" => y}} -> %{"x" => x, "y" => y}
        %{"x" => x, "y" => y} -> %{"x" => x, "y" => y}
        _ -> nil
      end

    if pos == nil do
      {:error, err("invalid_payload", "Expected position {x,y} or {position: {x,y}}", %{})}
    else
      nodes = Map.get(graph, "nodes", [])

      case Enum.find_index(nodes, &(&1["id"] == id)) do
        nil ->
          {:error, err("node_not_found", "Node not found", %{id: id})}

        idx ->
          updated = List.update_at(nodes, idx, &Map.put(&1, "position", pos))
          {:ok, %{graph | "nodes" => updated}}
      end
    end
  end

  def delete_node(graph, %{"id" => id}) do
    nodes = Map.get(graph, "nodes", [])
    edges = Map.get(graph, "edges", [])

    if Enum.any?(nodes, &(&1["id"] == id)) do
      new_nodes = Enum.reject(nodes, &(&1["id"] == id))

      new_edges =
        Enum.reject(edges, fn e ->
          e["source_id"] == id or e["target_id"] == id
        end)

      {:ok, %{graph | "nodes" => new_nodes, "edges" => new_edges}}
    else
      {:error, err("node_not_found", "Node not found", %{id: id})}
    end
  end

  def create_edge(graph, attrs) do
    with {:ok, edge} <- normalize_new_edge(attrs),
         :ok <- nodes_exist?(graph, edge["source_id"], edge["target_id"]),
         :ok <- ports_compatible?(graph, edge),
         :ok <- acyclic?(graph, edge) do
      edges = Map.get(graph, "edges", [])

      if Enum.any?(edges, &(&1["id"] == edge["id"])) do
        {:error, err("duplicate_edge", "Edge id already exists", %{id: edge["id"]})}
      else
        {:ok, %{graph | "edges" => edges ++ [edge]}}
      end
    end
  end

  def delete_edge(graph, %{"id" => id}) do
    edges = Map.get(graph, "edges", [])

    if Enum.any?(edges, &(&1["id"] == id)) do
      {:ok, %{graph | "edges" => Enum.reject(edges, &(&1["id"] == id))}}
    else
      {:error, err("edge_not_found", "Edge not found", %{id: id})}
    end
  end

  defp err(code, message, details) do
    %{code: code, message: message, details: stringify_details(details)}
  end

  defp stringify_details(details) when is_map(details) do
    details
    |> Enum.map(fn {k, v} -> {to_string(k), v} end)
    |> Map.new()
  end

  defp normalize_new_node(attrs) when is_map(attrs) do
    id = attrs["id"]
    type = attrs["type"]

    cond do
      not is_binary(id) or id == "" ->
        {:error, err("invalid_payload", "Node id is required", %{})}

      not is_binary(type) or type == "" ->
        {:error, err("invalid_payload", "Node type is required", %{})}

      true ->
        category = attrs["category"] || infer_category(type)
        label = attrs["label"] || infer_label(type)
        position = normalize_position(attrs["position"])
        configuration = Map.merge(default_configuration(type), attrs["configuration"] || %{})
        ports = attrs["ports"] || %{"inputs" => [], "outputs" => []}
        status = attrs["status"] || "idle"

        {:ok,
         %{
           "id" => id,
           "type" => type,
           "category" => category,
           "label" => label,
           "position" => position,
           "configuration" => configuration,
           "ports" => ports,
           "status" => status
         }}
    end
  end

  defp normalize_new_node(_), do: {:error, err("invalid_payload", "Node payload must be an object", %{})}

  defp infer_category(type) do
    case String.split(type, ".", parts: 2) do
      [cat, _] -> cat
      _ -> "Unknown"
    end
  end

  defp infer_label(type) do
    case String.split(type, ".", parts: 2) do
      [_, name] -> name
      _ -> type
    end
  end

  defp default_configuration("Modifier.Classifier") do
    %{
      "classifier" => %{
        "dataset" => %{"labels" => [], "samples" => []},
        "window_size" => 8,
        "epochs" => 20
      }
    }
  end

  defp default_configuration("Modifier.Fusion") do
    %{
      "fusion" => %{
        "window_ms" => 5_000,
        "rules" => [
          %{
            "left_label" => "clockwise",
            "right_label" => "active",
            "output_label" => "music_control",
            "confidence" => 0.95
          }
        ],
        "latest_inputs" => %{},
        "last_output" => nil,
        "last_error" => nil,
        "last_combination_id" => nil
      }
    }
  end

  defp default_configuration("Generator.Bluetooth") do
    %{
      "service_uuid" => "e95d0753-251d-470a-a062-fa1922dfa9a8",
      "characteristic_uuid" => "e95dca4b-251d-470a-a062-fa1922dfa9a8"
    }
  end

  defp default_configuration("Consumer.Spotify") do
    %{
      "spotify" => %{
        "action" => nil,
        "label_actions" => %{},
        "auth" => %{"status" => "unknown"},
        "last_action" => nil,
        "last_error" => nil,
        "history" => [],
        "processed_packet_ids" => []
      }
    }
  end

  defp default_configuration(_type), do: %{}

  defp normalize_position(%{"x" => x, "y" => y}), do: %{"x" => x, "y" => y}
  defp normalize_position(_), do: %{"x" => 0, "y" => 0}

  defp normalize_new_edge(attrs) when is_map(attrs) do
    id = attrs["id"]
    source_id = attrs["source_id"]
    source_port = attrs["source_port"]
    target_id = attrs["target_id"]
    target_port = attrs["target_port"]

    if Enum.all?([id, source_id, source_port, target_id, target_port], &is_binary/1) and
         Enum.all?([id, source_id, source_port, target_id, target_port], &(byte_size(&1) > 0)) do
      {:ok,
       %{
         "id" => id,
         "source_id" => source_id,
         "source_port" => source_port,
         "target_id" => target_id,
         "target_port" => target_port
       }}
    else
      {:error,
       err(
         "invalid_payload",
         "Edge requires id, source_id, source_port, target_id, target_port",
         %{}
       )}
    end
  end

  defp normalize_new_edge(_), do: {:error, err("invalid_payload", "Edge payload must be an object", %{})}

  defp nodes_exist?(graph, source_id, target_id) do
    nodes = Map.get(graph, "nodes", [])
    ids = MapSet.new(Enum.map(nodes, & &1["id"]))

    cond do
      not MapSet.member?(ids, source_id) ->
        {:error, err("node_not_found", "Source node not found", %{id: source_id})}

      not MapSet.member?(ids, target_id) ->
        {:error, err("node_not_found", "Target node not found", %{id: target_id})}

      true ->
        :ok
    end
  end

  defp ports_compatible?(graph, edge) do
    source = find_node(graph, edge["source_id"])
    target = find_node(graph, edge["target_id"])
    out_schema = port_schema(source, "outputs", edge["source_port"])
    in_schema = port_schema(target, "inputs", edge["target_port"])

    cond do
      out_schema == nil ->
        {:error,
         err("port_mismatch", "Unknown source output port", %{port: edge["source_port"]})}

      in_schema == nil ->
        {:error,
         err("port_mismatch", "Unknown target input port", %{port: edge["target_port"]})}

      out_schema != in_schema ->
        {:error,
         err(
           "port_mismatch",
           "Port schemas are not compatible",
           %{source_schema: out_schema, target_schema: in_schema}
         )}

      true ->
        :ok
    end
  end

  defp find_node(graph, id) do
    graph
    |> Map.get("nodes", [])
    |> Enum.find(&(&1["id"] == id))
  end

  defp port_schema(node, direction, port_name) do
    ports = node["ports"] || %{}
    list = Map.get(ports, direction, [])

    case Enum.find(list, &(&1["name"] == port_name)) do
      %{"schema" => s} when is_binary(s) -> s
      _ -> nil
    end
  end

  defp acyclic?(graph, new_edge) do
    edges = Map.get(graph, "edges", []) ++ [new_edge]
    # Adding u -> v introduces a cycle iff v can already reach u.
    if reachable?(edges, new_edge["target_id"], new_edge["source_id"]) do
      {:error, err("cycle_detected", "Edge creation would introduce a cycle", %{})}
    else
      :ok
    end
  end

  defp reachable?(edges, from, to) do
    adj =
      Enum.reduce(edges, %{}, fn e, acc ->
        Map.update(acc, e["source_id"], [e["target_id"]], &[e["target_id"] | &1])
      end)

    dfs?(adj, from, to, MapSet.new())
  end

  defp dfs?(_adj, curr, goal, _visited) when curr == goal, do: true

  defp dfs?(adj, curr, goal, visited) do
    if MapSet.member?(visited, curr) do
      false
    else
      visited = MapSet.put(visited, curr)

      (Map.get(adj, curr, []) || [])
      |> Enum.any?(&dfs?(adj, &1, goal, visited))
    end
  end

  defp merge_optional(node, _key, nil), do: node
  defp merge_optional(node, key, val), do: Map.put(node, key, val)
end
