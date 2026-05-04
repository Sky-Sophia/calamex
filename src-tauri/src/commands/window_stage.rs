use tauri::{AppHandle, LogicalSize, Manager, Size, WebviewWindow};

const MAIN_WINDOW_LABEL: &str = "main";
const MAIN_WINDOW_MIN_WIDTH: f64 = 1220.0;
const MAIN_WINDOW_MIN_HEIGHT: f64 = 760.0;

fn resolve_window(app: &AppHandle, label: &str) -> Result<WebviewWindow, String> {
    app.get_webview_window(label)
        .ok_or_else(|| format!("window not found: {label}"))
}

fn show_main_window(window: &WebviewWindow) -> Result<(), String> {
    let main_min_size = Size::Logical(LogicalSize::new(
        MAIN_WINDOW_MIN_WIDTH,
        MAIN_WINDOW_MIN_HEIGHT,
    ));

    let _ = window.unminimize();
    window
        .set_resizable(true)
        .map_err(|error| format!("failed to restore main window resizable state: {error}"))?;
    window
        .set_min_size(Some(main_min_size))
        .map_err(|error| format!("failed to set main window min size: {error}"))?;
    window
        .show()
        .map_err(|error| format!("failed to show main window: {error}"))?;

    Ok(())
}

#[tauri::command]
pub fn apply_window_stage(app: AppHandle, stage: String) -> Result<(), String> {
    match stage.as_str() {
        "main" => {
            let window = resolve_window(&app, MAIN_WINDOW_LABEL)?;
            show_main_window(&window)?;
            Ok(())
        }
        _ => Err(format!("unsupported window stage: {stage}")),
    }
}
