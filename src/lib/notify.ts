import { readJson, writeJson } from './persist';
import type { Settings } from './settings';
import { theme } from './theme';
import type { Task } from './types';
import { hoursUntil, isNight, MS_HOUR } from './urgency';

/**
 * 마감 알림.
 *
 * 규칙 하나가 이 파일 전체를 지배합니다 — **같은 알림을 두 번 울리지 않는다.**
 * 앱은 며칠씩 켜져 있다가 껐다 켜지기도 하는데, 보낸 기록을 남기지 않으면
 * 켤 때마다 지난 알림이 전부 다시 울립니다. 그 순간 사용자는 알림을 끕니다.
 * 그래서 보낸 것은 파일에 적고, 적힌 것은 다시 보내지 않습니다.
 */

const KEY = 'reminder-widget:notified:v1';

/** 알림을 보내는 시점들 */
type Kind = 'day' | 'hour' | 'over';

const BANDS: { kind: Kind; upper: number; lower: number; label: string }[] = [
  { kind: 'day', upper: 24, lower: 1, label: '하루 안에 마감' },
  { kind: 'hour', upper: 1, lower: 0, label: '1시간 안에 마감' },
  { kind: 'over', upper: 0, lower: Number.NEGATIVE_INFINITY, label: '기한이 지남' },
];

/**
 * 구간으로 판정하고 시점으로 판정하지 않습니다.
 *
 * "정확히 24시간 전"을 노리면 그 순간에 앱이 꺼져 있었을 때 영영 못 보냅니다.
 * "24시간 안쪽인데 아직 안 보냈으면 보낸다"로 두면 늦게라도 도착합니다.
 * 그래서 문구도 '24시간 전'이 아니라 '하루 안에 마감'입니다 — 언제 보내든
 * 참인 말이어야 합니다.
 */
function bandOf(hours: number): Kind | null {
  const band = BANDS.find((b) => hours <= b.upper && hours > b.lower);
  return band?.kind ?? null;
}

const labelOf = (kind: Kind) => BANDS.find((b) => b.kind === kind)!.label;

/** 보낸 기록. `할일id|시점` → 보낸 시각 */
type Sent = Record<string, number>;

const markOf = (taskId: string, kind: Kind) => `${taskId}|${kind}`;

/** 야간 예고는 그날 밤에 한 번만 */
const nightMark = (now: number) => `night|${new Date(now).toDateString()}`;

const KEEP_MS = 30 * 24 * MS_HOUR;

async function loadSent(now: number): Promise<Sent> {
  const saved = (await readJson<Sent>(KEY)) ?? {};
  // 오래된 기록은 버립니다. 그 할 일은 이미 사라졌고, 남겨 두면 파일만 붑니다.
  const kept: Sent = {};
  for (const [mark, at] of Object.entries(saved)) {
    if (typeof at === 'number' && now - at < KEEP_MS) kept[mark] = at;
  }
  return kept;
}

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function send(title: string, body: string): Promise<boolean> {
  if (!inTauri) {
    // 브라우저 개발 중에는 실제로 띄우지 않습니다. 콘솔로 확인합니다.
    console.info('[알림]', title, '—', body);
    return true;
  }
  try {
    const api = await import('@tauri-apps/plugin-notification');
    let granted = await api.isPermissionGranted();
    if (!granted) granted = (await api.requestPermission()) === 'granted';
    if (!granted) return false;
    api.sendNotification({ title, body });
    return true;
  } catch (err) {
    console.warn('알림을 보내지 못했습니다', err);
    return false;
  }
}

/** "확률론 과제 외 2건" — 무엇인지 하나는 보여야 열어볼 마음이 생깁니다 */
function summarize(titles: string[]): string {
  if (titles.length === 1) return titles[0];
  return `${titles[0]} 외 ${titles.length - 1}건`;
}

/** 한 번에 하나만 돌게 합니다. 틱이 겹치면 같은 알림이 두 번 나갑니다 */
let running = false;

export async function runNotifications(
  tasks: Task[],
  settings: Settings,
  now: number
): Promise<void> {
  if (running || !settings.notify) return;
  running = true;

  try {
    const sent = await loadSent(now);
    let changed = false;

    const enabled: Record<Kind, boolean> = {
      day: settings.notifyDayBefore,
      hour: settings.notifyHourBefore,
      over: true, // 기한이 지난 것은 알림의 존재 이유라 따로 끄지 않습니다
    };

    /**
     * 야간에 조용히 할지 정합니다.
     *
     * 조용히 한다고 기록을 남기지는 않습니다. 그래야 아침에 깨어날 때 밀린
     * 것들이 한꺼번에 묶여 나갑니다 — 지금 보낸 척하고 넘기면 영영 못 봅니다.
     */
    const quiet = !settings.nightAlerts && isNight(new Date(now));

    // 이번에 보내야 할 것들을 시점별로 모읍니다.
    const pending: Record<Kind, string[]> = { day: [], hour: [], over: [] };

    for (const task of tasks) {
      if (task.completedAt !== null) continue;
      const kind = bandOf(hoursUntil(task.due, now));
      if (!kind || !enabled[kind]) continue;
      if (sent[markOf(task.id, kind)]) continue;
      pending[kind].push(task.title);
      if (!quiet) {
        sent[markOf(task.id, kind)] = now;
        changed = true;
      }
    }

    if (quiet) {
      // 잠들기 전에 한 번은 알려 줍니다. 새벽 3시 마감을 조용히 놓치면
      // 미루기가 아니라 누락입니다.
      const mark = nightMark(now);
      const overnight = tasks.filter(
        (t) => t.completedAt === null && hoursUntil(t.due, now) > 0 && hoursUntil(t.due, now) <= 12
      );
      if (!sent[mark] && overnight.length > 0) {
        if (await send('오늘 밤 사이 마감', `${summarize(overnight.map((t) => t.title))} — 아침에 다시 알려 드립니다`)) {
          sent[mark] = now;
          changed = true;
        }
      }
      if (changed) await writeJson(KEY, sent);
      return;
    }

    /**
     * 하나면 그 항목을, 여럿이면 묶어서 보냅니다.
     *
     * 껐다 켰을 때 밀린 알림이 스무 개 쏟아지면 그건 알림이 아니라 소음입니다.
     * 묶는 조건을 '껐다 켰는지'가 아니라 '한 번에 몇 개인지'로 두면, 콜드
     * 스타트든 마감이 몰린 시각이든 같은 규칙으로 처리됩니다.
     */
    for (const { kind } of BANDS) {
      const titles = pending[kind];
      if (titles.length === 0) continue;
      const body =
        titles.length === 1
          ? titles[0]
          : `${summarize(titles)}이(가) 있습니다`;
      await send(labelOf(kind), body);
    }

    if (changed) await writeJson(KEY, sent);
  } finally {
    running = false;
  }
}

/** 완료를 되돌리면 다시 알림을 받을 수 있어야 합니다 */
export async function forgetTask(taskId: string): Promise<void> {
  const sent = (await readJson<Sent>(KEY)) ?? {};
  let changed = false;
  for (const kind of ['day', 'hour', 'over'] as Kind[]) {
    if (sent[markOf(taskId, kind)]) {
      delete sent[markOf(taskId, kind)];
      changed = true;
    }
  }
  if (changed) await writeJson(KEY, sent);
}

/** 야간 판정에 쓰는 시간대 (설정 화면 안내용) */
export const nightWindow = () => ({
  from: theme.night.startHour,
  to: theme.night.endHour,
});
