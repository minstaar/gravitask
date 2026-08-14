//! 창을 바탕화면에 붙입니다 — 배경화면과 아이콘 사이에.
//!
//! 여기 있는 건 전부 문서화되지 않은 셸 동작에 기대고 있습니다. 표준 API가
//! 없기 때문입니다. 그럼에도 이걸 하는 이유는 하나입니다: 평범한 최상위 창은
//! always-on-bottom이어도 Win+D("바탕화면 보기")가 숨겨버립니다. 창이 바탕화면의
//! 일부가 되어야만 숨지 않고, 그래야 비로소 바탕화면 위젯입니다.
//!
//! 동작 원리:
//! 1. Progman에 문서화되지 않은 메시지 0x052C를 보내면, Progman이 배경화면을
//!    그리는 WorkerW 창을 하나 만들어냅니다.
//! 2. 최상위 창을 훑어 SHELLDLL_DefView(아이콘을 담은 창)를 자식으로 가진
//!    창을 찾고, 그 다음 형제 WorkerW가 우리가 붙을 대상입니다.
//! 3. 거기에 SetParent 합니다.
//!
//! 주의: Explorer가 재시작되거나 배경화면이 바뀌면 WorkerW가 사라져 다시
//! 붙여야 합니다. 다중 모니터·DPI 변경도 재부착 대상입니다.

#![cfg(windows)]

use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{HWND, LPARAM, POINT, RECT};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, FindWindowW, GetAncestor, GetClassNameW, GetCursorPos,
    GetWindowRect, IsWindowVisible, SendMessageTimeoutW, SetParent, ShowWindow, WindowFromPoint,
    GA_PARENT, GA_ROOT, SMTO_NORMAL, SW_SHOWNOACTIVATE,
};

/// Progman에게 배경화면 뒤 WorkerW를 만들라고 시키는 문서화되지 않은 메시지.
const WM_SPAWN_WORKER: u32 = 0x052C;

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

struct Search {
    found: HWND,
}

/// SHELLDLL_DefView를 자식으로 가진 창을 찾고, 그 다음 형제 WorkerW를 집습니다.
unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> i32 {
    let search = unsafe { &mut *(lparam as *mut Search) };

    let defview_class = wide("SHELLDLL_DefView");
    let defview = unsafe { FindWindowExW(hwnd, null_mut(), defview_class.as_ptr(), null()) };

    if !defview.is_null() {
        let worker_class = wide("WorkerW");
        let worker = unsafe { FindWindowExW(null_mut(), hwnd, worker_class.as_ptr(), null()) };
        // 보이지 않는 WorkerW에 붙으면 우리 위젯도 같이 사라집니다. 부모가
        // 숨겨져 있으면 자식도 숨겨지기 때문입니다. 이 PC에는 WorkerW가 열댓 개
        // 있는데 대부분은 보이지 않는 껍데기라, 반드시 걸러야 합니다.
        if !worker.is_null() && unsafe { IsWindowVisible(worker) } != 0 {
            search.found = worker;
            return 0; // 찾았으니 열거를 멈춥니다
        }
    }

    1
}

/// 붙을 후보를 우선순위대로 돌려줍니다.
///
/// 하나만 고르지 않는 이유는, 어느 것이 실제로 배경화면을 그리는 창인지
/// Windows 버전과 그때그때 셸 상태에 따라 달라지기 때문입니다. 붙여보고
/// 결과를 확인한 뒤 아니면 다음 후보로 넘어갑니다.
fn desktop_hosts() -> Vec<HWND> {
    let mut hosts = Vec::new();

    unsafe {
        let progman_class = wide("Progman");
        let progman = FindWindowW(progman_class.as_ptr(), null());
        if progman.is_null() {
            return hosts;
        }

        // Progman이 WorkerW를 만들도록 유도합니다. 응답을 기다리지 않고
        // 타임아웃을 두는 이유는, 셸이 멈춰 있을 때 우리까지 같이 멎지 않게 하려는 것입니다.
        let mut result: usize = 0;
        SendMessageTimeoutW(progman, WM_SPAWN_WORKER, 0, 0, SMTO_NORMAL, 1000, &mut result);

        let mut search = Search { found: null_mut() };
        EnumWindows(Some(enum_proc), &mut search as *mut Search as LPARAM);

        if !search.found.is_null() {
            hosts.push(search.found);
        }

        // Windows 11 일부 빌드는 별도 WorkerW를 만들지 않고 SHELLDLL_DefView를
        // Progman 아래 그대로 둡니다. 그럴 땐 Progman 자체가 붙을 대상입니다.
        hosts.push(progman);
    }

    hosts
}

