/**
 * TDD tests for env.ts
 *
 * Verifies environment-detection exports under various window conditions.
 * Each describe block simulates a different runtime environment by
 * manipulating window properties before dynamically re-importing the module.
 */

import { afterEach, describe, expect, it } from "vitest";

// Capture original window descriptors so we can restore them after each test.
const originalWindow = globalThis.window;

afterEach(() => {
  // Restore window to its original state after each test block.
  Object.defineProperty(globalThis, "window", {
    value: originalWindow,
    writable: true,
    configurable: true,
  });
  // Clear the module registry so env.ts is re-evaluated in each test.
  vi.resetModules();
});

import { vi } from "vitest";

// ─── Helper ──────────────────────────────────────────────────────────────────

/**
 * Re-imports env.ts with a custom window shape.
 * vi.resetModules() must be called first (done in afterEach).
 */
async function importEnvWith(windowProps: Record<string, unknown>) {
  Object.defineProperty(globalThis, "window", {
    value: { ...originalWindow, ...windowProps },
    writable: true,
    configurable: true,
  });
  return import("./env");
}

// ─── isTauri ─────────────────────────────────────────────────────────────────

describe("isTauri", () => {
  it("is true when __TAURI_INTERNALS__ is present on window", async () => {
    vi.resetModules();
    const { isTauri } = await importEnvWith({ __TAURI_INTERNALS__: {} });
    expect(isTauri).toBe(true);
  });

  it("is false when __TAURI_INTERNALS__ is absent", async () => {
    vi.resetModules();
    const { isTauri } = await importEnvWith({});
    expect(isTauri).toBe(false);
  });
});

// ─── isDesktop ────────────────────────────────────────────────────────────────

describe("isDesktop", () => {
  it("is true when desktopBridge is set (Electron path)", async () => {
    vi.resetModules();
    const { isDesktop } = await importEnvWith({ desktopBridge: {} });
    expect(isDesktop).toBe(true);
  });

  it("is true when nativeApi is set (legacy Electron path)", async () => {
    vi.resetModules();
    const { isDesktop } = await importEnvWith({ nativeApi: {} });
    expect(isDesktop).toBe(true);
  });

  it("is true when __TAURI_INTERNALS__ is set (Tauri path)", async () => {
    vi.resetModules();
    const { isDesktop } = await importEnvWith({ __TAURI_INTERNALS__: {} });
    expect(isDesktop).toBe(true);
  });

  it("is false in a plain browser with none of the above", async () => {
    vi.resetModules();
    const { isDesktop } = await importEnvWith({});
    expect(isDesktop).toBe(false);
  });
});

// ─── isElectron (legacy backwards compatibility) ───────────────────────────────

describe("isElectron", () => {
  it("is true when desktopBridge is set", async () => {
    vi.resetModules();
    const { isElectron } = await importEnvWith({ desktopBridge: {} });
    expect(isElectron).toBe(true);
  });

  it("is true when nativeApi is set", async () => {
    vi.resetModules();
    const { isElectron } = await importEnvWith({ nativeApi: {} });
    expect(isElectron).toBe(true);
  });

  it("is false when only __TAURI_INTERNALS__ is set (not Electron)", async () => {
    vi.resetModules();
    const { isElectron } = await importEnvWith({ __TAURI_INTERNALS__: {} });
    expect(isElectron).toBe(false);
  });

  it("is false in a plain browser", async () => {
    vi.resetModules();
    const { isElectron } = await importEnvWith({});
    expect(isElectron).toBe(false);
  });
});
