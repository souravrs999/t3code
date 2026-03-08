use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    App, Emitter,
};

pub fn setup_menu(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let settings_item = MenuItemBuilder::with_id("open-settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    // macOS: the first submenu automatically becomes the "App Name" menu
    let app_menu = SubmenuBuilder::new(app, "T3 Code")
        .about(None)
        .separator()
        .item(&settings_item)
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

    let zoom_in_item = MenuItemBuilder::with_id("zoom-in", "Zoom In")
        .accelerator("CmdOrCtrl+=")
        .build(app)?;
    let zoom_in_plus_item = MenuItemBuilder::with_id("zoom-in-plus", "Zoom In")
        .accelerator("CmdOrCtrl+Plus")
        .build(app)?;
    let zoom_out_item = MenuItemBuilder::with_id("zoom-out", "Zoom Out")
        .accelerator("CmdOrCtrl+-")
        .build(app)?;
    let reset_zoom_item = MenuItemBuilder::with_id("reset-zoom", "Reset Zoom")
        .accelerator("CmdOrCtrl+0")
        .build(app)?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&reset_zoom_item)
        .item(&zoom_in_item)
        .item(&zoom_in_plus_item)
        .item(&zoom_out_item)
        .separator()
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

    let handle = app.handle().clone();
    app.on_menu_event(move |_app_handle, event| match event.id().0.as_str() {
        "open-settings" => {
            let _ = handle.emit("menu-action", "open-settings");
        }
        "zoom-in" | "zoom-in-plus" => {
            let _ = handle.emit("menu-action", "zoom-in");
        }
        "zoom-out" => {
            let _ = handle.emit("menu-action", "zoom-out");
        }
        "reset-zoom" => {
            let _ = handle.emit("menu-action", "reset-zoom");
        }
        _ => {}
    });

    Ok(())
}
