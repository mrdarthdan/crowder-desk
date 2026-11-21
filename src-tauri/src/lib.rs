use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_window_state::StateFlags;

#[derive(serde::Serialize)]
struct VaultInfo {
    name: String,
    daily_folder: String,
    daily_format: String,
}

fn vault_root(vault: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(vault.trim());
    if !root.join(".obsidian").is_dir() {
        return Err("That folder isn't an Obsidian vault (no .obsidian folder in it).".into());
    }
    Ok(root)
}

/// Joins a vault-relative note path, refusing anything that could leave the vault.
fn note_path(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = Path::new(rel);
    if rel.is_absolute() {
        return Err("Note path must be inside the vault.".into());
    }
    for c in rel.components() {
        match c {
            Component::Normal(_) | Component::CurDir => {}
            _ => return Err("Note path must be inside the vault.".into()),
        }
    }
    Ok(root.join(rel))
}

/// Reads the vault name and the Daily Notes plugin's folder and date format, if set.
#[tauri::command]
fn vault_info(vault: String) -> Result<VaultInfo, String> {
    let root = vault_root(&vault)?;
    let name = root
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let mut daily_folder = String::new();
    let mut daily_format = "YYYY-MM-DD".to_string();
    if let Ok(txt) = std::fs::read_to_string(root.join(".obsidian").join("daily-notes.json")) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
            if let Some(f) = v.get("folder").and_then(|x| x.as_str()) {
                daily_folder = f.trim_matches('/').to_string();
            }
            if let Some(f) = v.get("format").and_then(|x| x.as_str()) {
                if !f.trim().is_empty() {
                    daily_format = f.trim().to_string();
                }
            }
        }
    }
    Ok(VaultInfo { name, daily_folder, daily_format })
}

/// Appends a line to a note in the vault, creating the note (and folders) if needed.
/// Returns the vault-relative path that was written.
#[tauri::command]
fn append_note(vault: String, note: String, text: String) -> Result<String, String> {
    let root = vault_root(&vault)?;
    let mut rel = note.trim().replace('\\', "/").trim_matches('/').to_string();
    if rel.is_empty() {
        return Err("No note name set.".into());
    }
    if !rel.to_lowercase().ends_with(".md") {
        rel.push_str(".md");
    }
    let path = note_path(&root, &rel)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let needs_newline = std::fs::read(&path)
        .map(|b| !b.is_empty() && !b.ends_with(b"\n"))
        .unwrap_or(false);
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    let line = format!("{}{}\n", if needs_newline { "\n" } else { "" }, text.trim_end());
    f.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    Ok(rel)
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn toggle_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            show_main(app);
        }
    }
}

/// Opens (or reuses) the recipe viewer window for a Plico recipe id.
/// Async so window creation doesn't deadlock on Windows.
#[tauri::command]
async fn open_recipe(app: AppHandle, id: String) -> Result<(), String> {
    // Plico ids are slugs; keep only safe characters before putting the id in a script.
    let safe: String = id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if safe.is_empty() {
        return Err("invalid recipe id".into());
    }

    if let Some(w) = app.get_webview_window("recipe") {
        w.eval(&format!("window.loadRecipe && window.loadRecipe('{safe}')"))
            .map_err(|e| e.to_string())?;
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, "recipe", WebviewUrl::App("recipe.html".into()))
        .title("Recipe · Crowder Desk")
        .inner_size(560.0, 780.0)
        .min_inner_size(420.0, 480.0)
        .initialization_script(&format!("window.__RECIPE_ID__ = '{safe}';"))
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second launch just brings the existing widget forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::POSITION | StateFlags::SIZE)
                .with_denylist(&["recipe"])
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .invoke_handler(tauri::generate_handler![open_recipe, vault_info, append_note])
        .setup(|app| {
            let toggle = MenuItem::with_id(app, "toggle", "Show / hide widget", true, None::<&str>)?;
            let refresh = MenuItem::with_id(app, "refresh", "Refresh now", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Crowder Desk", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle, &refresh, &settings, &sep, &quit])?;

            let mut tray = TrayIconBuilder::with_id("crowder-desk-tray")
                .tooltip("Crowder Desk")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => toggle_main(app),
                    "refresh" => {
                        let _ = app.emit_to("main", "tray-action", "refresh");
                    }
                    "settings" => {
                        show_main(app);
                        let _ = app.emit_to("main", "tray-action", "settings");
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the widget (Alt+F4) hides it to the tray instead of quitting.
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Crowder Desk");
}
