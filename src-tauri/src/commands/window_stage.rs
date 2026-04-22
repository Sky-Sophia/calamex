use tauri::{window::Color, AppHandle, LogicalSize, Manager, Size};

const SPLASH_WINDOW_WIDTH: f64 = 780.0;
const SPLASH_WINDOW_HEIGHT: f64 = 520.0;
const MAIN_WINDOW_WIDTH: f64 = 1500.0;
const MAIN_WINDOW_HEIGHT: f64 = 960.0;
const MAIN_WINDOW_MIN_WIDTH: f64 = 1220.0;
const MAIN_WINDOW_MIN_HEIGHT: f64 = 760.0;
const MAIN_WINDOW_BACKGROUND: Color = Color(0x0D, 0x0F, 0x12, 0xFF);

fn apply_window_background(
    window: &tauri::WebviewWindow,
    color: Option<Color>,
    scene: &str,
) -> Result<(), String> {
    window
        .set_background_color(color)
        .map_err(|error| format!("failed to set {scene} window background: {error}"))
}

#[tauri::command]
pub fn apply_window_stage(app: AppHandle, stage: String) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "未找到主窗口。".to_string())?;

    match stage.as_str() {
        "splash" => {
            let splash_size =
                Size::Logical(LogicalSize::new(SPLASH_WINDOW_WIDTH, SPLASH_WINDOW_HEIGHT));
            apply_window_background(&window, None, "startup")?;
            window
                .set_min_size(Some(splash_size))
                .map_err(|error| format!("设置欢迎窗最小尺寸失败：{error}"))?;
            window
                .set_size(splash_size)
                .map_err(|error| format!("设置欢迎窗尺寸失败：{error}"))?;
            window
                .set_resizable(false)
                .map_err(|error| format!("锁定欢迎窗尺寸失败：{error}"))?;
            window
                .center()
                .map_err(|error| format!("居中欢迎窗失败：{error}"))?;
        }
        "main" => {
            let main_size = Size::Logical(LogicalSize::new(MAIN_WINDOW_WIDTH, MAIN_WINDOW_HEIGHT));
            let main_min_size = Size::Logical(LogicalSize::new(
                MAIN_WINDOW_MIN_WIDTH,
                MAIN_WINDOW_MIN_HEIGHT,
            ));

            apply_window_background(&window, Some(MAIN_WINDOW_BACKGROUND), "main")?;
            window
                .set_resizable(true)
                .map_err(|error| format!("恢复主窗口缩放失败：{error}"))?;
            window
                .set_size(main_size)
                .map_err(|error| format!("恢复主窗口尺寸失败：{error}"))?;
            window
                .set_min_size(Some(main_min_size))
                .map_err(|error| format!("设置主窗口最小尺寸失败：{error}"))?;
            window
                .center()
                .map_err(|error| format!("居中主窗口失败：{error}"))?;
            window
                .set_focus()
                .map_err(|error| format!("聚焦主窗口失败：{error}"))?;
        }
        _ => return Err(format!("不支持的窗口阶段：{stage}")),
    }

    Ok(())
}

#[tauri::command]
pub fn show_startup_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "未找到主窗口。".to_string())?;

    let splash_size = Size::Logical(LogicalSize::new(SPLASH_WINDOW_WIDTH, SPLASH_WINDOW_HEIGHT));
    apply_window_background(&window, None, "startup")?;
    window
        .set_min_size(Some(splash_size))
        .map_err(|error| format!("设置欢迎窗最小尺寸失败：{error}"))?;
    window
        .set_size(splash_size)
        .map_err(|error| format!("设置欢迎窗尺寸失败：{error}"))?;
    window
        .set_resizable(false)
        .map_err(|error| format!("锁定欢迎窗尺寸失败：{error}"))?;
    window
        .center()
        .map_err(|error| format!("居中欢迎窗失败：{error}"))?;
    window
        .show()
        .map_err(|error| format!("显示欢迎窗失败：{error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("聚焦欢迎窗失败：{error}"))?;

    Ok(())
}
