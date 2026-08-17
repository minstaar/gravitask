import { readJson, writeJson } from './persist';
import type { Task } from './types';
import { MS_HOUR } from './urgency';

/**
 * 남의 소스에서 온 항목의 완료 표시.
 *
 * 우리가 소유한 할 일은 완료하면 기록 파일로 '옮겨' 갑니다. 그게 통하는 이유는
 * 그 파일이 우리 것이기 때문입니다 — 우리가 지우면 아무도 되돌려 놓지 않습니다.
 *
 * 구독한 캘린더는 다릅니다. 목록은 매번 원격 피드를 다시 받아 만들어지고, 그
 * 서버는 우리가 무엇을 완료했는지 모릅니다. 알 방법도 없습니다 — 비공개 주소는
 * 읽기 전용이라 우리에게 쓰기 권한이 없습니다. 그래서 옮기려 해도 다음 폴링에
 * 그대로 되살아납니다.
 *
 * 대신 "이 회차는 처리했다"는 표시만 여기 남기고, 목록을 만들 때 걸러냅니다.
 * 완료 경로가 소스에 따라 갈리는 셈입니다 — 우리 것은 옮기고, 남의 것은 적습니다.
 */

const KEY = 'reminder-widget:done-overlay:v1';

/** `소스id|회차키` → 완료 시각 */
type Overlay = Record<string, number>;

/**
 * 회차까지 구분하는 키.
 *
 * occurrenceKey가 없으면 id로 대신합니다. 반복 없는 일정과 우리 할 일은
 * id 하나로 충분합니다.
 */
export function occurrenceOf(task: Task): string {
  return task.occurrenceKey ?? task.id;
}

export function overlayKey(sourceId: string, occurrence: string): string {
  return `${sourceId}|${occurrence}`;
}

/**
 * 오래된 표시는 버립니다.
 *
 * 지난 학기 수업까지 들고 있을 이유가 없습니다. 다만 넉넉히 둡니다 — 너무
 * 일찍 버리면 아직 피드에 남아 있는 일정이 완료 표시를 잃고 되살아납니다.
 */
const KEEP_MS = 120 * 24 * MS_HOUR;

export async function loadOverlay(now = Date.now()): Promise<Overlay> {
  const saved = (await readJson<Overlay>(KEY)) ?? {};
  const kept: Overlay = {};
  for (const [mark, at] of Object.entries(saved)) {
    if (typeof at === 'number' && now - at < KEEP_MS) kept[mark] = at;
  }
  return kept;
}

export async function markDone(sourceId: string, occurrence: string, at: number): Promise<void> {
  const overlay = await loadOverlay(at);
  overlay[overlayKey(sourceId, occurrence)] = at;
  await writeJson(KEY, overlay);
}

export async function clearDone(sourceId: string, occurrence: string): Promise<void> {
  const overlay = await loadOverlay();
  const key = overlayKey(sourceId, occurrence);
  if (!(key in overlay)) return;
  delete overlay[key];
  await writeJson(KEY, overlay);
}
