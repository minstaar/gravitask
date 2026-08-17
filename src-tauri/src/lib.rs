mod desktop;
mod ics;

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
use tauri_plugin_window_state::{AppHandleExt as WindowStateExt, StateFlags};

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

/// 옮긴 자리를 적어 두는 주기. 끌고 있는 동안은 쓰지 않고 손을 뗀 뒤에 씁니다.
const SAVE_INTERVAL: Duration = Duration::from_secs(2);

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

/// 옮겨 놓은 자리를 그때그때 적어 둡니다.
///
/// 플러그인은 앱이 정상적으로 끝날 때 저장합니다. 그런데 위젯이 꺼지는 방식에
/// 정상 종료만 있는 것이 아닙니다 — 업데이트 재시작, 작업 관리자에서 끝내기,
/// 로그오프, 정전. 그때마다 자리를 잊으면 사용자는 위젯을 매번 제자리로 다시
/// 끌어다 놓아야 하고, 그건 위젯을 두는 이유 자체를 갉아먹습니다.
///
/// 끌고 있는 동안 Moved가 수십 번 오므로 그때마다 파일을 쓰지는 않습니다.
/// 옮겨졌다는 표시만 남기고 여기서 몰아 씁니다.
fn spawn_position_saver(app: &AppHandle, moved: Arc<AtomicBool>) {
    let handle = app.clone();

    std::thread::spawn(move || loop {
        std::thread::sleep(SAVE_INTERVAL);

        if !moved.swap(false, Ordering::Relaxed) {
            continue;
        }

        save_position(&handle);
    });
}

/// 창 위치를 적어 둡니다. **반드시 메인 스레드에서.**
///
/// 플러그인은 상태 캐시를 잠근 채로 창에게 위치를 묻습니다. 그런데 그 물음은
/// 메인 스레드의 이벤트 루프를 거쳐야 답이 옵니다. 다른 스레드에서 부르면
/// '캐시를 쥔 채 메인 스레드를 기다리는' 모양이 되는데, 하필 그때 메인
/// 스레드가 창 이동 이벤트를 처리하며 같은 캐시를 잠그려 하면 둘이 서로를
/// 영원히 기다립니다. 창을 옮기는 순간 걸리는 덫입니다.
///
/// 그리고 메인 스레드가 멈추면 프런트에서 부른 명령이 하나도 돌아오지 않습니다.
/// 화면은 웹뷰가 따로 그리니 멀쩡해 보이는데, 적은 할 일이 디스크에 닿지
/// 못합니다 — 보이는데 저장되지 않는, 가장 나쁜 종류의 고장입니다.
///
/// 메인 스레드에서 부르면 잠금과 물음이 같은 스레드에서 차례로 일어나 기다릴
/// 일이 없습니다. 바탕화면에 창을 붙여 두는 쪽도 같은 이유로 이렇게 합니다.
fn save_position(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Err(err) = handle.save_window_state(StateFlags::POSITION) {
            log::warn!("창 위치를 저장하지 못했습니다: {err}");
        }
    });
}

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
async fn look_for_update(app: &AppHandle) {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(err) => {
            log::warn!("업데이터를 쓸 수 없습니다: {err}");
            return;
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            if let Some(tray) = app.tray_by_id("main-tray") {
                let _ = tray.set_tooltip(Some(format!("Gravitask — v{} 사용 가능", update.version)));
            }
            // 위젯이 직접 알립니다. 트레이 메뉴는 열어 봐야 보이는데, 열어 볼
            // 이유를 모르는 사람에게는 없는 것과 같습니다.
            let _ = app.emit("gravitask://update-available", update.version.clone());
            log::info!("새 버전 v{} 발견", update.version);
        }
        Ok(None) => {}
        Err(err) => {
            // 네트워크가 끊겨 있거나 릴리스가 아직 없으면 여기로 옵니다.
            // 위젯 본연의 기능과 무관하므로 조용히 넘어갑니다.
            log::info!("업데이트 확인 실패(무시): {err}");
        }
    }
}

/// 새 버전이 있으면 버전 문자열을, 없으면 None을 돌려줍니다.
///
/// 설정 화면이 트레이와 같은 코드를 씁니다. 확인과 설치가 두 벌이 되면 어느
/// 쪽이 무엇을 봤는지 어긋나는 순간 원인을 찾을 수 없게 됩니다.
#[tauri::command]
async fn check_update(app: AppHandle) -> Result<Option<String>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(Some(update.version)),
        Ok(None) => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

