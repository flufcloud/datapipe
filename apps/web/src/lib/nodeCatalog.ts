import type { GraphNode } from "../types/graph";
import { createDefaultSpotifyConfiguration } from "./spotifyConsumer";

export type NodeTemplate = {
  type: GraphNode["type"];
  category: GraphNode["category"];
  label: GraphNode["label"];
  ports: GraphNode["ports"];
  configuration?: GraphNode["configuration"];
};

export const NODE_TEMPLATES: NodeTemplate[] = [
  {
    type: "Generator.ManualTest",
    category: "Generator",
    label: "Manual Input",
    ports: {
      inputs: [],
      outputs: [{ name: "out", schema: "vector/3" }],
    },
  },
  {
    type: "Generator.Bluetooth",
    category: "Generator",
    label: "Bluetooth Sensor",
    ports: {
      inputs: [],
      outputs: [{ name: "out", schema: "vector/3" }],
    },
  },
  {
    type: "Modifier.Classifier",
    category: "Modifier",
    label: "Classifier",
    ports: {
      inputs: [{ name: "in", schema: "vector/3" }],
      outputs: [{ name: "label", schema: "label/string" }],
    },
  },
  {
    type: "Modifier.Fusion",
    category: "Modifier",
    label: "Fusion",
    configuration: {
      fusion: {
        window_ms: 5000,
        rules: [
          {
            left_label: "clockwise",
            right_label: "active",
            output_label: "music_control",
            confidence: 0.95,
          },
        ],
        latest_inputs: {},
        last_output: null,
        last_error: null,
        last_combination_id: null,
      },
    },
    ports: {
      inputs: [
        { name: "left", schema: "label/string" },
        { name: "right", schema: "label/string" },
      ],
      outputs: [{ name: "label", schema: "label/string" }],
    },
  },
  {
    type: "Consumer.Log",
    category: "Consumer",
    label: "Log",
    ports: {
      inputs: [{ name: "in", schema: "label/string" }],
      outputs: [],
    },
  },
  {
    type: "Consumer.Spotify",
    category: "Consumer",
    label: "Spotify Control",
    configuration: createDefaultSpotifyConfiguration(),
    ports: {
      inputs: [{ name: "in", schema: "label/string" }],
      outputs: [],
    },
  },
];

export function createNodeFromTemplate(
  template: NodeTemplate,
  id: string,
  position: { x: number; y: number },
): GraphNode {
  return {
    id,
    type: template.type,
    category: template.category,
    label: template.label,
    position,
    configuration: structuredClone(template.configuration ?? {}),
    ports: template.ports,
    status: "idle",
  };
}
