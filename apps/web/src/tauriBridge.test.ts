/**
 * TDD tests for tauriBridge.ts
 *
 * These tests mock the @tauri-apps/api modules and verify that:
 *  1. createTauriBridge() returns all required DesktopBridge methods
 *  2. Each method calls invoke() with the correct command name and args
 *  3. initTauriBridge() triggers WS URL fetching
 *  4. Update-related stubs return the expected disabled state
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock @tauri-apps/api/core ────────────────────────────────────────────────

const mockInvoke = vi.fn();
const mockListen = vi.fn(() => Promise.resolve(vi.fn()));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mockListen }));

// ─── Import after mocks are set up ───────────────────────────────────────────

const { createTauriBridge, initTauriBridge } = await import("./tauriBridge");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function freshBridge() {
  return createTauriBridge();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("createTauriBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Shape ──────────────────────────────────────────────────────────────────

  it("returns an object that satisfies the DesktopBridge interface shape", () => {
    const bridge = freshBridge();
    expect(typeof bridge.getWsUrl).toBe("function");
    expect(typeof bridge.pickFolder).toBe("function");
    expect(typeof bridge.confirm).toBe("function");
    expect(typeof bridge.showContextMenu).toBe("function");
    expect(typeof bridge.openExternal).toBe("function");
    expect(typeof bridge.onMenuAction).toBe("function");
    expect(typeof bridge.getUpdateState).toBe("function");
    expect(typeof bridge.downloadUpdate).toBe("function");
    expect(typeof bridge.installUpdate).toBe("function");
    expect(typeof bridge.onUpdateState).toBe("function");
  });

  // ── getWsUrl ───────────────────────────────────────────────────────────────

  it("getWsUrl returns null before initTauriBridge is called", () => {
    // The module-level cachedWsUrl starts as null in a fresh module.
    // We can only observe this indirectly via the bridge — no invoke needed.
    const bridge = freshBridge();
    // Without calling invoke for get_ws_url, cache is null.
    expect(bridge.getWsUrl()).toBeNull();
  });

  // ── pickFolder ─────────────────────────────────────────────────────────────

  it("pickFolder calls invoke('pick_folder') with no extra args", async () => {
    mockInvoke.mockResolvedValueOnce("/selected/folder");
    const bridge = freshBridge();
    const result = await bridge.pickFolder();
    expect(mockInvoke).toHaveBeenCalledWith("pick_folder");
    expect(result).toBe("/selected/folder");
  });

  it("pickFolder returns null when user cancels", async () => {
    mockInvoke.mockResolvedValueOnce(null);
    const bridge = freshBridge();
    const result = await bridge.pickFolder();
    expect(result).toBeNull();
  });

  // ── confirm ────────────────────────────────────────────────────────────────

  it("confirm calls invoke('confirm_dialog', { message })", async () => {
    mockInvoke.mockResolvedValueOnce(true);
    const bridge = freshBridge();
    const result = await bridge.confirm("Delete this item?");
    expect(mockInvoke).toHaveBeenCalledWith("confirm_dialog", {
      message: "Delete this item?",
    });
    expect(result).toBe(true);
  });

  it("confirm returns false when user denies", async () => {
    mockInvoke.mockResolvedValueOnce(false);
    const bridge = freshBridge();
    const result = await bridge.confirm("Are you sure?");
    expect(result).toBe(false);
  });

  // ── showContextMenu ────────────────────────────────────────────────────────

  it("showContextMenu calls invoke('show_context_menu') with serialised items", async () => {
    mockInvoke.mockResolvedValueOnce("delete");
    const bridge = freshBridge();
    const items = [
      { id: "rename" as const, label: "Rename" },
      { id: "delete" as const, label: "Delete", destructive: true },
    ] as const;
    const result = await bridge.showContextMenu(items, { x: 100, y: 200 });
    expect(mockInvoke).toHaveBeenCalledWith("show_context_menu", {
      items: [
        { id: "rename", label: "Rename", destructive: false },
        { id: "delete", label: "Delete", destructive: true },
      ],
      position: { x: 100, y: 200 },
    });
    expect(result).toBe("delete");
  });

  it("showContextMenu passes null position when omitted", async () => {
    mockInvoke.mockResolvedValueOnce(null);
    const bridge = freshBridge();
    await bridge.showContextMenu([{ id: "copy" as const, label: "Copy" }]);
    expect(mockInvoke).toHaveBeenCalledWith("show_context_menu", {
      items: [{ id: "copy", label: "Copy", destructive: false }],
      position: null,
    });
  });

  it("showContextMenu returns null when dismissed", async () => {
    mockInvoke.mockResolvedValueOnce(null);
    const bridge = freshBridge();
    const result = await bridge.showContextMenu([
      { id: "open" as const, label: "Open" },
    ]);
    expect(result).toBeNull();
  });

  // ── openExternal ───────────────────────────────────────────────────────────

  it("openExternal calls invoke('open_external', { url })", async () => {
    mockInvoke.mockResolvedValueOnce(true);
    const bridge = freshBridge();
    const result = await bridge.openExternal("https://example.com");
    expect(mockInvoke).toHaveBeenCalledWith("open_external", {
      url: "https://example.com",
    });
    expect(result).toBe(true);
  });

  it("openExternal returns false when the Rust side rejects the URL scheme", async () => {
    mockInvoke.mockResolvedValueOnce(false);
    const bridge = freshBridge();
    const result = await bridge.openExternal("file:///etc/passwd");
    expect(result).toBe(false);
  });

  // ── onMenuAction ───────────────────────────────────────────────────────────

  it("onMenuAction subscribes to the 'menu-action' event via listen()", () => {
    const bridge = freshBridge();
    const listener = vi.fn();
    bridge.onMenuAction(listener);
    expect(mockListen).toHaveBeenCalledWith("menu-action", expect.any(Function));
  });

  it("onMenuAction returns an unsubscribe function", () => {
    const mockUnlisten = vi.fn();
    mockListen.mockResolvedValueOnce(mockUnlisten);
    const bridge = freshBridge();
    const unsubscribe = bridge.onMenuAction(vi.fn());
    expect(typeof unsubscribe).toBe("function");
  });

  // ── getUpdateState ─────────────────────────────────────────────────────────

  it("getUpdateState returns a disabled update state", async () => {
    const bridge = freshBridge();
    const state = await bridge.getUpdateState();
    expect(state.enabled).toBe(false);
    expect(state.status).toBe("disabled");
    expect(typeof state.currentVersion).toBe("string");
    expect(state.availableVersion).toBeNull();
    expect(state.downloadedVersion).toBeNull();
  });

  // ── downloadUpdate ─────────────────────────────────────────────────────────

  it("downloadUpdate returns accepted=false and completed=false", async () => {
    const bridge = freshBridge();
    const result = await bridge.downloadUpdate();
    expect(result.accepted).toBe(false);
    expect(result.completed).toBe(false);
    expect(result.state.enabled).toBe(false);
  });

  // ── installUpdate ──────────────────────────────────────────────────────────

  it("installUpdate returns accepted=false and completed=false", async () => {
    const bridge = freshBridge();
    const result = await bridge.installUpdate();
    expect(result.accepted).toBe(false);
    expect(result.completed).toBe(false);
  });

  // ── onUpdateState ──────────────────────────────────────────────────────────

  it("onUpdateState returns a no-op unsubscribe function without throwing", () => {
    const bridge = freshBridge();
    const unsubscribe = bridge.onUpdateState(vi.fn());
    expect(typeof unsubscribe).toBe("function");
    expect(() => unsubscribe()).not.toThrow();
  });
});

// ─── initTauriBridge ─────────────────────────────────────────────────────────
//
// These tests each reset the module registry so that the module-level
// `wsUrlPromise` cache starts as null in every test.

describe("initTauriBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules(); // clears the wsUrlPromise singleton between tests
  });

  it("calls invoke('get_ws_url') to prefetch the WebSocket URL", async () => {
    mockInvoke.mockResolvedValue("ws://127.0.0.1:12345/?token=abc");
    mockListen.mockResolvedValue(vi.fn());
    const { initTauriBridge: init } = await import("./tauriBridge");
    init();
    await Promise.resolve(); // flush microtasks
    expect(mockInvoke).toHaveBeenCalledWith("get_ws_url");
  });

  it("subscribes to the 'backend-ws-url' Tauri event", async () => {
    mockInvoke.mockResolvedValue(null);
    mockListen.mockResolvedValue(vi.fn());
    const { initTauriBridge: init } = await import("./tauriBridge");
    init();
    await Promise.resolve();
    expect(mockListen).toHaveBeenCalledWith("backend-ws-url", expect.any(Function));
  });

  it("does not call invoke again if called a second time (idempotent)", async () => {
    mockInvoke.mockResolvedValue(null);
    mockListen.mockResolvedValue(vi.fn());
    const { initTauriBridge: init } = await import("./tauriBridge");
    init(); // first call — should trigger fetchWsUrl
    init(); // second call — should be a no-op
    await Promise.resolve();
    // Only one invoke call despite two initTauriBridge() calls
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});
