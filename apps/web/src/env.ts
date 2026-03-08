/**
 * True when running inside Tauri (v2).
 * Tauri injects `__TAURI_INTERNALS__` on the window object before any web-app
 * code executes, so this is reliable at module load time.
 */
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * True when running inside any desktop shell — Electron OR Tauri.
 */
export const isDesktop =
  typeof window !== "undefined" &&
  (window.desktopBridge !== undefined ||
    window.nativeApi !== undefined ||
    "__TAURI_INTERNALS__" in window);

/**
 * True when running inside the Electron preload bridge, false in a regular browser.
 * The preload script sets window.nativeApi via contextBridge before any web-app
 * code executes, so this is reliable at module load time.
 *
 * @deprecated Prefer `isDesktop` — it covers both Electron and Tauri.
 */
export const isElectron =
  typeof window !== "undefined" &&
  (window.desktopBridge !== undefined || window.nativeApi !== undefined);
