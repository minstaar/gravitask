import { readJson, writeJson } from './persist';

/**
 * 위젯과 설정 창이 함께 보는 값들.
 *
 * 두 창은 각자 다른 자바스크립트 세계라 메모리를 나눠 쓰지 않습니다. 파일이
 * 진실이고, 한쪽이 고치면 이벤트로 알려 다른 쪽이 다시 읽습니다. 폴링으로
 * 맞추면 바꾼 것이 언제 반영될지 알 수 없고, 창을 닫아야 반영되게 하면
 * 설정을 만지는 동안 결과를 볼 수 없습니다.
 */

const KEY = 'reminder-widget:settings:v1';

/** 설정이 바뀌었다고 알리는 신호. 창을 가로질러 갑니다 */
export const SETTINGS_CHANGED = 'gravitask://settings-changed';

export interface Settings {
  /** 알림 전체 스위치. 꺼져 있으면 아래 값들은 의미가 없습니다 */
  notify: boolean;
  /** 마감 24시간 전 */
  notifyDayBefore: boolean;
  /** 마감 1시간 전 */
  notifyHourBefore: boolean;
  /**
   * 야간에는 알림을 미뤘다가 아침에 묶어서 보냅니다.
   *
   * 다만 그냥 미루기만 하면 새벽 3시 마감을 조용히 놓칩니다. 그래서 야간이
   * 시작될 때 "오늘 밤 사이 마감 N건"을 한 번 알립니다 — 자기 전에 알 기회는
   * 주고, 새벽에 깨우지는 않습니다.
   */
  quietNight: boolean;
}

export const DEFAULTS: Settings = {
  notify: true,
  notifyDayBefore: true,
  notifyHourBefore: true,
  quietNight: true,
};

export async function loadSettings(): Promise<Settings> {
  const saved = await readJson<Partial<Settings>>(KEY);
  return { ...DEFAULTS, ...(saved ?? {}) };
}

export async function saveSettings(next: Settings): Promise<void> {
  await writeJson(KEY, next);
  await announce();
}

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function announce(): Promise<void> {
  if (!inTauri) return;
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit(SETTINGS_CHANGED);
  } catch {
    // 알리지 못해도 저장은 끝났습니다. 다음에 읽을 때 반영됩니다.
  }
}

/**
 * 설정 창을 엽니다.
 *
 * 트레이 메뉴에도 같은 항목이 있지만, 그쪽만 두면 안 됩니다 — Windows는 트레이
 * 아이콘을 기본으로 숨김 영역에 넣어 버려서, 알림 하나 끄려고 "숨겨진 아이콘
 * 표시"를 눌러 찾아야 합니다. 발견성은 시선이 이미 가 있는 곳에 있어야 하고,
 * 그건 위젯입니다. 트레이는 위젯을 숨겼을 때를 위한 예비 경로입니다.
 */
export async function openSettingsWindow(): Promise<void> {
  if (!inTauri) return;
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');

  const existing = await WebviewWindow.getByLabel('settings');
  if (existing) {
    await existing.show();
    await existing.unminimize();
    await existing.setFocus();
    return;
  }

  // 위젯과 달리 평범한 창입니다. 테두리도 크기 조절도 있고 작업 표시줄에도
  // 나옵니다 — 폼을 담기에는 그쪽이 맞습니다.
  const w = new WebviewWindow('settings', {
    url: 'settings.html',
    title: 'Gravitask 설정',
    width: 440,
    height: 560,
    minWidth: 360,
    minHeight: 420,
    resizable: true,
    decorations: true,
    transparent: false,
    skipTaskbar: false,
    center: true,
  });

  await new Promise<void>((resolve) => {
    void w.once('tauri://created', () => resolve());
    void w.once('tauri://error', () => resolve());
    setTimeout(resolve, 2000);
  });
}
