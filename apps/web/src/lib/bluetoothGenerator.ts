import { createRequestId } from "./requestId";
import type { Packet } from "../types/websocket";

const MICROBIT_ACCELEROMETER_SERVICE = "e95d0753-251d-470a-a062-fa1922dfa9a8";
const MICROBIT_ACCELEROMETER_DATA = "e95dca4b-251d-470a-a062-fa1922dfa9a8";
const MICROBIT_ACCELEROMETER_PERIOD = "e95dfb24-251d-470a-a062-fa1922dfa9a8";

type PacketCallback = (packet: Packet) => void;
type StatusCallback = (detail: string) => void;

export type BluetoothStreamHandle = {
  stop: () => Promise<void> | void;
};

type BluetoothStreamOptions = {
  projectId: string;
  nodeId: string;
  onPacket: PacketCallback;
  onStatus?: StatusCallback;
};

type BluetoothNavigator = Navigator & {
  bluetooth?: {
    requestDevice: (options: {
      acceptAllDevices: boolean;
      optionalServices: string[];
    }) => Promise<BluetoothDeviceLike>;
  };
};

type BluetoothDeviceLike = {
  name?: string;
  gatt?: {
    connected: boolean;
    connect: () => Promise<BluetoothServerLike>;
    disconnect: () => void;
  };
};

type BluetoothServerLike = {
  getPrimaryService: (serviceUuid: string) => Promise<BluetoothServiceLike>;
};

type BluetoothServiceLike = {
  getCharacteristic: (characteristicUuid: string) => Promise<BluetoothCharacteristicLike>;
};

type BluetoothCharacteristicLike = EventTarget & {
  value?: DataView | null;
  startNotifications: () => Promise<void>;
  stopNotifications: () => Promise<void>;
  writeValue: (value: BufferSource) => Promise<void>;
};

export function browserBluetoothSupported() {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

export function startDemoVectorStream(options: BluetoothStreamOptions): BluetoothStreamHandle {
  const startedAt = Date.now();

  options.onStatus?.("Streaming demo sensor data");

  const intervalId = window.setInterval(() => {
    const t = (Date.now() - startedAt) / 1000;

    options.onPacket(
      buildVectorPacket(options.projectId, options.nodeId, {
        x: round(Math.sin(t) * 0.8),
        y: round(Math.cos(t * 0.8) * 0.7),
        z: round(Math.sin(t * 0.45 + 1.2) * 0.6),
      }),
    );
  }, 150);

  return {
    stop() {
      window.clearInterval(intervalId);
    },
  };
}

export async function startMicrobitStream(
  options: BluetoothStreamOptions,
): Promise<BluetoothStreamHandle> {
  const bluetooth = (navigator as BluetoothNavigator).bluetooth;

  if (!bluetooth) {
    throw new Error("Web Bluetooth is not supported in this browser.");
  }

  options.onStatus?.("Requesting Bluetooth device");

  const device = await bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [MICROBIT_ACCELEROMETER_SERVICE],
  });

  const server = await device.gatt?.connect();
  if (!server) {
    throw new Error("Failed to connect to the Bluetooth device.");
  }

  const service = await server.getPrimaryService(MICROBIT_ACCELEROMETER_SERVICE);
  const dataCharacteristic = await service.getCharacteristic(MICROBIT_ACCELEROMETER_DATA);

  try {
    const periodCharacteristic = await service.getCharacteristic(MICROBIT_ACCELEROMETER_PERIOD);
    const buffer = new Uint8Array([40, 0]);
    await periodCharacteristic.writeValue(buffer);
  } catch {
    options.onStatus?.("Connected to device; using default sample period");
  }

  const handleValue = (event: Event) => {
    const target = asCharacteristic(event.target);
    const value = target?.value;

    if (!value || value.byteLength < 6) {
      return;
    }

    options.onPacket(
      buildVectorPacket(options.projectId, options.nodeId, {
        x: round(value.getInt16(0, true) / 1000),
        y: round(value.getInt16(2, true) / 1000),
        z: round(value.getInt16(4, true) / 1000),
      }),
    );
  };

  await dataCharacteristic.startNotifications();
  dataCharacteristic.addEventListener("characteristicvaluechanged", handleValue);
  options.onStatus?.(`Connected to ${device.name ?? "Bluetooth device"}`);

  return {
    async stop() {
      dataCharacteristic.removeEventListener("characteristicvaluechanged", handleValue);
      try {
        await dataCharacteristic.stopNotifications();
      } catch {
        // Ignore notification teardown errors on disconnect.
      }

      if (device.gatt?.connected) {
        device.gatt.disconnect();
      }
    },
  };
}

function buildVectorPacket(projectId: string, nodeId: string, payload: { x: number; y: number; z: number }): Packet {
  return {
    packet_id: createRequestId("pkt"),
    project_id: projectId,
    node_id: nodeId,
    timestamp: new Date().toISOString(),
    schema: "vector/3",
    payload,
  };
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function asCharacteristic(target: EventTarget | null): BluetoothCharacteristicLike | null {
  if (target === null) {
    return null;
  }

  return target as BluetoothCharacteristicLike;
}
