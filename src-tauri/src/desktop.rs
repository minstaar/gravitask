//! 위젯을 '바탕화면 바로 위'에 세워 둡니다.
//!
//! 목표는 두 플랫폼이 같습니다 — **모든 앱 창보다 아래, 단 바탕화면보다는
//! 위.** 그리고 바탕화면을 보여 달라는 요청에도 위젯은 남아 있어야 합니다.
//! 위젯을 보려고 바탕화면을 부르는 것이니까요.
//!
//! 목표가 같아도 방법은 정반대입니다. Windows에는 그런 자리가 아예 없어서
//! 계속 되돌려 놓아야 하고(폴링), macOS에는 그 자리가 이미 있어서 한 번
//! 세워 두면 끝입니다. 그래서 공통 함수를 만들지 않았습니다 — 억지로 묶으면
//! 양쪽 어디에서도 읽히지 않는 함수가 남습니다. 부르는 쪽이 갈립니다.
//!
//! 자세한 사정은 각 파일의 머리말에 있습니다.

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::{is_parked, park_above_desktop};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::{exempt_from_expose, park};
