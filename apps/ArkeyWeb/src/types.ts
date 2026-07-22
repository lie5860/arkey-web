export type MicroBridgeConnection = "disabled" | "offline" | "connecting" | "ready" | "error";

export interface MicroBridgePort {
  path: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
}

export interface MicroSlotLight {
  slot: number;
  color?: number;
  brightness?: number;
  effect?: number;
  speed?: number;
}

export interface Snapshot {
  web: {
    serverOrigin: string;
    desktop?: boolean;
    alwaysOnTop?: boolean;
    focusCodexAvailable?: boolean;
    focusCodexOnInput?: boolean;
    accessibilityGranted?: boolean;
  };
  hardware: {
    enabled: boolean;
    connection: MicroBridgeConnection;
    configuredPort: string;
    firmwareVersion?: string;
    usbMounted: boolean;
    desktopConnected: boolean;
    slotLights: MicroSlotLight[];
    lastError?: string;
  };
}
