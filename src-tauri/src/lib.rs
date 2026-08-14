use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager,
};

/// 위젯은 항상 다른 창 뒤에 깔리고(always-on-bottom) 작업표시줄에도 뜨지 않습니다.
/// 바탕화면 위젯으로서는 올바른 동작이지만, 그 상태에서 되찾을 수단이 없으면
/// 사용자 입장에서는 앱이 사라진 것과 구분되지 않습니다. 트레이가 그 수단입니다.
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "위젯 보이기", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "숨기기", true, None::<&str>)?;
    // 잠깐 확인하고 싶을 때 맨 앞으로 끌어올립니다. 다시 끄면 원래대로 바닥에 깔립니다.
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
                    // 체크 항목은 클릭 시점에 이미 토글되어 있으므로 그 값을 그대로 씁니다.
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
