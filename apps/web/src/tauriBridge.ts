import type {
  ContextMenuItem,
  DesktopBridge,
  DesktopUpdateActionResult,
  DesktopUpdateState,
} from "@t3tools/contracts";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

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

  // Also keep the cache updated when the backend (re)starts.
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
    // ── WS URL ──────────────────────────────────────────────────────────────
    getWsUrl: () => cachedWsUrl,

    // ── Dialogs ─────────────────────────────────────────────────────────────
    pickFolder: () => invoke<string | null>("pick_folder"),

    confirm: (message: string) => invoke<boolean>("confirm_dialog", { message }),

    // ── Context menu ────────────────────────────────────────────────────────
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

    // ── External links ──────────────────────────────────────────────────────
    openExternal: (url: string) => invoke<boolean>("open_external", { url }),

    // ── App menu ────────────────────────────────────────────────────────────
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

    // ── Auto-update stubs ────────────────────────────────────────────────────
    // Auto-update is not implemented for personal use.
    // These return safe no-op defaults so the rest of the UI doesn't break.

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

    onUpdateState: (_listener) => {
      // No-op — no auto-updates for personal use
      return () => {};
    },
  };
}
