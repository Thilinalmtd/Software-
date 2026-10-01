use tauri::Manager;

/// True when the build was configured with an updater signing key (see docs/SETUP.md).
#[tauri::command]
fn updater_enabled(app: tauri::AppHandle) -> bool {
    app.config().plugins.0.contains_key("updater")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first: a second launch focuses the existing window instead.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // The updater plugin refuses to start without a public key, so only
            // register it when the release build injected one.
            if app.config().plugins.0.contains_key("updater") {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![updater_enabled])
        .run(tauri::generate_context!())
        .expect("error while running AptoCAD Finance");
}
