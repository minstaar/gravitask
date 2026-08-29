/**
 * 표시에만 쓰는 플랫폼 구분.
 *
 * 동작을 가르는 데는 쓰지 않습니다. 키 핸들러는 이미 `ctrlKey || metaKey`를
 * 함께 듣고 있어서 어느 쪽에서든 그대로 동작합니다. 문제는 화면에 적힌
 * 글자입니다 — macOS 사용자에게 "Ctrl+Z"라고 적어 두면, 실제로 듣는 키는
 * ⌘Z인데 안내는 틀린 키를 가리키게 됩니다.
 */

/**
 * User agent로 봅니다. Tauri의 os 플러그인을 쓰면 정확하지만, 그러려면
 * 비동기 호출이 되고 그 한 박자 동안 라벨이 비거나 틀린 채로 그려집니다.
 * 글자 하나 고르는 일에 치를 값이 아닙니다.
 */
export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent);

/**
 * 표준 단축키의 수식 키. 뒤에 키 이름을 붙여 씁니다 — `⌘Z` / `Ctrl+Z`.
 *
 * macOS는 기호 뒤에 `+`를 붙이지 않습니다. 붙이면 그 자체로 이 앱이 macOS를
 * 흉내만 낸 것처럼 보입니다.
 */
export const MOD_LABEL = isMac ? '⌘' : 'Ctrl+';
