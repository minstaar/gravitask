import { readJson, writeJson } from './persist';

/**
 * 알림과 시스템 설정.
 *
 * 한때 이 값들을 별도 창으로 빼려 했습니다. 위젯 창이 테두리도 크기 조절도
 * 없고 내용에 맞춰 크기가 정해져서, 폼을 담으면 열 때마다 위젯이 두 배가
 * 된다는 이유였습니다.
 *
 * 그 계획을 접은 이유는, 나눈 규칙을 사용자가 알 수 없기 때문입니다. 제
 * 머릿속 규칙은 "위젯에 보이는 결과가 있느냐"였습니다 — 주제 이름·배율은
 * 바꾸면 눈앞이 변하지만 알림·자동 시작은 아무것도 안 변하니까요. 그럴듯하지만
 * 화면 어디에도 안 적혀 있는 규칙이라, 사용자에게는 "왜 이것만 한 번 더
 * 눌러야 하지"로만 보입니다.
 *
 * 대신 설정을 위젯 아래에 펼치고 그 영역만 끌어 보게 했습니다. 위젯은 위에
 * 그대로 남아서, 무엇을 바꾸든 결과가 바로 위에 보입니다.
 */

const KEY = 'reminder-widget:settings:v1';

export interface Settings {
  /** 알림 전체 스위치. 꺼져 있으면 아래 값들은 의미가 없습니다 */
  notify: boolean;
  /** 마감 24시간 전 */
  notifyDayBefore: boolean;
  /** 마감 1시간 전 */
  notifyHourBefore: boolean;
  /**
   * 야간에도 알림을 받습니다.
   *
   * 끄면 야간 알림을 아침으로 미룹니다. 다만 그냥 미루기만 하면 새벽 3시
   * 마감을 조용히 놓치므로, 야간이 시작될 때 "오늘 밤 사이 마감 N건"을 한 번
   * 알립니다 — 자기 전에 알 기회는 주고, 새벽에 깨우지는 않습니다.
   */
  nightAlerts: boolean;
}

export const DEFAULTS: Settings = {
  notify: true,
  notifyDayBefore: true,
  notifyHourBefore: true,
  nightAlerts: true,
};

export async function loadSettings(): Promise<Settings> {
  const saved = await readJson<Partial<Settings>>(KEY);
  return { ...DEFAULTS, ...(saved ?? {}) };
}

export async function saveSettings(next: Settings): Promise<void> {
  await writeJson(KEY, next);
}
