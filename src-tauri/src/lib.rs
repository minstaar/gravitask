mod desktop;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, WebviewWindow, WindowEvent,
};

/// 위젯이 지금 어떤 자세를 하고 있는지.
///
/// 바탕화면에 붙은 창은 포커스 활성화 체인 밖에 있어서 마우스 메시지를 전혀
/// 받지 못합니다(WebView2의 입력 라우팅이 활성화를 전제로 하기 때문입니다).
/// 그래서 커서가 올라오면 잠깐 떼어 평범한 창으로 돌려놓고, 볼일이 끝나면
/// 다시 붙입니다. 사용자는 그냥 클릭하면 됩니다.
struct WidgetState {
    /// 트레이의 '바탕화면에 붙이기' 토글
    stick_enabled: AtomicBool,
    /// 지금 실제로 붙어 있는지
    attached: AtomicBool,
    /// 창이 포커스를 쥐고 있는지 — 입력 중에 다시 붙어버리면 안 됩니다
    focused: AtomicBool,
}

/// 커서가 벗어난 뒤 이만큼 지나야 다시 붙습니다.
/// 너무 짧으면 위젯 가장자리를 스칠 때마다 자세가 요동칩니다.
const REATTACH_DELAY: Duration = Duration::from_millis(700);
const POLL_INTERVAL: Duration = Duration::from_millis(80);

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

/// SetParent는 창을 소유한 스레드에서 불러야 안전합니다.
fn request_pin(app: &AppHandle, pinned: bool) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window("main") {
            set_pinned_to_desktop(&window, pinned);
        }
    });
}

/// 커서가 위젯 위로 올라오면 떼고, 벗어나면 다시 붙입니다.
///
/// 클릭을 기다리지 않고 호버에서 미리 떼는 이유: 부착 상태에서는 클릭 자체가
/// 창에 닿지 않으므로, 클릭으로 깨우려면 전역 후킹이 필요한 데다 그 첫 클릭은
/// 깨우는 데만 쓰이고 사라집니다. 호버에서 미리 떼어 두면 첫 클릭이 그대로
/// 체크박스에 꽂힙니다.
fn spawn_hover_watcher(app: &AppHandle, state: Arc<WidgetState>) {
    let handle = app.clone();

    std::thread::spawn(move || {
        let mut left_at: Option<Instant> = None;

        loop {
            std::thread::sleep(POLL_INTERVAL);

            if !state.stick_enabled.load(Ordering::Relaxed) {
                continue;
            }

            let Some(window) = handle.get_webview_window("main") else {
                continue;
            };
            let Some(hwnd) = raw_handle(&window) else {
                continue;
            };

            let over = desktop::cursor_over(hwnd);
            let attached = state.attached.load(Ordering::Relaxed);

            if over {
                left_at = None;
                if attached {
                    request_pin(&handle, false);
                    state.attached.store(false, Ordering::Relaxed);
                }
                continue;
            }

            if attached {
                continue;
            }

            // 입력 중이면 그대로 둡니다. 타이핑하다 창이 바탕화면으로
            // 내려앉으면 글자가 사라진 것처럼 보입니다.
            if state.focused.load(Ordering::Relaxed) {
                left_at = None;
                continue;
            }

            match left_at {
                None => left_at = Some(Instant::now()),
                Some(since) if since.elapsed() >= REATTACH_DELAY => {
                    request_pin(&handle, true);
                    state.attached.store(true, Ordering::Relaxed);
                    left_at = None;
                }
                _ => {}
            }
        }
    });
}

/// 위젯은 바탕화면에 붙거나 다른 창 뒤에 깔립니다. 어느 쪽이든 작업표시줄에
/// 뜨지 않으므로, 되찾을 수단이 없으면 사용자 입장에서는 앱이 사라진 것과
/// 구분되지 않습니다. 트레이가 그 수단입니다.
fn build_tray(app: &tauri::App, state: Arc<WidgetState>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "위젯 보이기", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "숨기기", true, None::<&str>)?;
    let stick = CheckMenuItem::with_id(app, "stick", "바탕화면에 붙이기", true, true, None::<&str>)?;
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
                    state.stick_enabled.store(stuck, Ordering::Relaxed);

                    if stuck {
                        let _ = pin_ref.set_checked(false);
                        let _ = window.set_always_on_top(false);
                    }
                    set_pinned_to_desktop(&window, stuck);
                    state.attached.store(stuck, Ordering::Relaxed);
                    let _ = window.set_always_on_bottom(!stuck);
                }
                "pin" => {
                    let pinned = pin_ref.is_checked().unwrap_or(false);
                    if pinned {
                        // 바탕화면에 붙어 있으면 아무리 위로 올려도 보이지 않습니다. 먼저 뗍니다.
                        let _ = stick_ref.set_checked(false);
                        state.stick_enabled.store(false, Ordering::Relaxed);
                        set_pinned_to_desktop(&window, false);
                        state.attached.store(false, Ordering::Relaxed);
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

            let state = Arc::new(WidgetState {
                stick_enabled: AtomicBool::new(true),
                attached: AtomicBool::new(false),
                focused: AtomicBool::new(false),
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

            // 부착은 setup()이 아니라 창이 자리 잡은 뒤에 해야 합니다. setup()
            // 시점에는 창이 아직 완성되지 않아 붙여도 표시 과정에서 풀립니다.
            let handle = app.handle().clone();
            let boot_state = state.clone();
            std::thread::spawn(move || {
                for attempt in 1..=5 {
                    std::thread::sleep(Duration::from_millis(600));

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
                        boot_state.attached.store(true, Ordering::Relaxed);
                        log::info!("바탕화면 부착 완료 ({}번째 시도)", attempt);
                        spawn_hover_watcher(&handle, boot_state);
                        return;
                    }
                }

                // 붙이기에 실패해도 앱은 계속 돌아야 합니다. 문서화되지 않은 셸
                // 동작에 기대는 코드이므로 실패는 정상 경로로 취급합니다.
                log::warn!("바탕화면 부착 실패 — always-on-bottom 창으로 동작합니다");
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
