import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function createEmptyVault() {
  return {
    connections: {},
  };
}

function validateVaultShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createEmptyVault();
  }

  if (!value.connections || typeof value.connections !== "object" || Array.isArray(value.connections)) {
    return createEmptyVault();
  }

  return value;
}

function keyFor(provider, projectId) {
  return `${provider}:${projectId}`;
}

export function createInMemoryTokenVault(seed = {}) {
  const state = validateVaultShape({
    connections: { ...(seed.connections ?? {}) },
  });

  return {
    async getConnection(provider, projectId) {
      return state.connections[keyFor(provider, projectId)] ?? null;
    },

    async setConnection(provider, projectId, connection) {
      state.connections[keyFor(provider, projectId)] = connection;
      return connection;
    },

    async deleteConnection(provider, projectId) {
      delete state.connections[keyFor(provider, projectId)];
    },
  };
}

export function createLocalTokenVault({
  filePath = path.join(process.cwd(), ".local", "token-vault.json"),
} = {}) {
  /** @type {{ connections: Record<string, unknown> } | null} */
  let cache = null;

  async function readVault() {
    if (cache) {
      return cache;
    }

    try {
      const raw = await readFile(filePath, "utf8");
      cache = validateVaultShape(JSON.parse(raw));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        cache = createEmptyVault();
      } else {
        throw error;
      }
    }

    return cache;
  }

  async function persistVault(nextState) {
    cache = validateVaultShape(nextState);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(cache, null, 2), "utf8");
  }

  return {
    filePath,

    async getConnection(provider, projectId) {
      const vault = await readVault();
      return vault.connections[keyFor(provider, projectId)] ?? null;
    },

    async setConnection(provider, projectId, connection) {
      const vault = await readVault();
      const nextState = {
        ...vault,
        connections: {
          ...vault.connections,
          [keyFor(provider, projectId)]: connection,
        },
      };
      await persistVault(nextState);
      return connection;
    },

    async deleteConnection(provider, projectId) {
      const vault = await readVault();
      const nextConnections = { ...vault.connections };
      delete nextConnections[keyFor(provider, projectId)];
      await persistVault({
        ...vault,
        connections: nextConnections,
      });
    },
  };
}
