use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

/// Shared state for the backend process — managed by Tauri's state system.
pub struct BackendState {
    pub inner: Mutex<BackendStateInner>,
}

pub struct BackendStateInner {
    pub port: u16,
    #[allow(dead_code)] // stored for future use (e.g. re-spawning after crash)
    pub auth_token: String,
    pub ws_url: Option<String>,
    pub running: bool,
    pub restart_count: u32,
}

/// Find an available ephemeral TCP port on localhost.
///
/// Binds to port 0 (OS picks a free port), records the address, then
/// drops the listener so the port is available for the Node process.
fn find_available_port() -> u16 {
    let listener =
        std::net::TcpListener::bind("127.0.0.1:0").expect("failed to bind to a random port");
    listener.local_addr().unwrap().port()
}

/// Generate a cryptographically-random 48-character hex auth token (24 bytes).
fn generate_auth_token() -> String {
    use rand::Rng;
    let mut rng = rand::rng();
    let bytes: Vec<u8> = (0..24).map(|_| rng.random::<u8>()).collect();
    hex::encode(bytes)
}

/// Start the Node.js backend server and manage its lifecycle.
///
/// Allocates a free port + auth token, registers managed Tauri state, emits
/// the WS URL to the frontend, then enters a supervised restart loop.
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

    // Emit the WS URL to the frontend immediately so it can start connecting
    // while the Node process is still starting up.
    let _ = app.emit("backend-ws-url", &ws_url);

    // Resolve the server entry point
    let server_entry = resolve_server_entry(&app);

    spawn_and_supervise(app, server_entry, port, auth_token, state_dir).await;
}

/// Resolve the path to the Node.js server entry point.
///
/// - In production: bundled inside the app resources at `server/index.mjs`.
/// - In development: relative to the monorepo root at
///   `../../apps/server/dist/index.mjs` (since `cargo tauri dev` runs from
///   `apps/tauri/`).
fn resolve_server_entry(app: &AppHandle) -> String {
    // 1. Check for production resource path first
    if let Ok(resource) = app.path().resource_dir() {
        let prod_entry = resource.join("server").join("index.mjs");
        if prod_entry.exists() {
            return prod_entry.to_string_lossy().to_string();
        }
    }

    // 2. Development: monorepo path (apps/tauri/ → ../../apps/server/...)
    let dev_entry = std::env::current_dir()
        .unwrap_or_default()
        .join("../../apps/server/dist/index.mjs");

    if dev_entry.exists() {
        return dev_entry
            .canonicalize()
            .unwrap_or(dev_entry)
            .to_string_lossy()
            .to_string();
    }

    // 3. Fallback
    "apps/server/dist/index.mjs".to_string()
}

/// Supervised restart loop.
///
/// Respawns the backend process on crash with exponential backoff.
/// A clean exit (exit code 0) breaks the loop — this handles intentional
/// shutdown (e.g. the app is quitting and SIGTERM propagated to the child).
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

        let result = spawn_backend(&app, &server_entry, port, &auth_token, &state_dir).await;

        // Update state
        {
            let state = app.state::<BackendState>();
            let mut guard = state.inner.lock().unwrap();
            guard.running = false;
        }

        match result {
            Ok(()) => {
                println!("[tauri-backend] Backend exited cleanly");
                break; // Clean exit — don't restart
            }
            Err(e) => {
                eprintln!("[tauri-backend] Backend crashed: {}", e);
                restart_attempt += 1;
                // Exponential backoff: 500ms, 1s, 2s, 4s, 8s, … capped at 10s
                let delay = std::cmp::min(500 * 2u64.pow(restart_attempt.saturating_sub(1)), 10_000);
                eprintln!("[tauri-backend] Restarting in {}ms…", delay);
                tokio::time::sleep(Duration::from_millis(delay)).await;
            }
        }
    }
}

/// Spawn the Node.js backend process and wait for it to exit.
///
/// Returns `Ok(())` on clean exit (code 0) and `Err(reason)` on crash or error.
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

    // Process output events until the process exits
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

// ─── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// find_available_port() should return a non-zero port number.
    #[test]
    fn find_available_port_returns_nonzero() {
        let port = find_available_port();
        assert!(port > 0, "Expected a non-zero port, got {}", port);
    }

    /// Two consecutive calls should return different ports (OS allocates each
    /// from its ephemeral range).
    #[test]
    fn find_available_port_returns_unique_ports() {
        let port_a = find_available_port();
        let port_b = find_available_port();
        // Not strictly guaranteed, but highly reliable in practice.
        assert_ne!(port_a, port_b, "Expected unique ports on two consecutive calls");
    }

    /// generate_auth_token() returns a 48-character lowercase hex string.
    #[test]
    fn generate_auth_token_length() {
        let token = generate_auth_token();
        assert_eq!(
            token.len(),
            48,
            "Expected 48 hex chars (24 bytes * 2), got {}",
            token.len()
        );
    }

    /// generate_auth_token() output is hex (only 0-9, a-f).
    #[test]
    fn generate_auth_token_is_hex() {
        let token = generate_auth_token();
        assert!(
            token.chars().all(|c| c.is_ascii_hexdigit()),
            "Token contains non-hex characters: {}",
            token
        );
    }

    /// Two tokens generated consecutively should be different.
    #[test]
    fn generate_auth_token_is_unique() {
        let a = generate_auth_token();
        let b = generate_auth_token();
        assert_ne!(a, b, "Expected unique tokens");
    }

    /// BackendStateInner can be constructed and holds correct initial values.
    #[test]
    fn backend_state_inner_initial_values() {
        let inner = BackendStateInner {
            port: 9000,
            auth_token: "abc123".to_string(),
            ws_url: Some("ws://127.0.0.1:9000".to_string()),
            running: false,
            restart_count: 0,
        };
        assert_eq!(inner.port, 9000);
        assert_eq!(inner.auth_token, "abc123");
        assert!(inner.ws_url.is_some());
        assert!(!inner.running);
        assert_eq!(inner.restart_count, 0);
    }

    /// WS URL is formatted correctly with port and encoded token.
    #[test]
    fn ws_url_format() {
        let port: u16 = 12345;
        let auth_token = "my secret token";
        let ws_url = format!(
            "ws://127.0.0.1:{}/?token={}",
            port,
            urlencoding::encode(auth_token)
        );
        assert!(ws_url.starts_with("ws://127.0.0.1:12345/?token="));
        assert!(ws_url.contains("my%20secret%20token"));
    }

    /// Exponential backoff calculation: capped at 10 000 ms.
    #[test]
    fn backoff_is_capped_at_10_seconds() {
        for restart_attempt in 0u32..=20 {
            let delay =
                std::cmp::min(500 * 2u64.pow(restart_attempt.saturating_sub(1)), 10_000);
            assert!(
                delay <= 10_000,
                "Delay exceeded cap at attempt {}: {}ms",
                restart_attempt,
                delay
            );
        }
    }

    /// Backoff starts at 500ms on the first retry (restart_attempt == 1).
    #[test]
    fn backoff_first_retry_is_500ms() {
        let restart_attempt: u32 = 1;
        let delay = std::cmp::min(500 * 2u64.pow(restart_attempt.saturating_sub(1)), 10_000);
        assert_eq!(delay, 500);
    }
}
