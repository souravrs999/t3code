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

/// Return the current backend process state (for debugging / health checks).
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
    pub port: u16,
    pub running: bool,
    pub restart_count: u32,
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
    use tauri_plugin_dialog::MessageDialogButtons;

    app.dialog()
        .message(message)
        .title("T3 Code")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Yes".to_string(),
            "No".to_string(),
        ))
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
    use std::sync::{Arc, Mutex};
    use tauri::menu::{MenuBuilder, MenuItemBuilder};

    let app = window.app_handle();
    let mut builder = MenuBuilder::new(app);

    // Track which items are destructive for separator insertion
    let mut has_non_destructive = false;
    let mut destructive_separator_added = false;

    for item in &items {
        if item.destructive.unwrap_or(false) && has_non_destructive && !destructive_separator_added
        {
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

    // Show the context menu.
    // WebviewWindow::popup_menu / popup_menu_at are the v2-correct APIs.
    if let Some(pos) = position {
        window
            .popup_menu_at(
                &menu,
                tauri::Position::Logical(tauri::LogicalPosition::new(pos.x, pos.y)),
            )
            .map_err(|e| e.to_string())?;
    } else {
        window.popup_menu(&menu).map_err(|e| e.to_string())?;
    }

    // popup_menu() is blocking on macOS — it returns after the menu is dismissed.
    // The menu event fires before popup_menu() returns, so try_recv() works.
    // Suppress unused-variable lint; event_id is kept in scope intentionally
    // so the listener outlives the popup call.
    let _ = event_id;

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
    // Validate URL scheme — only http/https are allowed
    let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Ok(false);
    }

    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| e.to_string())?;

    Ok(true)
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// ContextMenuItemInput can be constructed with all fields.
    #[test]
    fn context_menu_item_input_fields() {
        let item = ContextMenuItemInput {
            id: "delete".to_string(),
            label: "Delete".to_string(),
            destructive: Some(true),
        };
        assert_eq!(item.id, "delete");
        assert_eq!(item.label, "Delete");
        assert_eq!(item.destructive, Some(true));
    }

    /// destructive defaults to None when not supplied.
    #[test]
    fn context_menu_item_input_destructive_default() {
        let item = ContextMenuItemInput {
            id: "copy".to_string(),
            label: "Copy".to_string(),
            destructive: None,
        };
        assert!(item.destructive.is_none());
        // unwrap_or(false) behaviour matches JS default
        assert!(!item.destructive.unwrap_or(false));
    }

    /// MenuPosition stores x and y as f64.
    #[test]
    fn menu_position_fields() {
        let pos = MenuPosition { x: 100.5, y: 200.0 };
        assert!((pos.x - 100.5).abs() < f64::EPSILON);
        assert!((pos.y - 200.0).abs() < f64::EPSILON);
    }

    /// BackendInfo can be constructed and its fields are accessible.
    #[test]
    fn backend_info_fields() {
        let info = BackendInfo {
            port: 12345,
            running: true,
            restart_count: 3,
        };
        assert_eq!(info.port, 12345);
        assert!(info.running);
        assert_eq!(info.restart_count, 3);
    }

    /// open_external URL validation: http and https are valid schemes.
    /// (We test the scheme-parsing logic independently of the AppHandle.)
    #[test]
    fn url_scheme_validation() {
        let valid_urls = ["https://example.com", "http://example.com"];
        for url_str in &valid_urls {
            let parsed = url::Url::parse(url_str).expect("should parse");
            assert!(
                parsed.scheme() == "https" || parsed.scheme() == "http",
                "Expected http/https for {}",
                url_str
            );
        }

        let invalid_urls = ["file:///etc/passwd", "ftp://ftp.example.com", "javascript:alert(1)"];
        for url_str in &invalid_urls {
            let parsed = url::Url::parse(url_str).expect("should parse");
            assert!(
                parsed.scheme() != "https" && parsed.scheme() != "http",
                "Expected non-http/https for {}",
                url_str
            );
        }
    }
}
