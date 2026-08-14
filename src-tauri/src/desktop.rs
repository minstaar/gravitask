//! 위젯이 바탕화면에 남아 있게 합니다.
//!
//! 예전에는 창을 Progman/WorkerW에 SetParent로 붙였습니다. Win+D는 완벽히
//! 견뎠지만 대가가 컸습니다. 붙은 창은 포커스 활성화 체인 밖이라 WebView2가
//! 마우스를 전혀 받지 못했고(클릭·드래그·스크롤 전부 죽음), SetParent를 부를
//! 때마다 DWM 합성 상태가 초기화돼 흰 번쩍임과 투명도 깨짐이 따라왔습니다.
//!
//! 지금은 붙이지 않습니다. 평범한 always-on-bottom 창으로 두고, '바탕화면
//! 보기'가 우리를 치웠을 때만 되살립니다. 입력은 늘 살아 있고, 합성 상태를
//! 건드리지 않으니 번쩍임도 없습니다. 대가는 Win+D 순간의 짧은 깜빡임입니다.

#![cfg(windows)]

use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, IsIconic, IsWindowVisible, SetWindowLongPtrW, ShowWindow, GWL_EXSTYLE,
    SW_HIDE, SW_SHOWNOACTIVATE, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
};

/// 창을 '도구 창'으로 바꿉니다.
///
/// 이게 Win+D 문제의 핵심입니다. 평범한 앱 창은 '바탕화면 보기'가 최소화하지만
/// 도구 창은 그 대상에서 제외됩니다. 바탕화면 위젯이 SetParent 같은 편법 없이
/// 살아남는 표준 방법이 이것입니다.
///
/// tauri.conf.json의 skipTaskbar만으로는 부족했습니다. 실제 창을 재보니
/// WS_EX_TOOLWINDOW는 꺼져 있고 WS_EX_APPWINDOW가 켜져 있었습니다.
/// APPWINDOW는 '작업표시줄에 반드시 표시하라'는 뜻이라 TOOLWINDOW를 무력화하므로
/// 함께 꺼야 합니다.
/// 지금 도구 창인지. 스타일을 되돌리는 쪽이 있어서 계속 확인해야 합니다.
pub fn is_tool_window(hwnd: isize) -> bool {
    unsafe {
        let ex = GetWindowLongPtrW(hwnd as HWND, GWL_EXSTYLE);
        (ex & WS_EX_TOOLWINDOW as isize) != 0 && (ex & WS_EX_APPWINDOW as isize) == 0
    }
}

pub fn make_tool_window(hwnd: isize) -> bool {
    let h = hwnd as HWND;

    unsafe {
        let current = GetWindowLongPtrW(h, GWL_EXSTYLE);
        let updated =
            (current & !(WS_EX_APPWINDOW as isize)) | (WS_EX_TOOLWINDOW as isize);

        if current == updated {
            return true;
        }

        SetWindowLongPtrW(h, GWL_EXSTYLE, updated);

        // 확장 스타일 변경은 창을 숨겼다 다시 띄워야 셸에 반영됩니다.
        // 그냥 두면 작업표시줄과 Show Desktop이 예전 스타일로 계속 취급합니다.
        ShowWindow(h, SW_HIDE);
        ShowWindow(h, SW_SHOWNOACTIVATE);

        GetWindowLongPtrW(h, GWL_EXSTYLE) == updated
    }
}

/// '바탕화면 보기'는 창을 최소화하기도 하고 그냥 감추기도 해서 둘 다 봅니다.
pub fn is_swept_away(hwnd: isize) -> bool {
    let h = hwnd as HWND;
    unsafe { IsIconic(h) != 0 || IsWindowVisible(h) == 0 }
}

/// 포커스를 빼앗지 않고 되살립니다.
///
/// SW_RESTORE가 아닌 이유: 그쪽은 창을 활성화해서, 사용자가 다른 앱에
/// 타이핑하는 중에 포커스를 가로챕니다. 위젯은 조용히 제자리로 돌아와야 합니다.
pub fn restore_without_activating(hwnd: isize) {
    unsafe {
        ShowWindow(hwnd as HWND, SW_SHOWNOACTIVATE);
    }
}
