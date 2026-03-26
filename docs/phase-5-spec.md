# Phase 5 Spec: Cooperative Multi-Model Pipelines

## Goal

Phase 5 adds one focused capability: users can build graphs where multiple ML model nodes cooperate in a single inference pipeline.

This phase is not about distributed infrastructure, cluster scheduling, or production ML ops. It is about making the canvas support layered model reasoning as a first-class user workflow.

## End-User Promise

A user can connect multiple model nodes together so that:

- one model can consume raw sensor data
- another model can consume the output of an earlier model
- multiple model outputs can be merged into a later decision step
- the graph produces a higher-level prediction than any one model alone

Example:

- `Generator.Bluetooth` -> `Modifier.Classifier` (`gesture`)
- `Generator.Audio` -> `Modifier.Classifier` (`sound`)
- `Modifier.Fusion` combines gesture + sound
- `Consumer.Spotify` triggers an action only when the fused result matches a configured condition

## User Stories

- As a user, I can place more than one model node on the canvas and wire them together.
- As a user, I can tell which model consumes raw sensor packets and which model consumes upstream model outputs.
- As a user, I can inspect each stage of the pipeline and understand intermediate predictions.
- As a user, I can chain model outputs into a final action without writing code.

## In Scope

- Multiple model-capable nodes in one graph
- Model-to-model packet routing
- Typed schemas for intermediate prediction packets
- UI visibility into intermediate outputs
- Orchestrator/runtime support for chained inference
- Minimal fusion/aggregation node support for combining upstream ML outputs

## Out Of Scope

- Multi-machine runtime scheduling
- Persistent distributed model registry
- Real-time collaborative training across devices
- General-purpose DAG compute engine
- Full multimodal training workflows for every possible modality

## Node Model

Phase 5 keeps `Modifier.Classifier` and adds one new node family:

- `Modifier.Classifier`
  - can consume raw packets such as `vector/3`
  - can emit prediction packets such as `label/string`
- `Modifier.Fusion`
  - can consume two or more upstream prediction packets
  - emits a higher-level prediction packet such as `label/string` or `decision/object`

Optional future node families are explicitly deferred:

- `Modifier.Embedding`
- `Modifier.SequenceModel`
- `Modifier.Router`

## Data Contracts

Phase 5 needs at least these intermediate schemas:

- `label/string`
  - `{ "label": "clockwise", "confidence": 0.94 }`
- `label/discrete`
  - `{ "label": "speech", "confidence": 0.88, "source": "audio_model" }`
- `decision/object`
  - `{ "label": "commuting", "confidence": 0.91, "inputs": [...] }`

Contract rules:

- every model output packet must include a confidence score when applicable
- downstream nodes must validate that required fields exist before acting
- model-to-model edges must remain schema-compatible under the same server-side DAG rules used elsewhere

## Runtime Semantics

Phase 5 introduces two execution patterns:

1. Sequential chained inference
   - Model A emits a prediction packet
   - Model B consumes that prediction packet
   - Model B emits a refined prediction

2. Windowed fusion
   - Two upstream model outputs are buffered
   - A fusion node waits for a compatible pair or short window of packets
   - The fusion node emits a final higher-level label

The orchestrator remains the graph coordinator and routing authority.

The execution engine remains the place where ML or adapter logic runs.

## UX Requirements

- The node palette must expose multiple model nodes clearly.
- The inspector must show:
  - model role
  - expected input schema
  - emitted output schema
  - latest prediction
  - confidence
  - upstream dependencies
- Users must be able to distinguish:
  - raw sensor nodes
  - model nodes
  - fusion nodes
  - action nodes

## Failure Handling

- A downstream model failure must not crash the graph.
- Failed model nodes surface `error` state and last error message in the UI.
- Upstream packet flow continues unless a node is explicitly configured as blocking.
- Fusion timeout or missing-input conditions should produce visible diagnostics instead of silent failure.

## Success Criteria

Phase 5 is complete when:

- a user can place at least two model nodes in one graph
- at least one model node can consume the output of another model node
- the UI shows intermediate predictions for each stage
- the final downstream action can depend on a multi-model result
- tests cover schema validation, chained inference, and fusion/failure behavior

## Demo Scenario

The reference demo for Phase 5 is:

1. A motion stream enters a gesture classifier.
2. A second input stream or simulated upstream model emits a contextual label.
3. A fusion node combines both outputs.
4. A Spotify consumer node fires only on the fused label.

This proves cooperative multi-model behavior without requiring full distributed infrastructure.
