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

use windows_sys::Win32::Foundation::{HWND, LPARAM};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, FindWindowW, GetAncestor, SendMessageTimeoutW, SetParent, GA_PARENT,
    SMTO_NORMAL,
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
        if !worker.is_null() {
            search.found = worker;
            return 0; // 찾았으니 열거를 멈춥니다
        }
    }

    1
}

fn find_desktop_host() -> Option<HWND> {
    unsafe {
        let progman_class = wide("Progman");
        let progman = FindWindowW(progman_class.as_ptr(), null());
        if progman.is_null() {
            return None;
        }

        // Progman이 WorkerW를 만들도록 유도합니다. 응답을 기다리지 않고
        // 타임아웃을 두는 이유는, 셸이 멈춰 있을 때 우리까지 같이 멎지 않게 하려는 것입니다.
        let mut result: usize = 0;
        SendMessageTimeoutW(progman, WM_SPAWN_WORKER, 0, 0, SMTO_NORMAL, 1000, &mut result);

        let mut search = Search { found: null_mut() };
        EnumWindows(Some(enum_proc), &mut search as *mut Search as LPARAM);

        if !search.found.is_null() {
            Some(search.found)
        } else {
            // Windows 11 일부 빌드는 별도 WorkerW를 만들지 않고 SHELLDLL_DefView를
            // Progman 아래 그대로 둡니다. 그럴 땐 Progman 자체가 붙을 대상입니다.
            Some(progman)
        }
    }
}

pub fn attach(hwnd: isize) -> bool {
    let Some(host) = find_desktop_host() else {
        return false;
    };
    let child = hwnd as HWND;

    unsafe {
        SetParent(child, host);
        // SetParent는 '이전 부모'를 돌려줍니다. 최상위 창이었다면 이전 부모가
        // NULL이라 반환값만으로는 성공과 실패를 구분할 수 없습니다.
        //
        // 확인에 GetParent를 쓰면 안 됩니다. GetParent는 WS_CHILD 스타일이 없는
        // 창에 대해서는 부모가 아니라 '소유자'를 돌려주는데, SetParent는 창을
        // 부모의 자식 목록에 넣을 뿐 WS_CHILD를 붙이지는 않습니다. 그래서 실제로
        // 붙었는데도 GetParent는 계속 NULL을 반환합니다.
        // 진짜 부모는 GA_PARENT로 물어봐야 합니다.
        GetAncestor(child, GA_PARENT) == host
    }
}

pub fn detach(hwnd: isize) -> bool {
    let child = hwnd as HWND;
    unsafe {
        SetParent(child, null_mut());
        // 떼어내면 부모가 바탕화면 창이 됩니다. 원래 붙어 있던 호스트만
        // 아니면 성공입니다.
        let parent = GetAncestor(child, GA_PARENT);
        find_desktop_host().map_or(true, |host| parent != host)
    }
}
