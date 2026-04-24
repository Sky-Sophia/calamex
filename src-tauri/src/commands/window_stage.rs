use tauri::{AppHandle, LogicalSize, Manager, Size, WebviewWindow};

const MAIN_WINDOW_LABEL: &str = "main";
const WELCOME_WINDOW_LABEL: &str = "welcome";
const MAIN_WINDOW_MIN_WIDTH: f64 = 1220.0;
const MAIN_WINDOW_MIN_HEIGHT: f64 = 760.0;
const WELCOME_WINDOW_WIDTH: f64 = 1024.0;
const WELCOME_WINDOW_HEIGHT: f64 = 680.0;

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
    window
        .set_focus()
        .map_err(|error| format!("failed to focus main window: {error}"))?;

    Ok(())
}

fn show_welcome_window(window: &WebviewWindow) -> Result<(), String> {
    window
        .set_resizable(false)
        .map_err(|error| format!("failed to lock welcome window resizable state: {error}"))?;
    window
        .set_size(Size::Logical(LogicalSize::new(
            WELCOME_WINDOW_WIDTH,
            WELCOME_WINDOW_HEIGHT,
        )))
        .map_err(|error| format!("failed to set welcome window size: {error}"))?;
    window
        .set_min_size(Some(Size::Logical(LogicalSize::new(
            WELCOME_WINDOW_WIDTH,
            WELCOME_WINDOW_HEIGHT,
        ))))
        .map_err(|error| format!("failed to set welcome window min size: {error}"))?;
    window
        .set_max_size(Some(Size::Logical(LogicalSize::new(
            WELCOME_WINDOW_WIDTH,
            WELCOME_WINDOW_HEIGHT,
        ))))
        .map_err(|error| format!("failed to set welcome window max size: {error}"))?;
    window
        .show()
        .map_err(|error| format!("failed to show welcome window: {error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("failed to focus welcome window: {error}"))?;

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
        "welcome" => {
            let window = resolve_window(&app, WELCOME_WINDOW_LABEL)?;
            show_welcome_window(&window)?;
            Ok(())
        }
        _ => Err(format!("unsupported window stage: {stage}")),
    }
}

#[tauri::command]
pub fn begin_startup_transition(app: AppHandle) -> Result<(), String> {
    let main_window = resolve_window(&app, MAIN_WINDOW_LABEL)?;
    let welcome_window = app.get_webview_window(WELCOME_WINDOW_LABEL);

    if let Some(welcome_window) = &welcome_window {
        welcome_window
            .hide()
            .map_err(|error| format!("failed to hide welcome window: {error}"))?;
    }

    if let Err(error) = show_main_window(&main_window) {
        if let Some(welcome_window) = &welcome_window {
            let _ = welcome_window.show();
            let _ = welcome_window.set_focus();
        }

        return Err(error);
    }

    Ok(())
}

#[tauri::command]
pub fn finalize_startup_transition(app: AppHandle) -> Result<(), String> {
    if let Some(welcome_window) = app.get_webview_window(WELCOME_WINDOW_LABEL) {
        let _ = welcome_window.hide();
        welcome_window
            .close()
            .map_err(|error| format!("failed to close welcome window: {error}"))?;
    }

    let main_window = resolve_window(&app, MAIN_WINDOW_LABEL)?;
    main_window
        .set_focus()
        .map_err(|error| format!("failed to refocus main window: {error}"))?;

    Ok(())
}
