import { describe, expect, it } from "vitest";
import {
  createDefaultSpotifyConfiguration,
  getSpotifyActionLabel,
  getSpotifyConsumerState,
} from "./spotifyConsumer";

const baseNode = {
  id: "node_spotify",
  type: "Consumer.Spotify",
  category: "Consumer",
  label: "Spotify Control",
  position: { x: 240, y: 160 },
  configuration: {},
  ports: {
    inputs: [{ name: "in", schema: "label/string" }],
    outputs: [],
  },
  status: "idle",
};

describe("spotifyConsumer", () => {
  it("creates a default Spotify configuration for new nodes", () => {
    expect(createDefaultSpotifyConfiguration()).toEqual({
      spotify: {
        action: "next_track",
      },
    });
  });

  it("normalizes canonical auth, connection, and action history details", () => {
    const state = getSpotifyConsumerState({
      ...baseNode,
      configuration: {
        spotify: {
          action: "play_pause",
          auth_state: {
            connected: true,
            display_name: "Study Session",
          },
          connection_state: {
            status: "device_active",
          },
          recent_attempts: [
            {
              action: "play_pause",
              status: "succeeded",
              message: "Playback toggled",
              timestamp: "2026-03-19T12:00:00.000Z",
              request_id: "pkt_123",
            },
          ],
        },
      },
    });

    expect(state.action).toBe("play_pause");
    expect(state.authStatus).toBe("Authorized");
    expect(state.connectionStatus).toBe("Device Active");
    expect(state.accountLabel).toBe("Study Session");
    expect(state.isConnected).toBe(true);
    expect(state.requiresAuthorization).toBe(false);
    expect(state.lastAttempt).toEqual({
      action: "play_pause",
      status: "succeeded",
      message: "Playback toggled",
      timestamp: "2026-03-19T12:00:00.000Z",
      requestId: "pkt_123",
    });
    expect(state.nodeSummary).toBe("Play / Pause · Succeeded");
  });

  it("falls back safely when the canonical action is unsupported", () => {
    const state = getSpotifyConsumerState({
      ...baseNode,
      configuration: {
        spotify: {
          action: "shuffle_queue",
          auth: false,
          history: [
            {
              command: "shuffle_queue",
              ok: false,
              error: { message: "Action not supported" },
            },
          ],
        },
      },
    });

    expect(state.action).toBe("next_track");
    expect(state.configuredAction).toBe("shuffle_queue");
    expect(state.unsupportedAction).toBe("shuffle_queue");
    expect(state.authStatus).toBe("Not connected");
    expect(state.lastAttempt?.message).toBe("Action not supported");
    expect(getSpotifyActionLabel(state.lastAttempt?.action ?? "")).toBe("Shuffle Queue");
  });

  it("exposes pending authorization state and respects canonical attempt ordering", () => {
    const state = getSpotifyConsumerState({
      ...baseNode,
      configuration: {
        spotify: {
          action: "next_track",
          auth: {
            status: "authorization_required",
            authorization_url: "https://accounts.spotify.com/authorize?client_id=abc",
            connection: {
              connected: false,
            },
          },
          history: [
            {
              action: "next_track",
              status: "ok",
              message: "Newest success",
              timestamp: "2026-03-19T12:01:00.000Z",
            },
            {
              action: "previous_track",
              status: "error",
              message: "Older failure",
              timestamp: "2026-03-19T12:00:00.000Z",
            },
          ],
        },
      },
    });

    expect(state.requiresAuthorization).toBe(true);
    expect(state.authorizationUrl).toContain("accounts.spotify.com");
    expect(state.history[0]?.message).toBe("Newest success");
    expect(state.lastAttempt?.message).toBe("Newest success");
  });
});
