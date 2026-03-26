defmodule Orchestrator.Packet do
  @moduledoc false

  def validate(graph, attrs) when is_map(attrs) do
    with {:ok, packet} <- normalize_packet(attrs),
         :ok <- validate_project_id(graph, packet),
         {:ok, node} <- source_node(graph, packet["node_id"]),
         :ok <- schema_matches_output?(node, packet["schema"]),
         :ok <- payload_matches_schema?(packet["schema"], packet["payload"]) do
      {:ok, packet}
    end
  end

  def validate(_graph, _attrs), do: {:error, err("invalid_payload", "Packet payload must be an object", %{})}

  def route_targets(graph, packet) do
    schema = packet["schema"]

    graph
    |> Map.get("edges", [])
    |> Enum.filter(fn edge ->
      edge["source_id"] == packet["node_id"] and source_port_schema(graph, edge) == schema
    end)
    |> Enum.map(fn edge ->
      %{
        "node_id" => edge["target_id"],
        "source_port" => edge["source_port"],
        "target_port" => edge["target_port"]
      }
    end)
  end

  defp normalize_packet(attrs) do
    packet_id = attrs["packet_id"]
    project_id = attrs["project_id"]
    node_id = attrs["node_id"]
    timestamp = attrs["timestamp"]
    schema = attrs["schema"]
    payload = attrs["payload"]

    cond do
      not present_string?(packet_id) ->
        {:error, err("invalid_payload", "packet_id is required", %{})}

      not present_string?(project_id) ->
        {:error, err("invalid_payload", "project_id is required", %{})}

      not present_string?(node_id) ->
        {:error, err("invalid_payload", "node_id is required", %{})}

      not present_string?(timestamp) ->
        {:error, err("invalid_payload", "timestamp is required", %{})}

      match?({:error, _}, DateTime.from_iso8601(timestamp)) ->
        {:error, err("invalid_payload", "timestamp must be ISO-8601", %{})}

      not present_string?(schema) ->
        {:error, err("invalid_payload", "schema is required", %{})}

      not is_map(payload) ->
        {:error, err("invalid_payload", "payload must be an object", %{})}

      true ->
        {:ok,
         %{
           "packet_id" => packet_id,
           "project_id" => project_id,
           "node_id" => node_id,
           "timestamp" => timestamp,
           "schema" => schema,
           "payload" => payload
         }}
    end
  end

  defp validate_project_id(graph, packet) do
    if get_in(graph, ["project", "id"]) == packet["project_id"] do
      :ok
    else
      {:error, err("invalid_payload", "packet project_id does not match graph project", %{})}
    end
  end

  defp source_node(graph, node_id) do
    case Enum.find(Map.get(graph, "nodes", []), &(&1["id"] == node_id)) do
      nil -> {:error, err("node_not_found", "Packet source node not found", %{id: node_id})}
      node -> {:ok, node}
    end
  end

  defp schema_matches_output?(node, schema) do
    outputs = get_in(node, ["ports", "outputs"]) || []

    if Enum.any?(outputs, &(&1["schema"] == schema)) do
      :ok
    else
      {:error,
       err("port_mismatch", "Packet schema does not match any source output port", %{schema: schema})}
    end
  end

  defp payload_matches_schema?("vector/3", %{"x" => x, "y" => y, "z" => z})
       when is_number(x) and is_number(y) and is_number(z),
       do: :ok

  defp payload_matches_schema?("scalar/number", %{"value" => value}) when is_number(value), do: :ok
  defp payload_matches_schema?("label/string", %{"label" => label} = payload) when is_binary(label) do
    case payload["confidence"] do
      nil -> :ok
      confidence when is_number(confidence) -> :ok
      _ -> {:error, err("invalid_payload", "label/string confidence must be numeric", %{})}
    end
  end

  defp payload_matches_schema?("decision/object", %{"label" => label, "confidence" => confidence, "inputs" => inputs})
       when is_binary(label) and is_number(confidence) and is_list(inputs),
       do: :ok

  defp payload_matches_schema?("event/trigger", %{}), do: :ok

  defp payload_matches_schema?(schema, _payload) do
    {:error, err("invalid_payload", "Packet payload does not match schema", %{schema: schema})}
  end

  defp source_port_schema(graph, edge) do
    graph
    |> Map.get("nodes", [])
    |> Enum.find(&(&1["id"] == edge["source_id"]))
    |> case do
      nil ->
        nil

      node ->
        node
        |> get_in(["ports", "outputs"])
        |> List.wrap()
        |> Enum.find(&(&1["name"] == edge["source_port"]))
        |> case do
          %{"schema" => schema} -> schema
          _ -> nil
        end
    end
  end

  defp err(code, message, details) do
    %{code: code, message: message, details: stringify_details(details)}
  end

  defp stringify_details(details) do
    details
    |> Enum.map(fn {k, v} -> {to_string(k), v} end)
    |> Map.new()
  end

  defp present_string?(value), do: is_binary(value) and value != ""
end
