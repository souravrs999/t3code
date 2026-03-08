import type {
  ContextMenuItem,
  DesktopBridge,
  DesktopUpdateActionResult,
  DesktopUpdateState,
} from "@t3tools/contracts";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ─── Auto-zoom for high-DPI displays ──────────────────────────────────────────

const REFERENCE_SHORT_EDGE = 1080;
const AUTO_ZOOM_STEP = 0.25;
const MANUAL_ZOOM_STEP = 0.1;
const MIN_ZOOM_FACTOR = 0.5;
const MAX_ZOOM_FACTOR = 3.0;
const ZOOM_STORAGE_KEY = "t3code:zoom";

/**
 * Compute auto zoom factor from the logical short edge of the display.
 * Logical short edge = physicalShortEdge / scaleFactor.
 * Returns 1.0 for displays at or below 1080p logical height.
 * Snaps to 0.25 increments, capped at 3.0×.
 */
function computeAutoZoomFactor(logicalShortEdge: number): number {
  if (logicalShortEdge <= REFERENCE_SHORT_EDGE) return 1.0;
  const ratio = logicalShortEdge / REFERENCE_SHORT_EDGE;
  return Math.min(Math.round(ratio / AUTO_ZOOM_STEP) * AUTO_ZOOM_STEP, MAX_ZOOM_FACTOR);
}

function clampZoom(value: number): number {
  return Math.min(Math.max(Math.round(value * 100) / 100, MIN_ZOOM_FACTOR), MAX_ZOOM_FACTOR);
}

function loadPersistedZoom(): number | null {
  try {
    const raw = localStorage.getItem(ZOOM_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = parseFloat(raw);
    return isNaN(parsed) ? null : clampZoom(parsed);
  } catch {
    return null;
  }
}

function persistZoom(zoom: number): void {
  try {
    localStorage.setItem(ZOOM_STORAGE_KEY, String(zoom));
  } catch {}
}

function applyCssZoom(zoom: number): void {
  document.documentElement.style.zoom = String(zoom);
}

export async function initAutoZoom(): Promise<void> {
  const { currentMonitor } = await import("@tauri-apps/api/window");
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");

  let autoZoomBaseline = 1.0;
  let hasManualZoom = false;

  async function computeAndStoreBaseline(): Promise<void> {
    try {
      const monitor = await currentMonitor();
      if (!monitor) return;
      const logicalShortEdge =
        Math.min(monitor.size.width, monitor.size.height) / monitor.scaleFactor;
      autoZoomBaseline = computeAutoZoomFactor(logicalShortEdge);
    } catch {}
  }

  await computeAndStoreBaseline();

  const persisted = loadPersistedZoom();
  if (persisted !== null) {
    hasManualZoom = true;
    applyCssZoom(persisted);
  } else {
    applyCssZoom(autoZoomBaseline);
  }

  try {
    const win = getCurrentWebviewWindow();
    win.onScaleChanged(() => {
      if (hasManualZoom) return;
      computeAndStoreBaseline()
        .then(() => applyCssZoom(autoZoomBaseline))
        .catch(() => {});
    }).catch(() => {});
  } catch {}

  listen<string>("menu-action", (event) => {
    const action = event.payload;
    if (action !== "zoom-in" && action !== "zoom-out" && action !== "reset-zoom") return;

    if (action === "reset-zoom") {
      hasManualZoom = false;
      localStorage.removeItem(ZOOM_STORAGE_KEY);
      applyCssZoom(autoZoomBaseline);
      return;
    }

    const currentZoom = loadPersistedZoom() ?? autoZoomBaseline;
    const delta = action === "zoom-in" ? MANUAL_ZOOM_STEP : -MANUAL_ZOOM_STEP;
    const next = clampZoom(currentZoom + delta);
    hasManualZoom = true;
    persistZoom(next);
    applyCssZoom(next);
  }).catch(() => {});
}

// ─── WS URL cache ─────────────────────────────────────────────────────────────

/**
 * Cached WebSocket URL received from the Rust backend.
 * Starts as null and is populated by initTauriBridge().
 */
let cachedWsUrl: string | null = null;

/**
 * Promise guard so we only call invoke("get_ws_url") once even if
 * initTauriBridge() is called multiple times.
 */
let wsUrlPromise: Promise<string | null> | null = null;

async function fetchWsUrl(): Promise<string | null> {
  try {
    const url = await invoke<string | null>("get_ws_url");
    cachedWsUrl = url;
    return url;
  } catch {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize the Tauri bridge.
 *
 * Must be called early (e.g. in `main.tsx`) before the WebSocket transport
 * tries to resolve the server URL. Idempotent — safe to call multiple times.
 *
 * - Calls `get_ws_url` Rust command to prefetch the WS URL.
 * - Listens for the `backend-ws-url` Tauri event so the URL is updated as
 *   soon as the Node process is ready.
 */
export function initTauriBridge(): void {
  if (wsUrlPromise) return; // already initialised

  wsUrlPromise = fetchWsUrl();

  listen<string>("backend-ws-url", (event) => {
    cachedWsUrl = event.payload;
  }).catch(() => {});
}

/**
 * Create a `DesktopBridge`-compatible object backed by Tauri `invoke()` calls.
 *
 * Drop-in replacement for the Electron `contextBridge` preload. The existing
 * `wsNativeApi.ts` checks `window.desktopBridge` for dialogs, context menus,
 * and external links — assigning this object there is all that is needed.
 */
export function createTauriBridge(): DesktopBridge {
  return {
    getWsUrl: () => cachedWsUrl,

    pickFolder: () => invoke<string | null>("pick_folder"),

    confirm: (message: string) => invoke<boolean>("confirm_dialog", { message }),

    showContextMenu: <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) =>
      invoke<T | null>("show_context_menu", {
        items: items.map((item) => ({
          id: item.id,
          label: item.label,
          destructive: item.destructive ?? false,
        })),
        position: position ?? null,
      }),

    openExternal: (url: string) => invoke<boolean>("open_external", { url }),

    onMenuAction: (listener: (action: string) => void) => {
      let unlisten: (() => void) | null = null;

      listen<string>("menu-action", (event) => {
        listener(event.payload);
      })
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {});

      return () => {
        unlisten?.();
      };
    },

    getUpdateState: async (): Promise<DesktopUpdateState> => ({
      enabled: false,
      status: "disabled",
      currentVersion: "0.0.0",
      availableVersion: null,
      downloadedVersion: null,
      downloadPercent: null,
      checkedAt: null,
      message: null,
      errorContext: null,
      canRetry: false,
    }),

    downloadUpdate: async (): Promise<DesktopUpdateActionResult> => ({
      accepted: false,
      completed: false,
      state: {
        enabled: false,
        status: "disabled",
        currentVersion: "0.0.0",
        availableVersion: null,
        downloadedVersion: null,
        downloadPercent: null,
        checkedAt: null,
        message: null,
        errorContext: null,
        canRetry: false,
      },
    }),

    installUpdate: async (): Promise<DesktopUpdateActionResult> => ({
      accepted: false,
      completed: false,
      state: {
        enabled: false,
        status: "disabled",
        currentVersion: "0.0.0",
        availableVersion: null,
        downloadedVersion: null,
        downloadPercent: null,
        checkedAt: null,
        message: null,
        errorContext: null,
        canRetry: false,
      },
    }),

    onUpdateState: (_listener) => () => {},
  };
}
