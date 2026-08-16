mod desktop;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, WebviewWindow, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartExt};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_updater::UpdaterExt;

/// 시작 직후 한 번, 그 뒤로는 이 간격마다 새 버전을 확인합니다.
/// 위젯은 며칠씩 켜져 있으므로 시작 시 한 번만으로는 부족합니다.
const UPDATE_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

/// 어디서든 할 일을 적을 수 있게 하는 전역 단축키.
/// 위젯을 클릭하러 가야 한다면 "나중에 적어야지"로 새는 항목이 생깁니다.
const QUICK_ADD: &str = "Ctrl+Alt+G";

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

/// 창은 숨은 채로 뜨고, 프런트가 내용에 맞춰 크기를 잡은 뒤 스스로 보여 줍니다.
///
/// 그런데 프런트가 그 전에 죽으면 창이 영영 안 보입니다. 트레이 메뉴로 꺼낼
/// 수는 있지만, 그걸 알아내야 하는 건 사용자 사정이 아닙니다. 그래서 시간이
/// 지나도 여전히 숨어 있으면 여기서 대신 보여 줍니다 — 잘려 보이는 편이
/// 안 보이는 것보다 낫습니다.
fn spawn_reveal_fallback(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(2500));
        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            if let Some(window) = inner.get_webview_window("main") {
                if !window.is_visible().unwrap_or(true) {
                    log::warn!("프런트가 창을 띄우지 못해 대신 보여 줍니다");
                    let _ = window.show();
                }
            }
        });
    });
}

/// 새 버전이 있으면 트레이 메뉴에 알립니다.
///
/// 찾자마자 받아서 설치하지는 않습니다. 설치는 앱 재시작을 뜻하는데, 할 일을
/// 적는 중에 창이 사라지면 그건 데이터를 잃는 것과 같습니다. 언제 설치할지는
/// 사용자가 정합니다.
async fn look_for_update(app: &AppHandle, item: &MenuItem<tauri::Wry>) {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(err) => {
            log::warn!("업데이터를 쓸 수 없습니다: {err}");
            return;
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            let _ = item.set_text(format!("업데이트 설치 (v{})", update.version));
            if let Some(tray) = app.tray_by_id("main-tray") {
                let _ = tray.set_tooltip(Some(format!("Gravitask — v{} 사용 가능", update.version)));
            }
            log::info!("새 버전 v{} 발견", update.version);
        }
        Ok(None) => {
            let _ = item.set_text("업데이트 확인");
        }
        Err(err) => {
            // 네트워크가 끊겨 있거나 릴리스가 아직 없으면 여기로 옵니다.
            // 위젯 본연의 기능과 무관하므로 조용히 넘어갑니다.
            log::info!("업데이트 확인 실패(무시): {err}");
        }
    }
}

/// 확인해서 있으면 받아 설치하고 다시 시작합니다.
///
/// 결과를 반드시 메뉴 항목에 되돌려 씁니다. 눌렀는데 아무 표시도 없으면
/// 사용자는 고장과 구분할 수 없습니다. 최신이라는 답도 답입니다.
async fn install_update(app: AppHandle, item: MenuItem<tauri::Wry>) {
    let _ = item.set_text("확인 중…");
    let _ = item.set_enabled(false);

    let outcome = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(err) => Err(err),
    };

    match outcome {
        Ok(Some(update)) => {
            let _ = item.set_text(format!("v{} 내려받는 중…", update.version));
            match update.download_and_install(|_, _| {}, || {}).await {
                Ok(_) => {
                    app.restart();
                }
                Err(err) => {
                    log::error!("업데이트 설치 실패: {err}");
                    let _ = item.set_text("설치 실패 — 다시 시도");
                }
            }
        }
        Ok(None) => {
            let _ = item.set_text("최신 버전입니다");
            // 잠시 뒤 원래 이름으로 돌립니다. 그대로 두면 다음에 눌러야 할
            // 버튼인지 알 수 없습니다.
            let revert = item.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(4));
                let _ = revert.set_text("업데이트 확인");
            });
        }
        Err(err) => {
            log::warn!("업데이트 확인 실패: {err}");
            let _ = item.set_text("확인 실패 — 연결 상태를 보세요");
            let revert = item.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(4));
                let _ = revert.set_text("업데이트 확인");
            });
        }
    }

    let _ = item.set_enabled(true);
}