pub fn attach(hwnd: isize) -> bool {
    let child = hwnd as HWND;

    for host in desktop_hosts() {
        unsafe {
            SetParent(child, host);

            // 확인에 GetParent를 쓰면 안 됩니다. GetParent는 WS_CHILD 스타일이
            // 없는 창에 대해 부모가 아니라 '소유자'를 돌려주는데, SetParent는
            // 자식 목록에만 넣고 WS_CHILD를 붙이지는 않습니다. 그래서 실제로
            // 붙었는데도 GetParent는 계속 NULL입니다. GA_PARENT로 물어야 합니다.
            //
            // 부모가 맞다고 끝도 아닙니다. 숨겨진 창에 붙으면 우리도 같이
            // 사라지므로, 붙인 뒤 실제로 보이는지까지 확인해야 합니다.
            if GetAncestor(child, GA_PARENT) == host && IsWindowVisible(child) != 0 {
                return true;
            }
        }
    }

    // 어느 후보로도 실패했으면 원래대로 되돌립니다. 보이지 않는 창에
    // 매달린 채로 두는 것보다 평범한 최상위 창으로 남는 편이 낫습니다.
    unsafe {
        SetParent(child, null_mut());
        ShowWindow(child, SW_SHOWNOACTIVATE);
    }
    false
}

unsafe fn class_of(hwnd: HWND) -> String {
    let mut buf = [0u16; 128];
    let n = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
    if n <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..n as usize])
}

/// 바탕화면을 이루는 창인지 — 즉 그 위에 놓인 우리 위젯이 '노출되어 있는' 상태인지.
unsafe fn is_desktop_surface(hwnd: HWND) -> bool {
    let class = unsafe { class_of(hwnd) };
    class == "Progman" || class == "WorkerW"
}

/// 커서가 위젯 위에 있고, 그 지점을 다른 앱 창이 덮고 있지 않은지.
///
/// 부착 상태에서는 창이 마우스 메시지를 아예 못 받기 때문에(포커스 활성화
/// 체인 밖에 있으므로) 커서 위치를 직접 읽는 수밖에 없습니다. 전역 후킹 대신
/// 폴링을 쓰는 이유는, 후킹이 보안 소프트웨어에 오탐되기 쉽고 이 용도에는
/// 과하기 때문입니다.
pub fn cursor_over(hwnd: isize) -> bool {
    let target = hwnd as HWND;
    unsafe {
        let mut pt = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut pt) == 0 {
            return false;
        }

        let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        if GetWindowRect(target, &mut rect) == 0 {
            return false;
        }
        if pt.x < rect.left || pt.x >= rect.right || pt.y < rect.top || pt.y >= rect.bottom {
            return false;
        }

        // 위젯 사각형 안이라도 다른 창이 그 위를 덮고 있으면 우리 차례가 아닙니다.
        let under = WindowFromPoint(pt);
        if under.is_null() {
            return false;
        }
        let root = GetAncestor(under, GA_ROOT);
        root == target || is_desktop_surface(root)
    }
}

/// 포커스를 빼앗지 않고 창을 다시 표시합니다.
///
/// "바탕화면 보기"(Win+D)가 켜진 상태에서 창을 떼어내면 평범한 최상위 창이
/// 되는데, Windows는 그 모드에서 최상위 창을 숨깁니다. 그래서 떼어낸 직후
/// 명시적으로 다시 띄워야 위젯이 사라지지 않습니다. SW_SHOW가 아니라
/// SW_SHOWNOACTIVATE인 이유는, 마우스가 스쳤을 뿐인데 다른 앱에서 포커스를
/// 빼앗아 오면 안 되기 때문입니다.
pub fn show_without_activating(hwnd: isize) {
    unsafe {
        ShowWindow(hwnd as HWND, SW_SHOWNOACTIVATE);
    }
}

pub fn detach(hwnd: isize) -> bool {
    let child = hwnd as HWND;
    unsafe {
        SetParent(child, null_mut());
        // 떼어내면 부모가 바탕화면 창이 됩니다. 붙을 후보 중 어느 것도
        // 아니면 성공입니다.
        let parent = GetAncestor(child, GA_PARENT);
        !desktop_hosts().contains(&parent)
    }
}
