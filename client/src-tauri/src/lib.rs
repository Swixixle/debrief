#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      let icon = app
        .default_window_icon()
        .expect("default window icon missing")
        .clone();
      let _tray = tauri::tray::TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("Debrief — ready")
        .build(app)?;
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![notify_complete, update_tray_tooltip])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[tauri::command]
fn notify_complete(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
  use tauri_plugin_notification::NotificationExt;
  app
    .notification()
    .builder()
    .title(title)
    .body(body)
    .show()
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn update_tray_tooltip(app: tauri::AppHandle, tooltip: String) -> Result<(), String> {
  if let Some(tray) = app.tray_by_id("main") {
    tray
      .set_tooltip(Some(tooltip))
      .map_err(|e| e.to_string())?;
  }
  Ok(())
}
