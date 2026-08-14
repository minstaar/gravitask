mod desktop;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    window::{Color, Effect, EffectState, EffectsBuilder},
    AppHandle, Manager, WebviewWindow,
};

/// 위젯의 표시 정책.
struct WidgetState {
    /// 트레이의 '바탕화면에 유지' — Win+D가 치워도 되살릴지
    keep_on_desktop: AtomicBool,
    /// 사용자가 트레이에서 직접 숨겼는지. 이때는 되살리면 안 됩니다.
    user_hidden: AtomicBool,
}

/// 100ms면 Win+D 직후 깜빡임이 눈에 띄기 전에 되살아납니다.
/// 더 짧게 잡아도 체감 이득이 없고 폴링만 늘어납니다.
const KEEPER_INTERVAL: Duration = Duration::from_millis(100);

#[cfg(windows)]
fn raw_handle(window: &WebviewWindow) -> Option<isize> {
    window.hwnd().ok().map(|h| h.0 as isize)
}

#[cfg(not(windows))]
fn raw_handle(_window: &WebviewWindow) -> Option<isize> {
    None
}

/// 최소화에서 복귀할 때 DWM이 합성 상태를 놓치는 경우가 있어 다시 걸어줍니다.
fn reapply_effects(window: &WebviewWindow) {
    let _ = window.set_effects(
        EffectsBuilder::new()
            .effect(Effect::Acrylic)
            .state(EffectState::Active)
            .radius(16.0)
            .color(Color(18, 19, 27, 190))
            .build(),
    );
}

/// '바탕화면 보기'가 위젯을 치우면 조용히 제자리로 돌려놓습니다.
///
/// Win+D는 모든 최상위 창을 치웁니다. 바탕화면 위젯에게는 그게 정확히
/// 반대로 동작해야 하는 순간이라 — 사용자가 바탕화면을 보려는 것이지
/// 위젯을 치우려는 게 아니니까 — 되살립니다.
#[cfg(windows)]
fn spawn_desktop_keeper(app: &AppHandle, state: Arc<WidgetState>) {
    let handle = app.clone();

    // 스타일을 되돌리는 쪽과 무한히 다투지 않도록 교정 횟수를 제한합니다.
    let mut style_fixes = 0;

    std::thread::spawn(move || loop {
        std::thread::sleep(KEEPER_INTERVAL);

        if !state.keep_on_desktop.load(Ordering::Relaxed) {
            continue;
        }

        // Tauri가 창 설정을 마무리하면서 확장 스타일을 되돌립니다. setup()에서
        // 한 번 걸어봐야 덮이므로, 되돌려졌으면 여기서 다시 겁니다.
        if style_fixes < 5 {
            if let Some(window) = handle.get_webview_window("main") {
                if let Some(hwnd) = raw_handle(&window) {
                    if !desktop::is_tool_window(hwnd) {
                        style_fixes += 1;
                        let inner = handle.clone();
                        let _ = handle.run_on_main_thread(move || {
                            if let Some(window) = inner.get_webview_window("main") {
                                if let Some(hwnd) = raw_handle(&window) {
                                    desktop::make_tool_window(hwnd);
                                }
                                let _ = window.set_always_on_bottom(true);
                                reapply_effects(&window);
                            }
                        });
                    }
                }
            }
        }
        // 사용자가 직접 숨긴 창을 되살리면 트레이 메뉴가 고장난 것처럼 보입니다.
        if state.user_hidden.load(Ordering::Relaxed) {
            continue;
        }

        let Some(window) = handle.get_webview_window("main") else {
            continue;
        };
        let Some(hwnd) = raw_handle(&window) else {
            continue;
        };

        if !desktop::is_swept_away(hwnd) {
            continue;
        }

        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            let Some(window) = inner.get_webview_window("main") else {
                return;
            };
            if let Some(hwnd) = raw_handle(&window) {
                desktop::restore_without_activating(hwnd);
            }
            // 되살아난 창이 다른 앱 위로 튀어나오면 안 됩니다.
            let _ = window.set_always_on_bottom(true);
            reapply_effects(&window);
        });
    });
}

#[cfg(not(windows))]
fn spawn_desktop_keeper(_app: &AppHandle, _state: Arc<WidgetState>) {}

/// 위젯은 항상 다른 창 뒤에 깔리고 작업표시줄에도 뜨지 않습니다. 되찾을
/// 수단이 없으면 사용자 입장에서는 앱이 사라진 것과 구분되지 않습니다.
fn build_tray(app: &tauri::App, state: Arc<WidgetState>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "위젯 보이기", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "숨기기", true, None::<&str>)?;
    let keep = CheckMenuItem::with_id(app, "keep", "바탕화면에 유지", true, true, None::<&str>)?;
    let pin = CheckMenuItem::with_id(app, "pin", "맨 앞에 고정", true, false, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &hide, &keep, &pin, &sep, &quit])?;
    let keep_ref = keep.clone();
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
                    state.user_hidden.store(false, Ordering::Relaxed);
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                "hide" => {
                    state.user_hidden.store(true, Ordering::Relaxed);
                    let _ = window.hide();
                }
                "keep" => {
                    // 체크 항목은 클릭 시점에 이미 토글되어 있습니다.
                    let keep_on = keep_ref.is_checked().unwrap_or(false);
                    state.keep_on_desktop.store(keep_on, Ordering::Relaxed);
                }
                "pin" => {
                    let pinned = pin_ref.is_checked().unwrap_or(false);
                    // 맨 앞에 고정하는 동안에는 바탕화면 유지가 의미 없습니다.
                    let _ = keep_ref.set_checked(!pinned);
                    state.keep_on_desktop.store(!pinned, Ordering::Relaxed);

                    let _ = window.set_always_on_bottom(!pinned);
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
                keep_on_desktop: AtomicBool::new(true),
                user_hidden: AtomicBool::new(false),
            });

            build_tray(app, state.clone())?;

            // Win+D를 견디는 진짜 수단. 감시자는 이게 통하지 않는 상황을 위한
            // 보험일 뿐이고, 창을 도구 창으로 바꾸는 것이 정공법입니다.
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                if let Some(hwnd) = raw_handle(&window) {
                    if desktop::make_tool_window(hwnd) {
                        log::info!("도구 창으로 전환 완료");
                    } else {
                        log::warn!("도구 창 전환 실패 — Win+D에 숨겨질 수 있습니다");
                    }
                }
                let _ = window.set_always_on_bottom(true);
                reapply_effects(&window);
            }

            spawn_desktop_keeper(app.handle(), state);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
