mod desktop;

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager, WebviewWindow,
};

/// 창 핸들을 Win32에 넘길 수 있는 형태로 꺼냅니다.
/// tauri가 쓰는 windows 크레이트 버전과 우리 windows-sys 버전이 다를 수 있으므로
/// 타입을 직접 주고받지 않고 raw 값으로만 건넵니다.
#[cfg(windows)]
fn raw_handle(window: &WebviewWindow) -> Option<isize> {
    window.hwnd().ok().map(|h| h.0 as isize)
}

#[cfg(not(windows))]
fn raw_handle(_window: &WebviewWindow) -> Option<isize> {
    None
}

#[cfg(windows)]
fn set_pinned_to_desktop(window: &WebviewWindow, pinned: bool) -> bool {
    let Some(hwnd) = raw_handle(window) else {
        return false;
    };

    // 붙이고 떼면 창 좌표계가 바뀝니다(부모 기준 ↔ 화면 기준).
    // 눈에 띄게 튀지 않도록 위치를 기억했다가 되돌려 놓습니다.
    let position = window.outer_position().ok();

    let ok = if pinned {
        desktop::attach(hwnd)
    } else {
        desktop::detach(hwnd)
    };

    if let Some(pos) = position {
        let _ = window.set_position(tauri::PhysicalPosition::new(pos.x, pos.y));
    }

    ok
}

#[cfg(not(windows))]
fn set_pinned_to_desktop(_window: &WebviewWindow, _pinned: bool) -> bool {
    false
}

/// 위젯은 항상 다른 창 뒤에 깔리고 작업표시줄에도 뜨지 않습니다. 바탕화면
/// 위젯으로서는 올바른 동작이지만, 그 상태에서 되찾을 수단이 없으면 사용자
/// 입장에서는 앱이 사라진 것과 구분되지 않습니다. 트레이가 그 수단입니다.
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "위젯 보이기", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "숨기기", true, None::<&str>)?;

    // 바탕화면에 붙으면 Win+D가 숨기지 않습니다. 이게 기본 자세입니다.
    let stick = CheckMenuItem::with_id(app, "stick", "바탕화면에 붙이기", true, true, None::<&str>)?;
    // 잠깐 확인하고 싶을 때 맨 앞으로 끌어올립니다. 바탕화면 부착과는 공존할 수 없습니다.
    let pin = CheckMenuItem::with_id(app, "pin", "맨 앞에 고정", true, false, None::<&str>)?;

    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &hide, &stick, &pin, &sep, &quit])?;
    let stick_ref = stick.clone();
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
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                "hide" => {
                    let _ = window.hide();
                }
                "stick" => {
                    // 체크 항목은 클릭 시점에 이미 토글되어 있으므로 그 값을 그대로 씁니다.
                    let stuck = stick_ref.is_checked().unwrap_or(false);
                    if stuck {
                        // 바탕화면에 붙는 순간 '맨 앞'은 성립하지 않습니다.
                        let _ = pin_ref.set_checked(false);
                        let _ = window.set_always_on_top(false);
                    }
                    set_pinned_to_desktop(&window, stuck);
                    let _ = window.set_always_on_bottom(!stuck);
                }
                "pin" => {
                    let pinned = pin_ref.is_checked().unwrap_or(false);
                    if pinned {
                        // 바탕화면에 붙어 있으면 아무리 위로 올려도 보이지 않습니다. 먼저 뗍니다.
                        let _ = stick_ref.set_checked(false);
                        set_pinned_to_desktop(&window, false);
                    }
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

            build_tray(app)?;

            // 바탕화면 부착이 기본값입니다. 트레이에서 끌 수 있습니다.
            //
            // setup() 시점에 붙이면 안 됩니다. 창이 아직 완전히 만들어지지 않아서
            // 붙여도 이후 표시 과정에서 풀립니다. 창이 자리를 잡은 뒤에 붙이고,
            // 셸이 늦게 뜨는 경우를 대비해 몇 번 재시도합니다.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                for attempt in 1..=5 {
                    std::thread::sleep(std::time::Duration::from_millis(600));

                    let probe = handle.clone();
                    let inner = handle.clone();
                    let (tx, rx) = std::sync::mpsc::channel();
                    let sent = probe.run_on_main_thread(move || {
                        let ok = inner
                            .get_webview_window("main")
                            .map(|w| set_pinned_to_desktop(&w, true))
                            .unwrap_or(false);
                        let _ = tx.send(ok);
                    });

                    if sent.is_ok() && rx.recv().unwrap_or(false) {
                        log::info!("바탕화면 부착 완료 ({}번째 시도)", attempt);
                        return;
                    }
                }

                // 붙이기에 실패해도 앱은 계속 돌아야 합니다. 문서화되지 않은 셸
                // 동작에 기대는 코드이므로 실패는 정상 경로로 취급합니다.
                // 이 경우 always-on-bottom 창으로 남고, Win+D에 숨겨집니다.
                log::warn!("바탕화면 부착 실패 — always-on-bottom 창으로 동작합니다");
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
