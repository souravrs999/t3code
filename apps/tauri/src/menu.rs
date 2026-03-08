use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    App, Emitter,
};

pub fn setup_menu(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    // Build the Settings item with a keyboard accelerator (Cmd+,)
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

    let view_menu = SubmenuBuilder::new(app, "View").fullscreen().build()?;

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

    // Handle custom menu events by forwarding them as Tauri events so the
    // frontend can react (e.g. navigate to the Settings page).
    let handle = app.handle().clone();
    app.on_menu_event(move |_app_handle, event| match event.id().0.as_str() {
        "open-settings" => {
            let _ = handle.emit("menu-action", "open-settings");
        }
        _ => {}
    });

    Ok(())
}