/// 받아서 설치하고 다시 시작합니다.
///
/// 진행률을 이벤트로 흘려보냅니다. 수십 MB를 받는 동안 화면이 멈춰 있으면
/// 사용자는 고장과 구분할 수 없습니다.
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "이미 최신 버전입니다".to_string())?;

    let mut got: u64 = 0;
    let progress = app.clone();
    let done = app.clone();

    update
        .download_and_install(
            move |chunk, total| {
                got += chunk as u64;
                let pct = total.map(|t| (got as f64 / t as f64 * 100.0).round() as u32);
                let _ = progress.emit("gravitask://update-progress", pct);
            },
            move || {
                let _ = done.emit("gravitask://update-progress", 100u32);
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    // 재시작 직전에 자리를 직접 적어 둡니다. restart()는 정상 종료 경로를 타지
    // 않아서, 플러그인이 저장할 기회를 얻지 못한 채 프로세스가 갈아치워집니다.
    // 업데이트 한 번에 위젯이 낯선 자리에 가 있는 이유가 이것입니다.
    //
    // 저장과 재시작을 한 덩어리로 메인 스레드에 맡깁니다. 이 명령은 비동기라
    // 메인 스레드가 아닌 곳에서 도는데, 거기서 저장을 부르면 멈춥니다
    // (save_position의 설명 참고). 그리고 순서가 지켜져야 합니다 — 저장을
    // 맡겨만 두고 여기서 재시작하면 적히기 전에 프로세스가 사라집니다.
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Err(err) = handle.save_window_state(StateFlags::POSITION) {
            log::warn!("재시작 전 창 위치를 저장하지 못했습니다: {err}");
        }
        handle.restart();
    });

    Ok(())
}

#[tauri::command]
fn autostart_enabled(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    let result = if enabled { launcher.enable() } else { launcher.disable() };
    result.map_err(|e| e.to_string())
}

/// 구독한 캘린더를 읽어 회차 목록으로 돌려줍니다.
///
/// 지난 것을 얼마나 남길지는 프런트가 정합니다. 무한정 펴면 매주 있는 수업이
/// 학기 내내 쌓이고, 아예 안 남기면 어제 놓친 것이 조용히 사라집니다.
#[tauri::command]
async fn fetch_calendar(
    handle: String,
    back_days: i64,
    ahead_days: i64,
) -> Result<Vec<ics::Occurrence>, String> {
    // 주소는 여기서만 꺼냅니다. 프런트는 손잡이만 들고 있습니다.
    let url = ics::read_url(&handle)?;
    let text = ics::fetch(&url).await?;
    let now = chrono::Utc::now();
    Ok(ics::expand(
        &text,
        now - chrono::Duration::days(back_days.clamp(0, 365)),
        now + chrono::Duration::days(ahead_days.clamp(1, 730)),
    ))
}

/// 캘린더 주소를 자격 증명 저장소에 넣습니다. 성공하면 손잡이만 남습니다.
#[tauri::command]
fn save_calendar_url(handle: String, url: String) -> Result<(), String> {
    ics::save_url(&handle, &url)
}

#[tauri::command]
fn forget_calendar_url(handle: String) -> Result<(), String> {
    ics::forget_url(&handle)
}

/// 위젯은 다른 창 뒤에 깔리고 작업표시줄에도 뜨지 않습니다. 되찾을 수단이
/// 없으면 사용자 입장에서는 앱이 사라진 것과 구분되지 않습니다.
fn build_tray(app: &tauri::App, state: Arc<WidgetState>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "위젯 보이기", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "숨기기", true, None::<&str>)?;
    let pin = CheckMenuItem::with_id(app, "pin", "맨 앞에 고정", true, false, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;

    // 자동 시작과 업데이트는 설정 화면에만 둡니다. 양쪽에 두면 한쪽을 바꿀
    // 때마다 다른 쪽 표시를 맞춰야 하고, 그 동기화가 어긋나는 순간 표시와 실제가
    // 달라집니다. 한 곳에만 있으면 어긋날 자리가 없습니다.
    let menu = Menu::with_items(app, &[&show, &hide, &pin, &sep, &quit])?;
    let pin_ref = pin.clone();

    // 시작 직후 한 번, 이후 주기적으로 확인합니다.
    let handle = app.handle().clone();
    std::thread::spawn(move || loop {
        let app = handle.clone();
        tauri::async_runtime::spawn(async move { look_for_update(&app).await });
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
        .invoke_handler(tauri::generate_handler![
            check_update,
            install_update,
            autostart_enabled,
            set_autostart,
            fetch_calendar,
            save_calendar_url,
            forget_calendar_url
        ])
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
                let moved = Arc::new(AtomicBool::new(false));
                let dirty = moved.clone();

                window.on_window_event(move |event| match event {
                    WindowEvent::Focused(focused) => {
                        focus_state.focused.store(*focused, Ordering::Relaxed);
                    }
                    WindowEvent::Moved(_) => dirty.store(true, Ordering::Relaxed),
                    _ => {}
                });

                spawn_position_saver(app.handle(), moved);
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
