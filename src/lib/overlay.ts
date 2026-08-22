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

/** `회차키` → 완료 시각 */
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

/**
 * 완료 표시의 열쇠 — 회차 키 하나입니다.
 *
 * 예전에는 앞에 소스 id를 붙였습니다. 서로 다른 캘린더가 같은 UID를 쓸 수
 * 있다고 봤기 때문입니다. 그런데 소스 id는 구독을 등록하는 순간 새로 만드는
 * 값이라, 같은 캘린더를 지웠다 다시 붙이면 값이 바뀝니다. 주소를 새로
 * 발급받아 다시 걸어도 마찬가지입니다. 그때마다 눌러 둔 완료가 전부 주인을
 * 잃고 일정이 되살아납니다 — 사용자가 한 일은 캘린더를 다시 건 것뿐인데.
 *
 * UID는 캘린더 쪽이 발급하는 전역 식별자입니다. 구독을 다시 걸어도, 주소가
 * 바뀌어도 그대로입니다. 여기에 회차 시작 시각을 붙인 것이 회차 키입니다.
 *
 * 두 캘린더에 같은 일정이 들어 있으면(초대를 양쪽에서 받은 경우) 한쪽에서
 * 체크했을 때 양쪽이 함께 처리됩니다. 같은 일정이니 그게 맞습니다.
 */
export function overlayKey(occurrence: string): string {
  return occurrence;
}

/**
 * 예전 판은 `소스id|회차키`로 적었습니다. 읽을 때 접두사를 떼어 회차 키로
 * 통일합니다 — 그래야 이미 눌러 둔 완료가 살아남습니다.
 */
function bare(key: string): string {
  return key.slice(key.indexOf('|') + 1);
}

/**
 * 오래된 표시는 버립니다.
 *
 * 지난 학기 수업까지 들고 있을 이유가 없습니다. 다만 넉넉히 둡니다 — 너무
 * 일찍 버리면 아직 피드에 남아 있는 일정이 완료 표시를 잃고 되살아납니다.
 */
/*
 * 피드 창(뒤로 7일 ~ 앞으로 120일)보다 넉넉해야 합니다. 앞으로 120일짜리
 * 일정을 오늘 완료하면 그 일정은 127일 뒤에야 피드에서 빠지는데, 표시를
 * 120일만 들고 있으면 마지막 7일 동안 표시를 잃고 되살아납니다.
 */
const KEEP_MS = 150 * 24 * MS_HOUR;

export async function loadOverlay(now = Date.now()): Promise<Overlay> {
  const saved = (await readJson<Overlay>(KEY)) ?? {};
  const kept: Overlay = {};
  for (const [mark, at] of Object.entries(saved)) {
    if (typeof at === 'number' && now - at < KEEP_MS) kept[bare(mark)] = at;
  }
  return kept;
}

export async function markDone(occurrence: string, at: number): Promise<void> {
  const overlay = await loadOverlay(at);
  overlay[overlayKey(occurrence)] = at;
  await writeJson(KEY, overlay);
}

export async function clearDone(occurrence: string): Promise<void> {
  const overlay = await loadOverlay();
  const key = overlayKey(occurrence);
  if (!(key in overlay)) return;
  delete overlay[key];
  await writeJson(KEY, overlay);
}
