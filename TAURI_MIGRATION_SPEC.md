# T3 Code — Electron to Tauri v2 Migration Spec

> **Target:** macOS only, Node.js pre-installed, single-user (personal tool)
> **Date:** 2026-03-08
> **Status:** Implementation-ready spec

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Project Structure](#2-project-structure)
3. [Dependencies & Versions](#3-dependencies--versions)
4. [Configuration Files](#4-configuration-files)
5. [Rust Commands — Complete Implementation](#5-rust-commands--complete-implementation)
6. [Frontend Bridge — Complete Implementation](#6-frontend-bridge--complete-implementation)
7. [Backend Process Management](#7-backend-process-management)
8. [Application Menu](#8-application-menu)
9. [Window Configuration](#9-window-configuration)
10. [Capabilities & Permissions](#10-capabilities--permissions)
11. [Build & Run](#11-build--run)
12. [Migration Checklist](#12-migration-checklist)
13. [Files to Create](#13-files-to-create)
14. [Files to Modify](#14-files-to-modify)
15. [Files to Delete](#15-files-to-delete)
16. [API Reference Quick Sheet](#16-api-reference-quick-sheet)

---

## 1. Architecture Overview

### Current (Electron)

```
┌──────────────────────────────────────┐
│  Electron Main Process (Node.js)     │
│  - Spawns backend as child process   │
│  - IPC bridge via contextBridge      │
│  - Native menus, dialogs, updates    │
├──────────────────────────────────────┤
│  Chromium Renderer                   │
│  - React web app                     │
│  - Talks to backend via WebSocket    │
│  - Uses desktopBridge for OS APIs    │
├──────────────────────────────────────┤
│  Node.js Backend (child process)     │
│  - WebSocket server on localhost     │
│  - SQLite, Effect.ts, AI providers   │
└──────────────────────────────────────┘
```

### Target (Tauri v2)

```
┌──────────────────────────────────────┐
│  Tauri Rust Core (~5-10 MB RAM)      │
│  - Spawns backend via shell plugin   │
│  - Rust commands for OS APIs         │
│  - Native menus via tauri::menu      │
├──────────────────────────────────────┤
│  macOS WebKit WebView (~40-80 MB)    │
│  - Same React web app                │
│  - Talks to backend via WebSocket    │
│  - Uses @tauri-apps/api for OS APIs  │
├──────────────────────────────────────┤
│  Node.js Backend (child process)     │
│  - UNCHANGED — same server binary    │
│  - Same WebSocket on localhost       │
└──────────────────────────────────────┘
```

### What Changes

| Layer | Change |
|-------|--------|
| Shell process | Electron (Chromium main) → Rust binary |
| Renderer | Chromium → macOS WebKit (WKWebView) |
| Bridge | `contextBridge` + `ipcRenderer` → `@tauri-apps/api` `invoke()` |
| Backend server | **No change** — still `node dist/index.mjs` |
| Web app | Minimal — swap bridge calls only |

---

## 2. Project Structure

### New directory: `apps/tauri/`

```
apps/tauri/
├── Cargo.toml
├── Cargo.lock
├── build.rs
├── tauri.conf.json
├── capabilities/
│   └── default.json
├── icons/
│   ├── icon.icns
│   ├── icon.png
│   ├── 32x32.png
│   ├── 128x128.png
│   └── 128x128@2x.png
└── src/
    ├── lib.rs              # Tauri app builder, plugin registration
    ├── main.rs             # Entry point (calls lib::run)
    ├── commands.rs         # All #[tauri::command] functions
    ├── backend.rs          # Node.js process spawning & lifecycle
    └── menu.rs             # Application menu setup
```

### Existing directory changes

```
apps/web/src/
├── tauriBridge.ts          # NEW — Tauri-specific DesktopBridge implementation
├── env.ts                  # MODIFY — add isTauri detection
├── wsTransport.ts          # MODIFY — get WS URL from Tauri state
├── wsNativeApi.ts          # MODIFY — use tauriBridge when in Tauri
└── nativeApi.ts            # NO CHANGE — abstraction layer already handles this

packages/contracts/src/
└── ipc.ts                  # NO CHANGE — DesktopBridge interface stays the same
```

---

## 3. Dependencies & Versions

### Rust (`apps/tauri/Cargo.toml`)

```toml
[package]
name = "t3code-desktop"
version = "0.0.4-alpha.1"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["macos-private-api"] }
tauri-plugin-shell = "2"
tauri-plugin-dialog = "2"
tauri-plugin-opener = "2"
tauri-plugin-process = "2"
tauri-plugin-window-state = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
rand = "0.9"
port_check = "0.2"

[target."cfg(target_os = \"macos\")".dependencies]
cocoa = "0.26"
```

### JavaScript (`apps/web/package.json` — add)

```json
{
  "dependencies": {
    "@tauri-apps/api": "^2.5.0",
    "@tauri-apps/plugin-shell": "^2.2.0",
    "@tauri-apps/plugin-dialog": "^2.2.0",
    "@tauri-apps/plugin-opener": "^2.5.0",
    "@tauri-apps/plugin-process": "^2.2.0",
    "@tauri-apps/plugin-window-state": "^2.2.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.5.0"
  }
}
```

### Monorepo (`package.json` — add scripts)

```json
{
  "scripts": {
    "dev:tauri": "cd apps/tauri && cargo tauri dev",
    "build:tauri": "cd apps/tauri && cargo tauri build"
  }
}
```

---

## 4. Configuration Files

### `apps/tauri/tauri.conf.json`

```json
{
  "$schema": "https://raw.githubusercontent.com/nicehash/tauri-plugin-decorum/main/schema.json",
  "productName": "T3 Code",
  "version": "0.0.4-alpha.1",
  "identifier": "com.t3tools.t3code",
  "build": {
    "devUrl": "http://localhost:5733",
    "frontendDist": "../../apps/web/dist",
    "beforeDevCommand": "",
    "beforeBuildCommand": ""
  },
  "app": {
    "macOSPrivateApi": true,
    "withGlobalTauri": false,
    "windows": [
      {
        "label": "main",
        "title": "T3 Code",
        "width": 1100,
        "height": 780,
        "minWidth": 840,
        "minHeight": 620,
        "titleBarStyle": "Overlay",
        "hiddenTitle": true,
        "decorations": true,
        "visible": false,
        "trafficLightPosition": { "x": 16, "y": 18 }
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["dmg"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.png"
    ],
    "macOS": {
      "minimumSystemVersion": "10.15",
      "hardenedRuntime": true
    }
  },
  "plugins": {}
}
```

### `apps/tauri/build.rs`

```rust
fn main() {
    tauri_build::build();
}
```

### `apps/tauri/capabilities/default.json`

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:default",
    "core:window:allow-start-dragging",
    "core:window:allow-show",
    "core:window:allow-set-focus",
    "core:window:allow-close",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:app:default",
    "core:menu:default",
    "core:event:default",
    "shell:allow-spawn",
    "shell:allow-stdin-write",
    "shell:allow-kill",
    "dialog:allow-open",
    "dialog:allow-ask",
    "dialog:allow-confirm",
    "dialog:allow-message",
    "opener:allow-open-url",
    "process:default",
    "window-state:default"
  ]
}
```

---

## 5. Rust Commands — Complete Implementation

### `apps/tauri/src/main.rs`

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    t3code_desktop::run();
}
```

### `apps/tauri/src/lib.rs`

```rust
mod backend;
mod commands;
mod menu;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Initialize window state plugin (restores position/size)
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_window_state::Builder::default().build())?;

            // Set up application menu
            menu::setup_menu(app)?;

            // Start the Node.js backend server
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                backend::start_backend(handle).await;
            });

            // Show window once ready
            if let Some(window) = app.get_webview_window("main") {
                window.show().unwrap_or_default();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_ws_url,
            commands::pick_folder,
            commands::confirm_dialog,
            commands::show_context_menu,
            commands::open_external,
            commands::get_backend_state,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Handle macOS dock click (re-show window)
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}
```

### `apps/tauri/src/commands.rs`

```rust
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::backend;

/// Return the WebSocket URL for the backend server.
/// Called by the frontend to connect to the Node.js backend.
#[tauri::command]
pub fn get_ws_url(app: AppHandle) -> Option<String> {
    let state = app.state::<backend::BackendState>();
    let guard = state.inner.lock().unwrap();
    guard.ws_url.clone()
}

/// Return the current backend process state (for debugging).
#[tauri::command]
pub fn get_backend_state(app: AppHandle) -> BackendInfo {
    let state = app.state::<backend::BackendState>();
    let guard = state.inner.lock().unwrap();
    BackendInfo {
        port: guard.port,
        running: guard.running,
        restart_count: guard.restart_count,
    }
}

#[derive(Serialize)]
pub struct BackendInfo {
    port: u16,
    running: bool,
    restart_count: u32,
}

/// Open a native folder picker dialog. Returns the selected path or null.
/// Maps to: DesktopBridge.pickFolder()
#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Option<String> {
    let folder = app
        .dialog()
        .file()
        .set_can_create_directories(true)
        .blocking_pick_folder();

    folder.map(|f| f.to_string())
}

/// Show a native confirmation dialog. Returns true if confirmed.
/// Maps to: DesktopBridge.confirm(message)
#[tauri::command]
pub async fn confirm_dialog(app: AppHandle, message: String) -> bool {
    app.dialog()
        .message(message)
        .title("T3 Code")
        .ok_button_label("Yes")
        .cancel_button_label("No")
        .blocking_show()
}

/// Show a native context menu at the given position.
/// Maps to: DesktopBridge.showContextMenu(items, position)
///
/// Items are passed from JS as an array of { id, label, destructive? }.
/// Returns the selected item's id, or null if dismissed.
#[tauri::command]
pub async fn show_context_menu(
    window: WebviewWindow,
    items: Vec<ContextMenuItemInput>,
    position: Option<MenuPosition>,
) -> Result<Option<String>, String> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder};
    use std::sync::{Arc, Mutex};

    let app = window.app_handle();
    let mut builder = MenuBuilder::new(app);

    // Track which items are destructive for separator insertion
    let mut has_non_destructive = false;
    let mut destructive_separator_added = false;

    for item in &items {
        if item.destructive.unwrap_or(false) && has_non_destructive && !destructive_separator_added {
            builder = builder.separator();
            destructive_separator_added = true;
        }
        if !item.destructive.unwrap_or(false) {
            has_non_destructive = true;
        }

        let menu_item = MenuItemBuilder::with_id(&item.id, &item.label)
            .build(app)
            .map_err(|e| e.to_string())?;
        builder = builder.item(&menu_item);
    }

    let menu = builder.build().map_err(|e| e.to_string())?;

    // Use a channel to receive the selected item ID
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    let tx = Arc::new(Mutex::new(Some(tx)));

    let tx_clone = tx.clone();
    let event_id = app.on_menu_event(move |_app, event| {
        if let Some(sender) = tx_clone.lock().unwrap().take() {
            let _ = sender.send(event.id().0.clone());
        }
    });

    // Show the context menu
    if let Some(pos) = position {
        menu.popup_at(
            window.clone(),
            tauri::Position::Logical(tauri::LogicalPosition::new(pos.x, pos.y)),
        )
        .map_err(|e| e.to_string())?;
    } else {
        menu.popup(window.clone()).map_err(|e| e.to_string())?;
    }

    // popup() is blocking on macOS — it returns after the menu is dismissed
    app.remove_menu_event_listener(event_id);

    // Check if an item was selected
    match rx.try_recv() {
        Ok(id) => Ok(Some(id)),
        Err(_) => Ok(None),
    }
}

#[derive(Deserialize)]
pub struct ContextMenuItemInput {
    pub id: String,
    pub label: String,
    pub destructive: Option<bool>,
}

#[derive(Deserialize)]
pub struct MenuPosition {
    pub x: f64,
    pub y: f64,
}

/// Open a URL in the default browser.
/// Maps to: DesktopBridge.openExternal(url)
#[tauri::command]
pub async fn open_external(app: AppHandle, url: String) -> Result<bool, String> {
    // Validate URL scheme
    let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Ok(false);
    }

    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| e.to_string())?;

    Ok(true)
}
```

> **Note on `show_context_menu`:** The `menu.popup()` call on macOS is synchronous (blocks until dismissed). The menu event handler fires before `popup()` returns, so the `mpsc::channel` pattern works correctly.

### `apps/tauri/src/backend.rs`

```rust
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

/// Shared state for the backend process.
pub struct BackendState {
    pub inner: Mutex<BackendStateInner>,
}

pub struct BackendStateInner {
    pub port: u16,
    pub auth_token: String,
    pub ws_url: Option<String>,
    pub running: bool,
    pub restart_count: u32,
}

/// Find an available port on localhost.
fn find_available_port() -> u16 {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("failed to bind port");
    listener.local_addr().unwrap().port()
}

/// Generate a random auth token.
fn generate_auth_token() -> String {
    use rand::Rng;
    let mut rng = rand::rng();
    let bytes: Vec<u8> = (0..24).map(|_| rng.random::<u8>()).collect();
    hex::encode(bytes)
}

/// Start the Node.js backend server and manage its lifecycle.
pub async fn start_backend(app: AppHandle) {
    let port = find_available_port();
    let auth_token = generate_auth_token();
    let ws_url = format!(
        "ws://127.0.0.1:{}/?token={}",
        port,
        urlencoding::encode(&auth_token)
    );

    let state_dir = dirs::home_dir()
        .map(|h| h.join(".t3").join("userdata"))
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp/t3code"));

    // Ensure state directory exists
    let _ = std::fs::create_dir_all(&state_dir);

    // Register managed state so commands can access it
    app.manage(BackendState {
        inner: Mutex::new(BackendStateInner {
            port,
            auth_token: auth_token.clone(),
            ws_url: Some(ws_url.clone()),
            running: false,
            restart_count: 0,
        }),
    });

    // Emit the WS URL to the frontend
    let _ = app.emit("backend-ws-url", &ws_url);

    // Resolve the server entry point
    // In dev: relative to monorepo root
    // In prod: relative to app resources
    let server_entry = resolve_server_entry(&app);

    spawn_and_supervise(app, server_entry, port, auth_token, state_dir).await;
}

fn resolve_server_entry(app: &AppHandle) -> String {
    // Check for resource path first (production build)
    if let Ok(resource) = app.path().resource_dir() {
        let prod_entry = resource.join("server").join("index.mjs");
        if prod_entry.exists() {
            return prod_entry.to_string_lossy().to_string();
        }
    }

    // Development: use the monorepo path
    // The Tauri dev server runs from apps/tauri/, so ../../apps/server/dist/index.mjs
    let dev_entry = std::env::current_dir()
        .unwrap_or_default()
        .join("../../apps/server/dist/index.mjs");

    if dev_entry.exists() {
        return dev_entry.canonicalize().unwrap().to_string_lossy().to_string();
    }

    // Fallback: assume it's in a standard location relative to the binary
    "apps/server/dist/index.mjs".to_string()
}

async fn spawn_and_supervise(
    app: AppHandle,
    server_entry: String,
    port: u16,
    auth_token: String,
    state_dir: std::path::PathBuf,
) {
    let mut restart_attempt: u32 = 0;

    loop {
        println!(
            "[tauri-backend] Starting Node.js server on port {} (attempt {})",
            port,
            restart_attempt + 1
        );

        // Update state
        {
            let state = app.state::<BackendState>();
            let mut guard = state.inner.lock().unwrap();
            guard.running = true;
            guard.restart_count = restart_attempt;
        }

        let result = spawn_backend(
            &app,
            &server_entry,
            port,
            &auth_token,
            &state_dir,
        )
        .await;

        // Update state
        {
            let state = app.state::<BackendState>();
            let mut guard = state.inner.lock().unwrap();
            guard.running = false;
        }

        match result {
            Ok(()) => {
                println!("[tauri-backend] Backend exited cleanly");
                break; // Clean exit, don't restart
            }
            Err(e) => {
                eprintln!("[tauri-backend] Backend crashed: {}", e);
                restart_attempt += 1;
                let delay = std::cmp::min(500 * 2u64.pow(restart_attempt), 10_000);
                eprintln!("[tauri-backend] Restarting in {}ms...", delay);
                tokio::time::sleep(Duration::from_millis(delay)).await;
            }
        }
    }
}

async fn spawn_backend(
    app: &AppHandle,
    server_entry: &str,
    port: u16,
    auth_token: &str,
    state_dir: &std::path::Path,
) -> Result<(), String> {
    let command = app
        .shell()
        .command("node")
        .args([server_entry])
        .env("T3CODE_MODE", "desktop")
        .env("T3CODE_NO_BROWSER", "1")
        .env("T3CODE_PORT", port.to_string())
        .env("T3CODE_STATE_DIR", state_dir.to_string_lossy().to_string())
        .env("T3CODE_AUTH_TOKEN", auth_token);

    let (mut rx, _child) = command.spawn().map_err(|e| format!("Failed to spawn: {}", e))?;

    // Process output events
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(data) => {
                let line = String::from_utf8_lossy(&data);
                print!("[server] {}", line);
            }
            CommandEvent::Stderr(data) => {
                let line = String::from_utf8_lossy(&data);
                eprint!("[server:err] {}", line);
            }
            CommandEvent::Terminated(payload) => {
                if payload.code == Some(0) {
                    return Ok(());
                }
                return Err(format!(
                    "Process exited with code={:?} signal={:?}",
                    payload.code, payload.signal
                ));
            }
            CommandEvent::Error(err) => {
                return Err(format!("Process error: {}", err));
            }
            _ => {}
        }
    }

    Ok(())
}
```

> **Add to Cargo.toml** for the backend module:
> ```toml
> hex = "0.4"
> urlencoding = "2"
> dirs = "6"
> ```

### `apps/tauri/src/menu.rs`

```rust
use tauri::{
    menu::{MenuBuilder, PredefinedMenuItem, SubmenuBuilder},
    App, Emitter, Manager,
};

pub fn setup_menu(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    // macOS app menu (first submenu becomes the app menu)
    let app_menu = SubmenuBuilder::new(app, "T3 Code")
        .about(None)
        .separator()
        .text("open-settings", "Settings...")
        // Note: accelerator is set on the text item
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .close_window()
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .fullscreen()
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])
        .build()?;

    app.set_menu(menu)?;

    // Handle custom menu events
    let handle = app.handle().clone();
    app.on_menu_event(move |_app_handle, event| {
        match event.id().0.as_str() {
            "open-settings" => {
                // Emit to frontend so it can navigate to settings
                let _ = handle.emit("menu-action", "open-settings");
            }
            _ => {}
        }
    });

    Ok(())
}
```

---

## 6. Frontend Bridge — Complete Implementation

### `apps/web/src/tauriBridge.ts` (NEW FILE)

This file provides a `DesktopBridge`-compatible interface using Tauri APIs, so the existing `wsNativeApi.ts` can use it as a drop-in replacement for `window.desktopBridge`.

```typescript
import type { ContextMenuItem, DesktopBridge, DesktopUpdateState, DesktopUpdateActionResult } from "@t3tools/contracts";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * Cached WebSocket URL from the Tauri backend.
 * Fetched once on init, then cached.
 */
let cachedWsUrl: string | null = null;
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

/**
 * Initialize the Tauri bridge. Must be called early (e.g., in main.tsx).
 * Starts fetching the WS URL from the Rust backend.
 */
export function initTauriBridge(): void {
  if (!wsUrlPromise) {
    wsUrlPromise = fetchWsUrl();

    // Also listen for the backend-ws-url event (emitted when backend starts)
    listen<string>("backend-ws-url", (event) => {
      cachedWsUrl = event.payload;
    }).catch(() => {});
  }
}

/**
 * Create a DesktopBridge implementation using Tauri APIs.
 * This is a drop-in replacement for the Electron contextBridge.
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
      }).then((fn) => {
        unlisten = fn;
      });
      return () => {
        unlisten?.();
      };
    },

    // Auto-update is not implemented for personal use.
    // These return sensible defaults so the UI doesn't break.
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
      state: await createTauriBridge().getUpdateState(),
    }),

    installUpdate: async (): Promise<DesktopUpdateActionResult> => ({
      accepted: false,
      completed: false,
      state: await createTauriBridge().getUpdateState(),
    }),

    onUpdateState: (_listener) => {
      // No-op for personal use — no auto-updates
      return () => {};
    },
  };
}
```

### Modify `apps/web/src/env.ts`

```typescript
/**
 * True when running inside Tauri.
 */
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * True when running inside Electron OR Tauri desktop shell.
 */
export const isDesktop =
  typeof window !== "undefined" &&
  (window.desktopBridge !== undefined ||
    window.nativeApi !== undefined ||
    "__TAURI_INTERNALS__" in window);

/**
 * Legacy — kept for backwards compatibility.
 */
export const isElectron =
  typeof window !== "undefined" &&
  (window.desktopBridge !== undefined || window.nativeApi !== undefined);
```

### Modify `apps/web/src/wsNativeApi.ts`

Add Tauri bridge initialization at the top of `createWsNativeApi()`:

```typescript
// At the top of the file, add:
import { isTauri } from "./env";

// Inside createWsNativeApi(), before creating the WsTransport:
// If running in Tauri, set up the desktopBridge on window
if (isTauri && !window.desktopBridge) {
  const { createTauriBridge, initTauriBridge } = await import("./tauriBridge");
  initTauriBridge();
  window.desktopBridge = createTauriBridge();
}
```

This approach means **zero changes** to the rest of `wsNativeApi.ts` — it already checks `window.desktopBridge` for dialogs, context menu, and open-external. By setting it up with the Tauri bridge, everything works.

### Modify `apps/web/src/wsTransport.ts`

The `WsTransport` constructor already reads from `window.desktopBridge?.getWsUrl()`. Since the Tauri bridge sets this up, **no changes needed** to `wsTransport.ts`.

However, there's a timing issue: the Rust backend takes a moment to start, so `getWsUrl()` might return `null` initially. The existing reconnect logic handles this (exponential backoff). To make it faster, add a retry in the constructor:

```typescript
// In the WsTransport constructor, after setting this.url:
// If URL is empty (backend not ready yet), wait and retry
if (!this.url || this.url === "ws://localhost:") {
  const waitForUrl = async () => {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const bridgeUrl = window.desktopBridge?.getWsUrl();
      if (bridgeUrl) {
        this.url = bridgeUrl;
        this.connect();
        return;
      }
    }
    // Give up after 5 seconds — the reconnect logic will keep trying
    this.connect();
  };
  waitForUrl();
  return; // Don't connect yet
}
```

### Modify `apps/web/src/main.tsx`

Add Tauri bridge initialization before the React app mounts:

```typescript
import { isTauri } from "./env";

// Initialize Tauri bridge before React renders
if (isTauri) {
  const { initTauriBridge } = await import("./tauriBridge");
  initTauriBridge();
}
```

---

## 7. Backend Process Management

### Lifecycle

```
App starts
  → Rust: find available port
  → Rust: generate auth token
  → Rust: store { port, token, ws_url } in managed state
  → Rust: spawn `node apps/server/dist/index.mjs` with env vars
  → Rust: emit "backend-ws-url" event to frontend
  → Frontend: receives WS URL via get_ws_url command or event
  → Frontend: connects WsTransport to backend

Backend crashes
  → Rust: exponential backoff (500ms, 1s, 2s, 4s, 8s, 10s max)
  → Rust: respawn with same port/token
  → Frontend: WsTransport auto-reconnects (existing logic)

App quits
  → Tauri drops the child process automatically
  → Node.js server receives SIGTERM and exits
```

### Environment Variables Passed to Backend

| Variable | Value | Purpose |
|----------|-------|---------|
| `T3CODE_MODE` | `"desktop"` | Server runs in desktop mode |
| `T3CODE_NO_BROWSER` | `"1"` | Don't auto-open browser |
| `T3CODE_PORT` | `"{port}"` | Listen on this port |
| `T3CODE_STATE_DIR` | `"~/.t3/userdata"` | SQLite + state storage |
| `T3CODE_AUTH_TOKEN` | `"{token}"` | WebSocket auth token |

### Shell Plugin Permission for Node.js

Add to `capabilities/default.json`:

```json
{
  "identifier": "shell:allow-spawn",
  "allow": [
    {
      "name": "node",
      "cmd": "node",
      "args": [{ "validator": ".*\\.mjs$" }],
      "sidecar": false
    }
  ]
}
```

---

## 8. Application Menu

### Current Electron Menu Structure

```
[App Name]
  ├── About T3 Code
  ├── Check for Updates...        ← SKIP (no auto-update for personal use)
  ├── ---
  ├── Settings...          ⌘,
  ├── ---
  ├── Services                    ← macOS standard
  ├── ---
  ├── Hide                 ⌘H
  ├── Hide Others          ⌥⌘H
  ├── Show All
  ├── ---
  └── Quit                 ⌘Q

File
  ├── Settings...          ⌘,    ← (only on non-macOS, skipped)
  └── Close Window         ⌘W

Edit                              ← Standard edit menu
View                              ← Standard view menu
Window                            ← Standard window menu
Help
  └── Check for Updates...        ← SKIP
```

### Tauri Equivalent

Implemented in `menu.rs` above. The key mapping:

| Electron | Tauri |
|----------|-------|
| `{ role: "about" }` | `.about(None)` |
| `{ role: "services" }` | `.services()` |
| `{ role: "hide" }` | `.hide()` |
| `{ role: "hideOthers" }` | `.hide_others()` |
| `{ role: "unhide" }` | `.show_all()` |
| `{ role: "quit" }` | `.quit()` |
| `{ role: "close" }` | `.close_window()` |
| `{ role: "editMenu" }` | Build with `.undo()`, `.redo()`, `.cut()`, `.copy()`, `.paste()`, `.select_all()` |
| `{ role: "viewMenu" }` | Build with `.fullscreen()` |
| `{ role: "windowMenu" }` | Build with `.minimize()`, `.maximize()`, `.close_window()` |
| Custom item with accelerator | `.text("id", "Label")` — Note: accelerators on custom items need `MenuItemBuilder::with_id(id, label).accelerator("CmdOrCtrl+,")` |

### Settings Accelerator Fix

The `SubmenuBuilder::text()` method doesn't support accelerators. For the Settings item:

```rust
use tauri::menu::MenuItemBuilder;

let settings_item = MenuItemBuilder::with_id(app, "open-settings", "Settings...")
    .accelerator("CmdOrCtrl+,")
    .build()?;

let app_menu = SubmenuBuilder::new(app, "T3 Code")
    .about(None)
    .separator()
    .item(&settings_item)
    .separator()
    .services()
    // ...
```

---

## 9. Window Configuration

### Electron → Tauri Mapping

| Electron (`BrowserWindow`) | Tauri (`tauri.conf.json` → `app.windows[0]`) |
|---|---|
| `width: 1100` | `"width": 1100` |
| `height: 780` | `"height": 780` |
| `minWidth: 840` | `"minWidth": 840` |
| `minHeight: 620` | `"minHeight": 620` |
| `show: false` | `"visible": false` |
| `titleBarStyle: "hiddenInset"` | `"titleBarStyle": "Overlay"` |
| `trafficLightPosition: { x: 16, y: 18 }` | `"trafficLightPosition": { "x": 16, "y": 18 }` |
| `autoHideMenuBar: true` | Not applicable on macOS (menu bar is always in the system menu bar) |
| `webPreferences.contextIsolation: true` | Default in Tauri (always isolated) |
| `webPreferences.nodeIntegration: false` | Default in Tauri (no Node.js in webview) |
| `webPreferences.sandbox: true` | Default in Tauri (WebKit sandbox) |
| `webPreferences.preload` | Not applicable — use `invoke()` instead |

### macOS Title Bar Equivalence

Electron's `hiddenInset` = Tauri's `Overlay`. Both:
- Show the traffic light buttons (close/minimize/fullscreen)
- Hide the title text
- Let web content extend behind the title bar area

The `hiddenTitle: true` config in Tauri hides the title text from the title bar.

---

## 10. Capabilities & Permissions

### Complete Permission List

```json
{
  "permissions": [
    "core:default",
    "core:window:default",
    "core:window:allow-show",
    "core:window:allow-set-focus",
    "core:window:allow-close",
    "core:window:allow-start-dragging",
    "core:app:default",
    "core:menu:default",
    "core:event:default",
    "dialog:allow-open",
    "dialog:allow-ask",
    "dialog:allow-confirm",
    "dialog:allow-message",
    "opener:allow-open-url",
    "process:default",
    "window-state:default",
    {
      "identifier": "shell:allow-spawn",
      "allow": [
        {
          "name": "node",
          "cmd": "node",
          "args": [{ "validator": ".*" }],
          "sidecar": false
        }
      ]
    },
    "shell:allow-stdin-write",
    "shell:allow-kill",
    {
      "identifier": "opener:allow-open-url",
      "allow": [
        { "url": "https://*" },
        { "url": "http://*" }
      ]
    }
  ]
}
```

---

## 11. Build & Run

### Development

```bash
# Terminal 1: Start the web dev server
cd apps/web && bun run dev

# Terminal 2: Start the Tauri app (it connects to the web dev server)
cd apps/tauri && cargo tauri dev
```

The `tauri.conf.json` `devUrl` is set to `http://localhost:5733` which matches the web dev server port. Tauri's dev mode points the WebView at this URL.

The Rust code will spawn `node apps/server/dist/index.mjs` as the backend. Make sure to build the server first:

```bash
cd apps/server && bun run build
```

### Production Build

```bash
# Build web + server first
bun run build

# Build Tauri app
cd apps/tauri && cargo tauri build
```

Output: `apps/tauri/target/release/bundle/dmg/T3 Code.dmg`

### First-Time Setup

```bash
# 1. Install Rust (if not already)
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh

# 2. Install Xcode CLT (if not already)
xcode-select --install

# 3. Install Tauri CLI
cd apps/web && bun add -D @tauri-apps/cli

# 4. Install JS Tauri packages
cd apps/web && bun add @tauri-apps/api @tauri-apps/plugin-shell @tauri-apps/plugin-dialog @tauri-apps/plugin-opener @tauri-apps/plugin-process @tauri-apps/plugin-window-state

# 5. Build the Tauri app for the first time (downloads and compiles Rust deps)
cd apps/tauri && cargo tauri dev
```

First Rust compilation takes ~3-5 minutes. Subsequent builds: ~5-15 seconds.

---

## 12. Migration Checklist

### Phase 1: Scaffold (Day 1)

- [ ] Create `apps/tauri/` directory structure
- [ ] Write `Cargo.toml` with all dependencies
- [ ] Write `tauri.conf.json` with window config
- [ ] Write `build.rs`
- [ ] Write `capabilities/default.json`
- [ ] Write `src/main.rs` (entry point)
- [ ] Write `src/lib.rs` (app builder skeleton)
- [ ] Copy icons from `apps/desktop/resources/` to `apps/tauri/icons/`
- [ ] Verify `cargo tauri dev` launches a window showing the web app

### Phase 2: Backend Process (Day 2)

- [ ] Write `src/backend.rs` (port allocation, token generation, process spawning)
- [ ] Implement `get_ws_url` command
- [ ] Implement crash recovery with exponential backoff
- [ ] Test: web app connects to backend via WebSocket
- [ ] Test: backend restarts after kill -9

### Phase 3: Bridge (Day 3)

- [ ] Write `apps/web/src/tauriBridge.ts`
- [ ] Modify `apps/web/src/env.ts` — add `isTauri` and `isDesktop`
- [ ] Modify `apps/web/src/wsNativeApi.ts` — Tauri bridge initialization
- [ ] Write `src/commands.rs` — all Tauri commands
- [ ] Test: folder picker dialog works
- [ ] Test: confirm dialog works
- [ ] Test: context menu works (right-click on threads, etc.)
- [ ] Test: "open in browser" links work

### Phase 4: Menu & Polish (Day 4)

- [ ] Write `src/menu.rs` — application menu
- [ ] Test: Settings menu item (Cmd+,) opens settings
- [ ] Test: Edit menu (copy/paste) works
- [ ] Test: Window menu (minimize, maximize) works
- [ ] Test: traffic light position matches Electron version
- [ ] Test: window state persistence (position, size restored on restart)
- [ ] Test: dock icon click re-shows window

### Phase 5: Integration Testing (Day 5)

- [ ] Full chat flow: send message → get AI response → view diff
- [ ] Terminal: open, type, resize, multiple terminals
- [ ] Git operations: branch, checkout, worktree
- [ ] File search: workspace entry search
- [ ] Keyboard shortcuts: all keybindings work
- [ ] WebSocket reconnection: kill backend, verify auto-reconnect
- [ ] Memory usage comparison vs Electron

---

## 13. Files to Create

| File | Purpose |
|------|---------|
| `apps/tauri/Cargo.toml` | Rust dependencies |
| `apps/tauri/Cargo.lock` | (auto-generated) |
| `apps/tauri/build.rs` | Tauri build script |
| `apps/tauri/tauri.conf.json` | App configuration |
| `apps/tauri/capabilities/default.json` | Security permissions |
| `apps/tauri/src/main.rs` | Entry point |
| `apps/tauri/src/lib.rs` | App builder |
| `apps/tauri/src/commands.rs` | IPC command handlers |
| `apps/tauri/src/backend.rs` | Node.js process management |
| `apps/tauri/src/menu.rs` | Application menu |
| `apps/tauri/icons/*` | App icons (copy from desktop) |
| `apps/web/src/tauriBridge.ts` | Frontend Tauri bridge |

## 14. Files to Modify

| File | Change |
|------|--------|
| `apps/web/src/env.ts` | Add `isTauri`, `isDesktop` exports |
| `apps/web/src/wsNativeApi.ts` | Add Tauri bridge initialization |
| `apps/web/src/main.tsx` | Add Tauri bridge init call |
| `apps/web/package.json` | Add `@tauri-apps/*` dependencies |
| `package.json` | Add `dev:tauri`, `build:tauri` scripts |

## 15. Files to Delete (After Migration)

These are **only deleted once Tauri is fully working** and Electron is no longer needed:

| File | Reason |
|------|--------|
| `apps/desktop/` (entire directory) | Replaced by `apps/tauri/` |
| `apps/web/src/env.ts` | Remove `isElectron` (replaced by `isDesktop`) |

---

## 16. API Reference Quick Sheet

### Tauri Command Pattern

**Rust:**
```rust
#[tauri::command]
async fn my_command(app: AppHandle, arg_name: String) -> Result<ReturnType, String> {
    // ...
}

// Register in lib.rs:
.invoke_handler(tauri::generate_handler![commands::my_command])
```

**JavaScript:**
```typescript
import { invoke } from "@tauri-apps/api/core";
const result = await invoke<ReturnType>("my_command", { argName: "value" });
```

### Tauri Event Pattern

**Rust → JS:**
```rust
use tauri::Emitter;
app.emit("event-name", payload)?;
```

**JS listener:**
```typescript
import { listen } from "@tauri-apps/api/event";
const unlisten = await listen<PayloadType>("event-name", (event) => {
    console.log(event.payload);
});
// Cleanup:
unlisten();
```

### Key Differences from Electron IPC

| Concept | Electron | Tauri |
|---------|----------|-------|
| Invoke | `ipcRenderer.invoke(channel, ...args)` | `invoke(command, { args })` |
| Listen | `ipcRenderer.on(channel, listener)` | `listen(event, listener)` → returns `Promise<unlisten>` |
| Send to renderer | `webContents.send(channel, data)` | `app.emit(event, data)` or `window.emit(event, data)` |
| Arg format | Positional args | Named args (object), snake_case in Rust ↔ camelCase in JS |
| Return | `Promise<any>` | `Promise<T>` (typed via generics) |
| Error | Rejected promise with Error | Rejected promise with string |

### Plugin Initialization Boilerplate

Every plugin follows this pattern:

```rust
// In lib.rs, inside Builder::default():
.plugin(tauri_plugin_NAME::init())
```

```json
// In capabilities/default.json:
{ "permissions": ["NAME:allow-ACTION"] }
```

```typescript
// In JS:
import { functionName } from "@tauri-apps/plugin-NAME";
```
