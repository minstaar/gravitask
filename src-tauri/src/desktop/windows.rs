//! 위젯을 '바탕화면 바로 위'에 세워 둡니다.
//!
//! Win+D가 위젯을 숨기던 원인은 z-order였습니다. 측정해 보면 Win+D 순간
//! Progman(바탕화면)이 z-order 200에서 22로 솟아오릅니다. 우리 창은 25쯤에
//! 있었으니 그 아래로 밀리고, 배경화면이 위젯을 덮습니다. 창이 사라진 게
//! 아니라 가려진 것입니다. 그래서 IsIconic도 DWM cloaked도 반응하지 않고,
//! 최소화를 감시하는 방식으로는 영영 잡을 수 없었습니다.
//!
//! 범인은 alwaysOnBottom입니다. 창을 z-order 최하단에 못 박는데, 거기에는
//! 바탕화면보다 아래도 포함됩니다. 우리가 원하는 자리는 '모든 앱 창보다
//! 아래, 단 바탕화면보다는 위'입니다.
//!
//! 여기서는 z-order만 건드립니다. SetParent도 스타일 변경도 하지 않으므로
//! DWM 합성 상태가 초기화되지 않습니다. 흰 번쩍임이나 투명도 깨짐, 입력
//! 차단 같은 부작용이 없습니다.

use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    FindWindowW, GetWindow, SetWindowPos, GW_HWNDNEXT, GW_HWNDPREV, SWP_NOACTIVATE, SWP_NOMOVE,
    SWP_NOSIZE,
};

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn progman() -> HWND {
    unsafe { FindWindowW(wide("Progman").as_ptr(), null()) }
}

/// 이미 바탕화면 바로 위에 서 있는지.
pub fn is_parked(hwnd: isize) -> bool {
    let pm = progman();
    if pm.is_null() {
        return true; // 바탕화면을 못 찾으면 건드리지 않습니다
    }
    unsafe { GetWindow(hwnd as HWND, GW_HWNDNEXT) == pm }
}

/// 위젯을 바탕화면 바로 위로 옮깁니다.
///
/// SetWindowPos의 두 번째 인자는 '이 창 뒤에 놓아라'라는 뜻입니다. 그래서
/// Progman을 그대로 넘기면 바탕화면 *아래*로 가 버립니다. Progman 바로 위에
/// 있는 창을 찾아 그 뒤에 놓아야 원하는 자리가 됩니다.
pub fn park_above_desktop(hwnd: isize) -> bool {
    let window = hwnd as HWND;
    let pm = progman();
    if pm.is_null() {
        return false;
    }

    unsafe {
        if GetWindow(window, GW_HWNDNEXT) == pm {
            return true; // 이미 제자리
        }

        let above = GetWindow(pm, GW_HWNDPREV);
        // Progman이 맨 위면 그 위에 놓을 창이 없으니 최상단으로 보냅니다.
        // Win+D 중에는 다른 창이 다 물러나 있으므로 이게 곧 '바탕화면 위'입니다.
        let insert_after = if above.is_null() || above == window {
            null_mut() // HWND_TOP
        } else {
            above
        };

        SetWindowPos(
            window,
            insert_after,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        ) != 0
    }
}
