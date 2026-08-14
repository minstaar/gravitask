use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager,
};

/// 위젯은 항상 다른 창 뒤에 깔리고 작업표시줄에도 뜨지 않습니다. 되찾을
/// 수단이 없으면 사용자 입장에서는 앱이 사라진 것과 구분되지 않습니다.
///
/// Win+D('바탕화면 보기')는 이 위젯을 다른 창들과 함께 치웁니다. 이걸
/// 견디게 하려고 WorkerW 부착, 호버 전환, 도구 창 변환을 차례로 시도했지만
/// 전부 실패했거나 더 큰 문제를 만들었습니다. 부착하면 WebView2가 마우스를
/// 전혀 받지 못해 클릭·드래그·스크롤이 죽고, 자세를 오가면 SetParent가
/// DWM 합성 상태를 초기화해 흰 번쩍임과 투명도 깨짐이 따라옵니다.
///
/// 웹뷰 기반 위젯에서는 '바탕화면에 붙어 있기'와 '조작 가능하기'가 양립하지
/// 않습니다. Rainmeter가 둘 다 되는 건 순수 Win32 창이라 자식 창에서도
/// 마우스 메시지를 직접 처리하기 때문이고, 웹뷰에는 그 경로가 없습니다.
/// 그래서 조작 가능한 쪽을 택하고, Win+D 뒤에는 트레이로 불러냅니다.
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
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
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                "hide" => {
                    let _ = window.hide();
                }
                "pin" => {
                    // 체크 항목은 클릭 시점에 이미 토글되어 있습니다.
                    let pinned = pin_ref.is_checked().unwrap_or(false);
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
