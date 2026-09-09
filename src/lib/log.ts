/**
 * 프런트에서 난 일을 앱 로그 파일에 남깁니다.
 *
 * 여기가 없던 동안, 저장이 실패해도 로그에는 한 줄도 안 남았습니다.
 * `console.warn`은 WebView 콘솔로만 가는데 배포판에는 그 콘솔을 열 방법이
 * 없습니다. 그래서 "사용자 PC에서 무슨 일이 있었는지"를 물어볼 데가
 * 없었습니다 — 화면에 뜬 것을 사용자가 기억해 주기를 바라는 수밖에요.
 *
 * Rust 쪽은 이미 파일로 남기고 있었으니, 프런트도 같은 파일에 씁니다.
 * 한 사건을 두 군데서 찾아야 하는 로그는 없느니만 못합니다.
 */

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * 로그가 실패해도 부르는 쪽은 몰라야 합니다.
 *
 * 이 함수를 부르는 자리는 이미 뭔가 잘못된 자리입니다. 거기서 로그가 또
 * 던지면 원래 오류를 덮어씁니다 — 진단하려고 넣은 것이 진단을 지웁니다.
 */
function send(level: 'info' | 'warn' | 'error', message: string): void {
  if (!inTauri) {
    if (level === 'error') console.error(message);
    else if (level === 'warn') console.warn(message);
    else console.info(message);
    return;
  }
  void import('@tauri-apps/plugin-log')
    .then((m) => (level === 'error' ? m.error(message) : level === 'warn' ? m.warn(message) : m.info(message)))
    .catch(() => {
      /* 로그를 못 남기는 것까지 보고할 데는 없습니다 */
    });
}

/** 오류를 사람이 읽을 한 줄로 */
export function reasonOf(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * 사고가 아니라 기록입니다.
 *
 * 이번에 하루를 쓴 이유가 "그 세션이 무엇을 읽었는가"를 아무 데서도 알 수
 * 없어서였습니다. 시작할 때 한 줄만 있었으면 로그만 보고 끝났을 일입니다.
 */
export function logInfo(message: string): void {
  send('info', message);
}

export function logWarn(message: string): void {
  send('warn', message);
}

export function logError(what: string, err: unknown): void {
  send('error', `${what}: ${reasonOf(err)}`);
}
