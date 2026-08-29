//! 위젯을 '바탕화면 바로 위'에 세워 둡니다.
//!
//! Windows 쪽(windows.rs)이 폴링으로 겨우 지켜내는 자리가 macOS에는 이미
//! 있습니다. `alwaysOnBottom`이 창 레벨을 -1로 내리는데, 이건 모든 앱 창보다
//! 아래이면서 배경화면보다는 위입니다. 아무도 우리를 밀어내지 않으므로
//! 쫓아다닐 이유가 없습니다.
//!
//! 남는 문제는 "데스크탑 보기"입니다. Mission Control은 일반 창 레이어의
//! 창을 화면 밖으로 밀어내는데, 레벨 -1도 여전히 일반 창이라 같이 쓸려
//! 나갑니다. 위젯을 보려고 바탕화면을 부르는 것인데 그때 위젯이 사라지면
//! 앞뒤가 맞지 않습니다.
//!
//! 이건 z-order 문제가 아니라 창에 붙는 성질 하나로 풀립니다 —
//! `NSWindowCollectionBehavior.stationary`. 문서 표현 그대로 "Exposé의 영향을
//! 받지 않고 바탕화면 창처럼 제자리에 남는다"입니다.
//!
//! 레벨을 진짜 데스크탑 레벨까지 내리는 방법도 있고 macOS 바탕화면 위젯들이
//! 보통 그렇게 합니다. 하지만 그 자리는 Finder의 바탕화면 아이콘 창(-2147483603)
//! **아래**입니다. 그 창은 전체 화면이고 클릭을 받으므로, 내려가는 순간 위젯이
//! 눌리지 않는 그림이 됩니다. 저 앱들이 하나같이 '상호작용 모드' 토글을 따로
//! 두는 이유가 이것입니다. stationary는 레벨을 건드리지 않으므로 조작을
//! 내주지 않고 자리만 지킵니다.

use objc2::MainThreadMarker;
use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
use tauri::WebviewWindow;

/// 위젯을 Mission Control의 사정권 밖에 둡니다.
///
/// 한 번만 부르면 됩니다. 이건 매번 되돌려야 하는 상태가 아니라 창에 박히는
/// 성질입니다 — Windows 쪽이 80ms마다 자리를 되찾아야 하는 것과 다릅니다.
pub fn exempt_from_expose(window: &WebviewWindow) {
    // AppKit은 메인 스레드 밖에서 부르면 거부하지 않고 어긋납니다. 조용히
    // 틀리는 쪽이 더 나쁘므로 여기서 막고 흔적을 남깁니다.
    if MainThreadMarker::new().is_none() {
        log::warn!("메인 스레드가 아니라 창 성질을 바꾸지 않았습니다");
        return;
    }

    let ptr = match window.ns_window() {
        Ok(ptr) => ptr,
        Err(err) => {
            log::warn!("NSWindow를 얻지 못했습니다: {err}");
            return;
        }
    };

    // SAFETY: Tauri가 살아 있는 NSWindow를 넘겨주고, 위에서 메인 스레드임을
    // 확인했습니다.
    let ns: &NSWindow = unsafe { &*ptr.cast::<NSWindow>() };

    // 읽고-고치고-쓰기여야 합니다. tao가 `visibleOnAllWorkspaces`를 처리하며
    // CanJoinAllSpaces 비트만 따로 켜고 끄는데, 여기서 통째로 덮어쓰면 나중에
    // 부르는 쪽이 먼저 부른 쪽의 설정을 지웁니다.
    let behavior = ns.collectionBehavior()
        // 데스크탑 보기에도 남습니다. 이 줄이 이 파일의 존재 이유입니다.
        | NSWindowCollectionBehavior::Stationary
        // 어느 Space로 가든 바탕화면에 위젯이 있어야 합니다.
        | NSWindowCollectionBehavior::CanJoinAllSpaces
        // Cmd+`의 창 순환에서 뺍니다. 위젯은 '다음 창'이 될 만한 것이 아닙니다.
        | NSWindowCollectionBehavior::IgnoresCycle;

    ns.setCollectionBehavior(behavior);
}

/// 포커스에 따라 위젯을 내렸다 올립니다.
///
/// 레벨 -1에 못 박아 두면 다른 창에 한 번 가려졌을 때 클릭으로 꺼낼 방법이
/// 없습니다. Windows에서는 클릭하면 OS가 창을 올려 주고 포커스를 잃으면
/// 폴링이 도로 내리는데, 그 왕복을 여기서는 손으로 씁니다.
pub fn park(window: &WebviewWindow, focused: bool) {
    if let Err(err) = window.set_always_on_bottom(!focused) {
        log::warn!("창 레벨을 바꾸지 못했습니다: {err}");
    }
}