/// 위젯은 다른 창 뒤에 깔리고 작업표시줄에도 뜨지 않습니다. 되찾을 수단이
/// 없으면 사용자 입장에서는 앱이 사라진 것과 구분되지 않습니다.
fn build_tray(app: &tauri::App, state: Arc<WidgetState>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "위젯 보이기", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "숨기기", true, None::<&str>)?;
    let pin = CheckMenuItem::with_id(app, "pin", "맨 앞에 고정", true, false, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;

    // 매일 쓰는 위젯이라 로그인할 때마다 직접 켜게 두면 금방 안 쓰게 됩니다.
    let autostart = app.autolaunch();
    let launch_on = autostart.is_enabled().unwrap_or(false);
    let boot = CheckMenuItem::with_id(app, "boot", "로그인 시 자동 시작", true, launch_on, None::<&str>)?;

    let update = MenuItem::with_id(app, "update", "업데이트 확인", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &hide, &pin, &boot, &sep, &update, &quit])?;
    let pin_ref = pin.clone();
    let boot_ref = boot.clone();
    let update_ref = update.clone();

    // 시작 직후 한 번, 이후 주기적으로 확인합니다.
    let handle = app.handle().clone();
    let watched = update.clone();
    std::thread::spawn(move || loop {
        let app = handle.clone();
        let item = watched.clone();
        tauri::async_runtime::spawn(async move { look_for_update(&app, &item).await });
        std::thread::sleep(UPDATE_INTERVAL);
    });

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
                "boot" => {
                    let on = boot_ref.is_checked().unwrap_or(false);
                    let launcher = app.autolaunch();
                    let result = if on { launcher.enable() } else { launcher.disable() };
                    if let Err(err) = result {
                        // 실패하면 체크 상태를 되돌립니다. 켜졌다고 표시해놓고
                        // 실제로는 안 켜지는 게 가장 나쁜 결과입니다.
                        log::warn!("자동 시작 설정 실패: {err}");
                        let _ = boot_ref.set_checked(!on);
                    }
                }
                "update" => {
                    let handle = app.clone();
                    let item = update_ref.clone();
                    tauri::async_runtime::spawn(async move { install_update(handle, item).await });
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
        // 창 위치를 기억합니다. 크기는 내용에 맞춰 우리가 직접 정하므로
        // POSITION만 저장합니다. SIZE까지 맡기면 복원된 크기와 우리가 계산한
        // 크기가 매번 다퉈 창이 들썩입니다.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::POSITION)
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        // 할 일과 주제를 앱 데이터 폴더의 JSON 파일에 둡니다. localStorage는
        // 브라우저가 언제든 비울 수 있고 출처에 묶여 있어 사용자 데이터를
        // 맡기기에 적절하지 않습니다.
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // 누르는 순간에만 반응합니다. 떼는 것까지 받으면 두 번 열립니다.
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        // 창을 띄우는 것만으로는 부족합니다. 입력칸에 커서까지
                        // 가 있어야 바로 타이핑할 수 있습니다.
                        let _ = window.emit("gravitask://focus-input", ());
                    }
                })
                .build(),
        )
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
            spawn_reveal_fallback(app.handle());

            if let Ok(shortcut) = QUICK_ADD.parse::<Shortcut>() {
                if let Err(err) = app.global_shortcut().register(shortcut) {
                    // 다른 앱이 이미 쓰고 있으면 등록에 실패합니다. 그래도
                    // 위젯 자체는 멀쩡히 동작해야 하므로 경고만 남깁니다.
                    log::warn!("전역 단축키 {QUICK_ADD} 등록 실패: {err}");
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
