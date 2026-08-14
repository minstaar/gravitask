mod desktop;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, WebviewWindow, WindowEvent,
};

struct WidgetState {
    /// 창이 포커스를 쥐고 있는지. 조작 중에는 아래로 내리지 않습니다.
    focused: AtomicBool,
    /// 트레이의 '맨 앞에 고정'. 켜져 있으면 자리 유지를 하지 않습니다.
    pinned: AtomicBool,
    /// 사용자가 트레이에서 직접 숨겼는지.
    hidden: AtomicBool,
}

/// Win+D 순간 Progman이 솟아오르는 것을 사람 눈에 띄기 전에 따라잡는 간격.
const PARK_INTERVAL: Duration = Duration::from_millis(80);

#[cfg(windows)]
fn raw_handle(window: &WebviewWindow) -> Option<isize> {
    window.hwnd().ok().map(|h| h.0 as isize)
}

#[cfg(not(windows))]
fn raw_handle(_window: &WebviewWindow) -> Option<isize> {
    None
}

/// 위젯을 '바탕화면 바로 위'에 세워 둡니다.
///
/// alwaysOnBottom을 쓰지 않는 이유는 그것이 바탕화면보다도 아래로 보내기
/// 때문입니다. 대신 포커스가 없을 때마다 이 자리로 되돌려 놓으면, 다른 앱
/// 창보다는 항상 아래에 있으면서 Win+D로 바탕화면이 올라와도 가려지지
/// 않습니다. 조작하려고 클릭하면 Windows가 창을 올려 주고, 다른 곳을
/// 클릭해 포커스를 잃으면 다시 제자리로 내려갑니다.
#[cfg(windows)]
fn spawn_desktop_parker(app: &AppHandle, state: Arc<WidgetState>) {
    let handle = app.clone();

    std::thread::spawn(move || loop {
        std::thread::sleep(PARK_INTERVAL);

        if state.pinned.load(Ordering::Relaxed)
            || state.hidden.load(Ordering::Relaxed)
            || state.focused.load(Ordering::Relaxed)
        {
            continue;
        }

        let Some(window) = handle.get_webview_window("main") else {
            continue;
        };
        let Some(hwnd) = raw_handle(&window) else {
            continue;
        };

        // 이미 제자리면 아무것도 하지 않습니다. 매번 SetWindowPos를 부르면
        // 다른 창의 z-order 변경과 불필요하게 다투게 됩니다.
        if desktop::is_parked(hwnd) {
            continue;
        }

        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            if let Some(window) = inner.get_webview_window("main") {
                if let Some(hwnd) = raw_handle(&window) {
                    desktop::park_above_desktop(hwnd);
                }
            }
        });
    });
}

#[cfg(not(windows))]
fn spawn_desktop_parker(_app: &AppHandle, _state: Arc<WidgetState>) {}

/// 위젯은 다른 창 뒤에 깔리고 작업표시줄에도 뜨지 않습니다. 되찾을 수단이
/// 없으면 사용자 입장에서는 앱이 사라진 것과 구분되지 않습니다.
fn build_tray(app: &tauri::App, state: Arc<WidgetState>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "위젯 보이기", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "숨기기", true, None::<&str>)?;
    let pin = CheckMenuItem::with_id(app, "pin", "맨 앞에 고정", true, false, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &hide, &pin, &sep, &quit])?;
    let pin_ref = pin.clone();

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Gravitask")
        .menu(&menu)
        .on_menu_event(move |app, event| {
            let Some(window) = app.get_webview_window("main") else {
                return;
            };

            match event.id.as_ref() {
                "show" => {
                    state.hidden.store(false, Ordering::Relaxed);
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                "hide" => {
                    state.hidden.store(true, Ordering::Relaxed);
                    let _ = window.hide();
                }
                "pin" => {
                    // 체크 항목은 클릭 시점에 이미 토글되어 있습니다.
                    let pinned = pin_ref.is_checked().unwrap_or(false);
                    state.pinned.store(pinned, Ordering::Relaxed);
                    let _ = window.set_always_on_top(pinned);
                    if pinned {
                        let _ = window.set_focus();
                    }
                }
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let state = Arc::new(WidgetState {
                focused: AtomicBool::new(false),
                pinned: AtomicBool::new(false),
                hidden: AtomicBool::new(false),
            });

            build_tray(app, state.clone())?;

            if let Some(window) = app.get_webview_window("main") {
                let focus_state = state.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::Focused(focused) = event {
                        focus_state.focused.store(*focused, Ordering::Relaxed);
                    }
                });
            }

            spawn_desktop_parker(app.handle(), state);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
