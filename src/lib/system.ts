/**
 * 앱 자체에 관한 것들 — 자동 시작과 업데이트.
 *
 * 실제 일은 전부 Rust가 합니다. 확인·설치가 프런트와 트레이 두 벌이 되면,
 * 어느 쪽이 무엇을 봤는지 어긋나는 순간 원인을 찾을 수 없게 됩니다. 그래서
 * 여기서는 커맨드를 부르기만 합니다.
 */

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const UPDATE_PROGRESS = 'gravitask://update-progress';
export const UPDATE_AVAILABLE = 'gravitask://update-available';

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!inTauri) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(command, args);
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export async function isAutostartOn(): Promise<boolean> {
  return (await call<boolean>('autostart_enabled')) ?? false;
}

export async function setAutostart(enabled: boolean): Promise<void> {
  await call('set_autostart', { enabled });
}

/** 새 버전이 있으면 버전 문자열, 없으면 null */
export async function checkUpdate(): Promise<string | null> {
  return (await call<string | null>('check_update')) ?? null;
}

/** 성공하면 앱이 다시 시작하므로 이 함수는 돌아오지 않습니다 */
export async function installUpdate(): Promise<void> {
  await call('install_update');
}

/** 내려받는 동안 진행률(0~100)을 흘려보냅니다. 해제 함수를 반환 */
export async function onUpdateProgress(
  handler: (pct: number | null) => void
): Promise<() => void> {
  if (!inTauri) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<number | null>(UPDATE_PROGRESS, (e) => handler(e.payload));
}

/**
 * 배경 확인이 새 버전을 찾으면 알려 줍니다.
 *
 * 예전에는 트레이 메뉴 글자를 바꾸는 것이 유일한 통로였습니다. 그런데 트레이
 * 메뉴는 열어 봐야 보이고, 열어 볼 이유를 모르는 사람에게는 없는 것과
 * 같습니다. 위젯이 직접 한 줄로 말하는 편이 낫습니다.
 */
export async function onUpdateAvailable(
  handler: (version: string) => void
): Promise<() => void> {
  if (!inTauri) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<string>(UPDATE_AVAILABLE, (e) => handler(e.payload));
}
