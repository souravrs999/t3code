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
