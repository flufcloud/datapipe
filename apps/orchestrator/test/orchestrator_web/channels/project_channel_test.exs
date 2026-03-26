defmodule OrchestratorWeb.ProjectChannelTest do
  use OrchestratorWeb.ChannelCase, async: false

  defp message(event, request_id, project_id, payload \\ %{}) do
    %{
      "event" => event,
      "request_id" => request_id,
      "project_id" => project_id,
      "payload" => payload
    }
  end

  defp manual_test_node(id) do
    %{
      "id" => id,
      "type" => "Generator.ManualTest",
      "category" => "Generator",
      "label" => "Manual Input",
      "position" => %{"x" => 120, "y" => 240},
      "configuration" => %{},
      "ports" => %{
        "inputs" => [],
        "outputs" => [%{"name" => "out", "schema" => "vector/3"}]
      },
      "status" => "idle"
    }
  end

  defp classifier_node(id) do
    %{
      "id" => id,
      "type" => "Modifier.Classifier",
      "category" => "Modifier",
      "label" => "Classifier",
      "position" => %{"x" => 360, "y" => 240},
      "configuration" => %{},
      "ports" => %{
        "inputs" => [%{"name" => "in", "schema" => "vector/3"}],
        "outputs" => [%{"name" => "label", "schema" => "label/string"}]
      },
      "status" => "idle"
    }
  end

  defp inferencing_classifier_node(id, labels \\ ["clockwise"]) do
    [positive_label | _] = labels

    classifier_node(id)
    |> Map.put("configuration", %{
      "classifier" => %{
        "dataset" => %{"labels" => labels, "samples" => []},
        "window_size" => 1,
        "epochs" => 20,
        "model_id" => "model_#{positive_label}",
        "inference_window" => []
      }
    })
    |> Map.put("status", "inferencing")
  end

  defp spotify_node(id, spotify_config) do
    %{
      "id" => id,
      "type" => "Consumer.Spotify",
      "category" => "Consumer",
      "label" => "Spotify",
      "position" => %{"x" => 600, "y" => 240},
      "configuration" => %{
        "spotify" =>
          Map.merge(
            %{
              "action" => nil,
              "label_actions" => %{},
              "auth" => %{"status" => "unknown"},
              "last_action" => nil,
              "last_error" => nil,
              "history" => [],
              "processed_packet_ids" => []
            },
            spotify_config
          )
      },
      "ports" => %{
        "inputs" => [%{"name" => "in", "schema" => "label/string"}],
        "outputs" => []
      },
      "status" => "idle"
    }
  end

  defp fusion_node(id, fusion_config \\ %{}) do
    %{
      "id" => id,
      "type" => "Modifier.Fusion",
      "category" => "Modifier",
      "label" => "Fusion",
      "position" => %{"x" => 720, "y" => 180},
      "configuration" => %{
        "fusion" =>
          Map.merge(
            %{
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
            },
            fusion_config
          )
      },
      "ports" => %{
        "inputs" => [
          %{"name" => "left", "schema" => "label/string"},
          %{"name" => "right", "schema" => "label/string"}
        ],
        "outputs" => [%{"name" => "label", "schema" => "label/string"}]
      },
      "status" => "idle"
    }
  end

  defp bluetooth_node(id) do
    %{
      "id" => id,
      "type" => "Generator.Bluetooth",
      "category" => "Generator",
      "label" => "Bluetooth Sensor",
      "position" => %{"x" => 120, "y" => 120},
      "configuration" => %{
        "service_uuid" => "e95d0753-251d-470a-a062-fa1922dfa9a8",
        "characteristic_uuid" => "e95dca4b-251d-470a-a062-fa1922dfa9a8"
      },
      "ports" => %{
        "inputs" => [],
        "outputs" => [%{"name" => "out", "schema" => "vector/3"}]
      },
      "status" => "idle"
    }
  end

  defp pass_node(id) do
    %{
      "id" => id,
      "type" => "Modifier.PassThrough",
      "category" => "Modifier",
      "label" => "Pass Through",
      "position" => %{"x" => 240, "y" => 240},
      "configuration" => %{},
      "ports" => %{
        "inputs" => [%{"name" => "in", "schema" => "vector/3"}],
        "outputs" => [%{"name" => "out", "schema" => "vector/3"}]
      },
      "status" => "idle"
    }
  end

  setup do
    Orchestrator.TestSupport.FakeExecutionEngineClient.reset!()

    project_id = "proj_#{System.unique_integer([:positive, :monotonic])}_#{System.system_time(:microsecond)}"

    {:ok, _, socket} =
      subscribe_and_join(
        socket(OrchestratorWeb.UserSocket),
        OrchestratorWeb.ProjectChannel,
        "project:#{project_id}"
      )

    assert_push "graph:updated", %{
             "event" => "graph:updated",
             "request_id" => nil,
             "project_id" => ^project_id,
             "payload" => %{
               "graph" => %{
                 "project" => %{
                   "id" => ^project_id,
                   "name" => "Untitled Project",
                   "version" => 1
                 },
                 "nodes" => [],
                 "edges" => []
               }
             }
           }

    %{socket: socket, project_id: project_id}
  end

  test "join pushes the canonical empty graph", %{socket: socket, project_id: project_id} do
    assert socket.topic == "project:#{project_id}"
  end

  test "graph:init returns the current canonical graph", %{socket: socket, project_id: project_id} do
    push(socket, "graph:init", message("graph:init", "req_init", project_id))

    assert_push "graph:updated", %{
             "event" => "graph:updated",
             "request_id" => "req_init",
             "project_id" => ^project_id,
             "payload" => %{
               "graph" => %{
                 "project" => %{"id" => ^project_id, "name" => "Untitled Project", "version" => 1},
                 "nodes" => [],
                 "edges" => []
               }
             }
           }
  end

  test "node:create broadcasts the canonical graph snapshot", %{socket: socket, project_id: project_id} do
    push(
      socket,
      "node:create",
      message("node:create", "req_create", project_id, manual_test_node("node_1"))
    )

    assert_broadcast "graph:updated", %{
             "event" => "graph:updated",
             "request_id" => "req_create",
             "project_id" => ^project_id,
             "payload" => %{
               "graph" => %{
                 "project" => %{"id" => ^project_id, "name" => "Untitled Project", "version" => 1},
                 "nodes" => [node],
                 "edges" => []
               }
             }
           }

    assert node == manual_test_node("node_1")
  end

  test "node:update_position rewrites node coordinates in the canonical graph", %{
    socket: socket,
    project_id: project_id
  } do
    push(
      socket,
      "node:create",
      message("node:create", "req_create", project_id, manual_test_node("node_1"))
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_create"}

    push(
      socket,
      "node:update_position",
      message("node:update_position", "req_move", project_id, %{
        "id" => "node_1",
        "position" => %{"x" => 400, "y" => 500}
      })
    )

    assert_broadcast "graph:updated", %{
             "event" => "graph:updated",
             "request_id" => "req_move",
             "project_id" => ^project_id,
             "payload" => %{
               "graph" => %{
                 "nodes" => [
                   %{
                     "id" => "node_1",
                     "position" => %{"x" => 400, "y" => 500}
                   } = moved_node
                 ]
               }
             }
           }

    assert moved_node["type"] == "Generator.ManualTest"
  end

  test "edge:create broadcasts a new canonical edge when ports are compatible", %{
    socket: socket,
    project_id: project_id
  } do
    push(socket, "node:create", message("node:create", "req_a", project_id, manual_test_node("node_a")))
    assert_broadcast "graph:updated", %{"request_id" => "req_a"}

    push(socket, "node:create", message("node:create", "req_b", project_id, classifier_node("node_b")))
    assert_broadcast "graph:updated", %{"request_id" => "req_b"}

    push(
      socket,
      "edge:create",
      message("edge:create", "req_edge", project_id, %{
        "id" => "edge_a_b",
        "source_id" => "node_a",
        "source_port" => "out",
        "target_id" => "node_b",
        "target_port" => "in"
      })
    )

    assert_broadcast "graph:updated", %{
             "request_id" => "req_edge",
             "payload" => %{"graph" => %{"edges" => [%{"id" => "edge_a_b"} = edge]}}
           }

    assert edge["source_id"] == "node_a"
    assert edge["target_id"] == "node_b"
  end

  test "edge:create rejects cyclic edges with structured errors", %{socket: socket, project_id: project_id} do
    push(socket, "node:create", message("node:create", "req_a", project_id, pass_node("node_a")))
    assert_broadcast "graph:updated", %{"request_id" => "req_a"}

    push(socket, "node:create", message("node:create", "req_b", project_id, pass_node("node_b")))
    assert_broadcast "graph:updated", %{"request_id" => "req_b"}

    push(socket, "node:create", message("node:create", "req_c", project_id, pass_node("node_c")))
    assert_broadcast "graph:updated", %{"request_id" => "req_c"}

    push(
      socket,
      "edge:create",
      message("edge:create", "req_ab", project_id, %{
        "id" => "edge_a_b",
        "source_id" => "node_a",
        "source_port" => "out",
        "target_id" => "node_b",
        "target_port" => "in"
      })
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_ab"}

    push(
      socket,
      "edge:create",
      message("edge:create", "req_bc", project_id, %{
        "id" => "edge_b_c",
        "source_id" => "node_b",
        "source_port" => "out",
        "target_id" => "node_c",
        "target_port" => "in"
      })
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_bc"}

    push(
      socket,
      "edge:create",
      message("edge:create", "req_cycle", project_id, %{
        "id" => "edge_c_a",
        "source_id" => "node_c",
        "source_port" => "out",
        "target_id" => "node_a",
        "target_port" => "in"
      })
    )

    assert_push "error", %{
      "event" => "error",
      "request_id" => "req_cycle",
      "project_id" => ^project_id,
      "payload" => %{
        "code" => "cycle_detected",
        "message" => "Edge creation would introduce a cycle",
        "details" => %{}
      }
    }
  end

  test "packet:ingest broadcasts packet observations with route targets", %{
    socket: socket,
    project_id: project_id
  } do
    push(socket, "node:create", message("node:create", "req_src", project_id, bluetooth_node("node_bt")))
    assert_broadcast "graph:updated", %{"request_id" => "req_src"}

    push(socket, "node:create", message("node:create", "req_dst", project_id, classifier_node("node_classifier")))
    assert_broadcast "graph:updated", %{"request_id" => "req_dst"}

    push(
      socket,
      "edge:create",
      message("edge:create", "req_edge", project_id, %{
        "id" => "edge_bt_classifier",
        "source_id" => "node_bt",
        "source_port" => "out",
        "target_id" => "node_classifier",
        "target_port" => "in"
      })
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_edge"}

    push(
      socket,
      "packet:ingest",
      message("packet:ingest", "req_packet", project_id, %{
        "packet_id" => "pkt_1",
        "project_id" => project_id,
        "node_id" => "node_bt",
        "timestamp" => "2026-03-19T12:00:00.000Z",
        "schema" => "vector/3",
        "payload" => %{"x" => 0.1, "y" => -0.2, "z" => 0.9}
      })
    )

    assert_broadcast "packet:observed", %{
             "event" => "packet:observed",
             "request_id" => "req_packet",
             "project_id" => ^project_id,
             "payload" => %{
               "packet" => %{
                 "packet_id" => "pkt_1",
                 "node_id" => "node_bt",
                 "schema" => "vector/3"
               },
               "route_targets" => [
                 %{
                   "node_id" => "node_classifier",
                   "source_port" => "out",
                   "target_port" => "in"
                 }
               ]
             }
           }
  end

  test "packet:ingest rejects malformed vector payloads", %{socket: socket, project_id: project_id} do
    push(socket, "node:create", message("node:create", "req_src", project_id, bluetooth_node("node_bt")))
    assert_broadcast "graph:updated", %{"request_id" => "req_src"}

    push(
      socket,
      "packet:ingest",
      message("packet:ingest", "req_bad_packet", project_id, %{
        "packet_id" => "pkt_bad",
        "project_id" => project_id,
        "node_id" => "node_bt",
        "timestamp" => "2026-03-19T12:00:00.000Z",
        "schema" => "vector/3",
        "payload" => %{"x" => 0.1, "z" => 0.9}
      })
    )

    assert_push "error", %{
      "event" => "error",
      "request_id" => "req_bad_packet",
      "project_id" => ^project_id,
      "payload" => %{
        "code" => "invalid_payload",
        "message" => "Packet payload does not match schema",
        "details" => %{"schema" => "vector/3"}
      }
    }
  end

  test "classifier recording and training transition to inferencing", %{
    socket: socket,
    project_id: project_id
  } do
    push(socket, "node:create", message("node:create", "req_bt", project_id, bluetooth_node("node_bt")))
    assert_broadcast "graph:updated", %{"request_id" => "req_bt"}

    push(socket, "node:create", message("node:create", "req_classifier", project_id, classifier_node("node_classifier")))
    assert_broadcast "graph:updated", %{"request_id" => "req_classifier"}

    push(
      socket,
      "edge:create",
      message("edge:create", "req_edge", project_id, %{
        "id" => "edge_bt_classifier_train",
        "source_id" => "node_bt",
        "source_port" => "out",
        "target_id" => "node_classifier",
        "target_port" => "in"
      })
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_edge"}

    push(
      socket,
      "classifier:record_start",
      message("classifier:record_start", "req_record_start", project_id, %{
        "id" => "node_classifier",
        "label" => "clockwise"
      })
    )

    assert_receive %Phoenix.Socket.Broadcast{
      event: "graph:updated",
      payload: %{
        "request_id" => "req_record_start",
        "payload" => %{"graph" => %{"nodes" => nodes}}
      }
    }

    assert Enum.any?(nodes, &(&1["id"] == "node_classifier" and &1["status"] == "recording"))

    push(
      socket,
      "packet:ingest",
      message("packet:ingest", "req_packet", project_id, %{
        "packet_id" => "pkt_classifier_record",
        "project_id" => project_id,
        "node_id" => "node_bt",
        "timestamp" => "2026-03-19T12:00:00.000Z",
        "schema" => "vector/3",
        "payload" => %{"x" => 0.1, "y" => 0.2, "z" => 0.3}
      })
    )

    push(
      socket,
      "classifier:record_stop",
      message("classifier:record_stop", "req_record_stop", project_id, %{"id" => "node_classifier"})
    )

    assert_receive %Phoenix.Socket.Broadcast{
      event: "graph:updated",
      payload: %{
        "request_id" => "req_record_stop",
        "payload" => %{"graph" => %{"nodes" => stopped_nodes}}
      }
    }

    classifier_after_stop = Enum.find(stopped_nodes, &(&1["id"] == "node_classifier"))
    assert classifier_after_stop["status"] == "idle"
    assert get_in(classifier_after_stop, ["configuration", "classifier", "dataset", "labels"]) == ["clockwise"]
    assert length(get_in(classifier_after_stop, ["configuration", "classifier", "dataset", "samples"])) == 1

    push(
      socket,
      "classifier:train",
      message("classifier:train", "req_train", project_id, %{"id" => "node_classifier"})
    )

    assert_receive %Phoenix.Socket.Broadcast{
      event: "graph:updated",
      payload: %{
        "request_id" => "req_train",
        "payload" => %{"graph" => %{"nodes" => training_nodes}}
      }
    }

    assert Enum.any?(training_nodes, &(&1["id"] == "node_classifier" and &1["status"] == "training"))

    Process.sleep(40)

    assert_push "graph:updated", %{
      "request_id" => "training:completed",
      "payload" => %{"graph" => %{"nodes" => completed_nodes}}
    }

    classifier_after_training = Enum.find(completed_nodes, &(&1["id"] == "node_classifier"))
    assert classifier_after_training["status"] == "inferencing"
    assert is_binary(get_in(classifier_after_training, ["configuration", "classifier", "model_id"]))
  end

  test "classifier label packets trigger Consumer.Spotify and broadcast canonical graph updates", %{
    socket: socket,
    project_id: project_id
  } do
    push(socket, "node:create", message("node:create", "req_bt", project_id, bluetooth_node("node_bt")))
    assert_broadcast "graph:updated", %{"request_id" => "req_bt"}

    push(
      socket,
      "node:create",
      message("node:create", "req_classifier", project_id, inferencing_classifier_node("node_classifier"))
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_classifier"}

    push(
      socket,
      "node:create",
      message(
        "node:create",
        "req_spotify",
        project_id,
        spotify_node("node_spotify", %{"label_actions" => %{"clockwise" => "next_track"}})
      )
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_spotify"}

    push(
      socket,
      "edge:create",
      message("edge:create", "req_edge_1", project_id, %{
        "id" => "edge_bt_classifier_spotify",
        "source_id" => "node_bt",
        "source_port" => "out",
        "target_id" => "node_classifier",
        "target_port" => "in"
      })
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_edge_1"}

    push(
      socket,
      "edge:create",
      message("edge:create", "req_edge_2", project_id, %{
        "id" => "edge_classifier_spotify",
        "source_id" => "node_classifier",
        "source_port" => "label",
        "target_id" => "node_spotify",
        "target_port" => "in"
      })
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_edge_2"}

    push(
      socket,
      "packet:ingest",
      message("packet:ingest", "req_packet", project_id, %{
        "packet_id" => "pkt_spotify_success",
        "project_id" => project_id,
        "node_id" => "node_bt",
        "timestamp" => "2026-03-19T12:00:00.000Z",
        "schema" => "vector/3",
        "payload" => %{"x" => 0.25, "y" => 0.1, "z" => -0.3}
      })
    )

    assert_broadcast "packet:observed", %{
             "request_id" => "req_packet",
             "payload" => %{
               "packet" => %{"packet_id" => "pkt_spotify_success", "node_id" => "node_bt", "schema" => "vector/3"},
               "route_targets" => [%{"node_id" => "node_classifier"}]
             }
           }

    assert_broadcast "packet:observed", %{
             "request_id" => "req_packet",
             "payload" => %{
               "packet" => %{
                 "packet_id" => "pkt_classifier:node_classifier:pkt_spotify_success",
                 "node_id" => "node_classifier",
                 "schema" => "label/string",
                 "payload" => %{"label" => "clockwise"}
               },
               "route_targets" => [%{"node_id" => "node_spotify"}]
             }
           }

    assert_broadcast "graph:updated", %{
             "request_id" => "req_packet",
             "payload" => %{"graph" => %{"nodes" => nodes}}
           }

    spotify = Enum.find(nodes, &(&1["id"] == "node_spotify"))
    assert spotify["status"] == "triggered"
    assert get_in(spotify, ["configuration", "spotify", "last_action", "action"]) == "next_track"
    assert get_in(spotify, ["configuration", "spotify", "last_action", "status"]) == "ok"
    assert get_in(spotify, ["configuration", "spotify", "last_error"]) == nil
    assert length(get_in(spotify, ["configuration", "spotify", "history"])) == 1
    assert length(Orchestrator.TestSupport.FakeExecutionEngineClient.spotify_calls()) == 1
  end

  test "cooperative classifier outputs can fuse into a downstream Spotify action", %{
    socket: socket,
    project_id: project_id
  } do
    push(socket, "node:create", message("node:create", "req_bt", project_id, bluetooth_node("node_bt")))
    assert_broadcast "graph:updated", %{"request_id" => "req_bt"}

    push(
      socket,
      "node:create",
      message("node:create", "req_classifier_gesture", project_id, inferencing_classifier_node("node_gesture"))
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_classifier_gesture"}

    push(
      socket,
      "node:create",
      message(
        "node:create",
        "req_classifier_context",
        project_id,
        inferencing_classifier_node("node_context", ["active"])
      )
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_classifier_context"}

    push(
      socket,
      "node:create",
      message("node:create", "req_fusion", project_id, fusion_node("node_fusion"))
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_fusion"}

    push(
      socket,
      "node:create",
      message(
        "node:create",
        "req_spotify",
        project_id,
        spotify_node("node_spotify", %{"label_actions" => %{"music_control" => "next_track"}})
      )
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_spotify"}

    for {request_id, edge} <- [
          {"req_edge_1",
           %{
             "id" => "edge_bt_gesture",
             "source_id" => "node_bt",
             "source_port" => "out",
             "target_id" => "node_gesture",
             "target_port" => "in"
           }},
          {"req_edge_2",
           %{
             "id" => "edge_bt_context",
             "source_id" => "node_bt",
             "source_port" => "out",
             "target_id" => "node_context",
             "target_port" => "in"
           }},
          {"req_edge_3",
           %{
             "id" => "edge_gesture_fusion",
             "source_id" => "node_gesture",
             "source_port" => "label",
             "target_id" => "node_fusion",
             "target_port" => "left"
           }},
          {"req_edge_4",
           %{
             "id" => "edge_context_fusion",
             "source_id" => "node_context",
             "source_port" => "label",
             "target_id" => "node_fusion",
             "target_port" => "right"
           }},
          {"req_edge_5",
           %{
             "id" => "edge_fusion_spotify",
             "source_id" => "node_fusion",
             "source_port" => "label",
             "target_id" => "node_spotify",
             "target_port" => "in"
           }}
        ] do
      push(socket, "edge:create", message("edge:create", request_id, project_id, edge))
      assert_broadcast "graph:updated", %{"request_id" => ^request_id}
    end

    push(
      socket,
      "packet:ingest",
      message("packet:ingest", "req_packet", project_id, %{
        "packet_id" => "pkt_fusion_success",
        "project_id" => project_id,
        "node_id" => "node_bt",
        "timestamp" => "2026-03-19T12:00:00.000Z",
        "schema" => "vector/3",
        "payload" => %{"x" => 0.45, "y" => 0.1, "z" => -0.2}
      })
    )

    assert_receive %Phoenix.Socket.Message{
                     event: "packet:observed",
                     payload: %{
                       "request_id" => "req_packet",
                       "payload" => %{
                         "packet" => %{"packet_id" => "pkt_fusion_success", "node_id" => "node_bt"},
                         "route_targets" => route_targets
                       }
                     }
                   }

    assert Enum.sort(Enum.map(route_targets, & &1["node_id"])) == ["node_context", "node_gesture"]

    assert_receive %Phoenix.Socket.Message{event: "packet:observed", payload: %{"request_id" => "req_packet"}}
    assert_receive %Phoenix.Socket.Message{event: "packet:observed", payload: %{"request_id" => "req_packet"}}
    assert_receive %Phoenix.Socket.Message{event: "packet:observed", payload: %{"request_id" => "req_packet"}}

    assert_receive %Phoenix.Socket.Message{event: "graph:updated", payload: %{"request_id" => "req_packet"}}

    stored_graph = Orchestrator.GraphStore.get(project_id)
    nodes = stored_graph["nodes"]
    fusion = Enum.find(nodes, &(&1["id"] == "node_fusion"))
    spotify = Enum.find(nodes, &(&1["id"] == "node_spotify"))

    assert fusion["status"] == "ready"
    assert get_in(fusion, ["configuration", "fusion", "last_output", "label"]) == "music_control"
    assert get_in(fusion, ["configuration", "fusion", "last_error"]) == nil
    assert spotify["status"] == "triggered"
    assert get_in(spotify, ["configuration", "spotify", "last_action", "action"]) == "next_track"
    assert length(Orchestrator.TestSupport.FakeExecutionEngineClient.spotify_calls()) == 1
  end

  test "fusion nodes surface waiting diagnostics when a required upstream model is missing", %{
    socket: socket,
    project_id: project_id
  } do
    push(socket, "node:create", message("node:create", "req_bt", project_id, bluetooth_node("node_bt")))
    assert_broadcast "graph:updated", %{"request_id" => "req_bt"}

    push(
      socket,
      "node:create",
      message("node:create", "req_classifier", project_id, inferencing_classifier_node("node_gesture"))
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_classifier"}

    push(
      socket,
      "node:create",
      message("node:create", "req_fusion", project_id, fusion_node("node_fusion"))
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_fusion"}

    push(
      socket,
      "edge:create",
      message("edge:create", "req_edge_1", project_id, %{
        "id" => "edge_bt_gesture_waiting",
        "source_id" => "node_bt",
        "source_port" => "out",
        "target_id" => "node_gesture",
        "target_port" => "in"
      })
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_edge_1"}

    push(
      socket,
      "edge:create",
      message("edge:create", "req_edge_2", project_id, %{
        "id" => "edge_gesture_fusion_waiting",
        "source_id" => "node_gesture",
        "source_port" => "label",
        "target_id" => "node_fusion",
        "target_port" => "left"
      })
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_edge_2"}

    push(
      socket,
      "packet:ingest",
      message("packet:ingest", "req_packet", project_id, %{
        "packet_id" => "pkt_fusion_waiting",
        "project_id" => project_id,
        "node_id" => "node_bt",
        "timestamp" => "2026-03-19T12:00:00.000Z",
        "schema" => "vector/3",
        "payload" => %{"x" => 0.45, "y" => 0.1, "z" => -0.2}
      })
    )

    assert_receive %Phoenix.Socket.Message{event: "packet:observed", payload: %{"request_id" => "req_packet"}}
    assert_receive %Phoenix.Socket.Message{event: "packet:observed", payload: %{"request_id" => "req_packet"}}

    assert_receive %Phoenix.Socket.Message{event: "graph:updated", payload: %{"request_id" => "req_packet"}}

    nodes = Orchestrator.GraphStore.get(project_id)["nodes"]
    fusion = Enum.find(nodes, &(&1["id"] == "node_fusion"))
    fusion_error = get_in(fusion, ["configuration", "fusion", "last_error"])

    assert fusion["status"] == "waiting"
    assert get_in(fusion, ["configuration", "fusion", "last_output"]) == nil
    assert (Map.get(fusion_error, "code") || fusion_error[:code]) == "awaiting_inputs"
    assert length(Orchestrator.TestSupport.FakeExecutionEngineClient.spotify_calls()) == 0
  end

  test "Consumer.Spotify failures are surfaced in graph state without crashing packet flow", %{
    socket: socket,
    project_id: project_id
  } do
    Orchestrator.TestSupport.FakeExecutionEngineClient.fail_next_spotify_action()

    push(socket, "node:create", message("node:create", "req_bt", project_id, bluetooth_node("node_bt")))
    assert_broadcast "graph:updated", %{"request_id" => "req_bt"}

    push(
      socket,
      "node:create",
      message("node:create", "req_classifier", project_id, inferencing_classifier_node("node_classifier"))
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_classifier"}

    push(
      socket,
      "node:create",
      message(
        "node:create",
        "req_spotify",
        project_id,
        spotify_node("node_spotify", %{"label_actions" => %{"clockwise" => "next_track"}})
      )
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_spotify"}

    push(
      socket,
      "edge:create",
      message("edge:create", "req_edge_1", project_id, %{
        "id" => "edge_bt_classifier_spotify_fail",
        "source_id" => "node_bt",
        "source_port" => "out",
        "target_id" => "node_classifier",
        "target_port" => "in"
      })
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_edge_1"}

    push(
      socket,
      "edge:create",
      message("edge:create", "req_edge_2", project_id, %{
        "id" => "edge_classifier_spotify_fail",
        "source_id" => "node_classifier",
        "source_port" => "label",
        "target_id" => "node_spotify",
        "target_port" => "in"
      })
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_edge_2"}

    push(
      socket,
      "packet:ingest",
      message("packet:ingest", "req_packet", project_id, %{
        "packet_id" => "pkt_spotify_failure",
        "project_id" => project_id,
        "node_id" => "node_bt",
        "timestamp" => "2026-03-19T12:00:00.000Z",
        "schema" => "vector/3",
        "payload" => %{"x" => 0.25, "y" => 0.1, "z" => -0.3}
      })
    )

    assert_broadcast "packet:observed", %{"request_id" => "req_packet"}
    assert_broadcast "packet:observed", %{"request_id" => "req_packet"}

    assert_broadcast "graph:updated", %{
             "request_id" => "req_packet",
             "payload" => %{"graph" => %{"nodes" => nodes}}
           }

    spotify = Enum.find(nodes, &(&1["id"] == "node_spotify"))
    assert spotify["status"] == "error"
    assert get_in(spotify, ["configuration", "spotify", "last_error", "code"]) == "spotify_action_failed"
    assert get_in(spotify, ["configuration", "spotify", "last_action", "status"]) == "error"
    assert length(Orchestrator.TestSupport.FakeExecutionEngineClient.spotify_calls()) == 1
    refute_receive %Phoenix.Socket.Message{event: "error"}, 50
  end

  test "Consumer.Spotify ignores duplicate classifier packets without crashing", %{
    socket: socket,
    project_id: project_id
  } do
    push(socket, "node:create", message("node:create", "req_bt", project_id, bluetooth_node("node_bt")))
    assert_broadcast "graph:updated", %{"request_id" => "req_bt"}

    push(
      socket,
      "node:create",
      message("node:create", "req_classifier", project_id, inferencing_classifier_node("node_classifier"))
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_classifier"}

    push(
      socket,
      "node:create",
      message(
        "node:create",
        "req_spotify",
        project_id,
        spotify_node("node_spotify", %{"label_actions" => %{"clockwise" => "next_track"}})
      )
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_spotify"}

    push(
      socket,
      "edge:create",
      message("edge:create", "req_edge_1", project_id, %{
        "id" => "edge_bt_classifier_spotify_dupe",
        "source_id" => "node_bt",
        "source_port" => "out",
        "target_id" => "node_classifier",
        "target_port" => "in"
      })
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_edge_1"}

    push(
      socket,
      "edge:create",
      message("edge:create", "req_edge_2", project_id, %{
        "id" => "edge_classifier_spotify_dupe",
        "source_id" => "node_classifier",
        "source_port" => "label",
        "target_id" => "node_spotify",
        "target_port" => "in"
      })
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_edge_2"}

    packet_payload = %{
      "packet_id" => "pkt_spotify_duplicate",
      "project_id" => project_id,
      "node_id" => "node_bt",
      "timestamp" => "2026-03-19T12:00:00.000Z",
      "schema" => "vector/3",
      "payload" => %{"x" => 0.25, "y" => 0.1, "z" => -0.3}
    }

    push(socket, "packet:ingest", message("packet:ingest", "req_packet_1", project_id, packet_payload))
    assert_broadcast "packet:observed", %{"request_id" => "req_packet_1"}
    assert_broadcast "packet:observed", %{"request_id" => "req_packet_1"}
    assert_broadcast "graph:updated", %{"request_id" => "req_packet_1"}

    push(socket, "packet:ingest", message("packet:ingest", "req_packet_2", project_id, packet_payload))
    assert_broadcast "packet:observed", %{"request_id" => "req_packet_2"}
    assert_broadcast "packet:observed", %{"request_id" => "req_packet_2"}
    refute_receive %Phoenix.Socket.Broadcast{
                     event: "graph:updated",
                     payload: %{"request_id" => "req_packet_2"}
                   },
                   50

    refute_receive %Phoenix.Socket.Message{event: "error"}, 50

    spotify_calls = Orchestrator.TestSupport.FakeExecutionEngineClient.spotify_calls()
    assert length(spotify_calls) == 1
    assert hd(spotify_calls)["idempotency_key"] == "pkt_classifier:node_classifier:pkt_spotify_duplicate"
  end

  test "consumer:spotify_connect persists auth state on the canonical node", %{
    socket: socket,
    project_id: project_id
  } do
    push(
      socket,
      "node:create",
      message("node:create", "req_spotify", project_id, spotify_node("node_spotify", %{}))
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_spotify"}

    push(
      socket,
      "consumer:spotify_connect",
      message("consumer:spotify_connect", "req_spotify_connect", project_id, %{"id" => "node_spotify"})
    )

    assert_broadcast "graph:updated", %{
             "request_id" => "req_spotify_connect",
             "payload" => %{"graph" => %{"nodes" => nodes}}
           }

    spotify = Enum.find(nodes, &(&1["id"] == "node_spotify"))
    assert spotify["status"] == "idle"
    assert get_in(spotify, ["configuration", "spotify", "auth", "status"]) == "connected"
    assert get_in(spotify, ["configuration", "spotify", "auth", "connection", "connected"]) == true
  end

  test "consumer:spotify_auth_state reads current auth state into the canonical node", %{
    socket: socket,
    project_id: project_id
  } do
    push(
      socket,
      "node:create",
      message("node:create", "req_spotify", project_id, spotify_node("node_spotify", %{}))
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_spotify"}
    {:ok, _response} = Orchestrator.TestSupport.FakeExecutionEngineClient.connect_spotify(project_id)

    push(
      socket,
      "consumer:spotify_auth_state",
      message("consumer:spotify_auth_state", "req_spotify_auth", project_id, %{"id" => "node_spotify"})
    )

    assert_broadcast "graph:updated", %{
             "request_id" => "req_spotify_auth",
             "payload" => %{"graph" => %{"nodes" => nodes}}
           }

    spotify = Enum.find(nodes, &(&1["id"] == "node_spotify"))
    assert get_in(spotify, ["configuration", "spotify", "auth", "status"]) == "connected"
    assert get_in(spotify, ["configuration", "spotify", "auth", "connection", "account", "display_name"]) ==
             "Local Mock Spotify"
  end

  test "consumer:spotify_connect failure still broadcasts canonical error state", %{
    socket: socket,
    project_id: project_id
  } do
    Orchestrator.TestSupport.FakeExecutionEngineClient.fail_next_spotify_connect()

    push(
      socket,
      "node:create",
      message("node:create", "req_spotify", project_id, spotify_node("node_spotify", %{}))
    )

    assert_broadcast "graph:updated", %{"request_id" => "req_spotify"}

    push(
      socket,
      "consumer:spotify_connect",
      message("consumer:spotify_connect", "req_spotify_connect_fail", project_id, %{"id" => "node_spotify"})
    )

    assert_broadcast "graph:updated", %{
             "request_id" => "req_spotify_connect_fail",
             "payload" => %{"graph" => %{"nodes" => nodes}}
           }

    assert_push "error", %{
             "request_id" => "req_spotify_connect_fail",
             "payload" => %{"code" => "spotify_connect_failed"}
           }

    spotify = Enum.find(nodes, &(&1["id"] == "node_spotify"))
    assert spotify["status"] == "error"
    assert get_in(spotify, ["configuration", "spotify", "last_error", "code"]) == "spotify_connect_failed"
    assert get_in(spotify, ["configuration", "spotify", "history", Access.at(0), "status"]) == "error"
  end
end
