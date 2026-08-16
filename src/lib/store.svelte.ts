import { archiveTask, dropArchived, findArchived, pruneArchive, toTask } from './archive';
import { migrateFromLocalStorage, readJson, writeJson } from './persist';
import { maxTopicsPerPage } from './layout';
import { theme } from './theme';
import { LocalSource } from './sources/LocalSource';
import type { Category, NewTask, Task, TaskSource } from './types';

const CAT_KEY = 'reminder-widget:categories:v1';
const TASK_KEY = 'reminder-widget:tasks:v1';
const SEED_KEY = 'reminder-widget:seeded';
const ZOOM_KEY = 'reminder-widget:zoom:v1';
const PER_PAGE_KEY = 'reminder-widget:perPage:v1';

const SEED: Category[] = [
  { id: 'study', name: '학업', order: 0 },
  { id: 'life', name: '생활', order: 1 },
];

export const source: TaskSource = new LocalSource();

export const store = $state({
  tasks: [] as Task[],
  categories: SEED,
  /** 렌더링 기준 시각 */
  now: Date.now(),
});

export interface UndoEntry {
  id: string;
  title: string;
}

const UNDO_DEPTH = 10;

/**
 * 되돌리기 스택.
 *
 * 화면의 7초 팝업과 역할이 다릅니다. 팝업은 '방금 잘못 눌렀다'를 즉시
 * 알아채게 하는 장치고, 이 스택은 한참 뒤에 깨달았을 때를 위한 것입니다.
 * 체크하면 카드가 곧바로 사라지는 즉시성이 완료를 보상으로 만드는데,
 * 되돌릴 방법이 7초뿐이면 그 즉시성이 도리어 부담이 됩니다.
 *
 * 세션 안에서만 유지합니다. 앱을 껐다 켠 뒤의 Ctrl+Z가 어제 끝낸 일을
 * 되살리면 그건 되돌리기가 아니라 사고입니다. 더 오래된 것도 완료 기록에는
 * 그대로 남아 있으니, 나중에 기록 화면에서 되살리는 편이 맞습니다.
 */
export const undo = $state({ stack: [] as UndoEntry[] });

/**
 * 앱을 켤 때 한 번.
 *
 * 이전 버전이 localStorage에 남긴 데이터를 파일로 옮깁니다. 업데이트로 저장
 * 위치가 바뀌는 건 사용자 사정이 아니므로, 쓰던 할 일과 주제가 그대로 따라와야
 * 합니다. 그 다음 지난 실행이 완료 처리 도중에 죽어 양쪽에 남은 항목을
 * 정리합니다.
 *
 * 둘 다 시작할 때 한 번 할 일입니다 — refresh는 체크할 때마다 불립니다.
 */
export async function init(): Promise<void> {
  await migrateFromLocalStorage([TASK_KEY, CAT_KEY, SEED_KEY, ZOOM_KEY, PER_PAGE_KEY]);
  await refresh();
  await drainCompleted();
  await pruneArchive(new Set(store.tasks.map((t) => t.id)));

  const savedZoom = await readJson<number>(ZOOM_KEY);
  if (savedZoom && ZOOM_STEPS.includes(savedZoom)) view.zoom = savedZoom;
  else setZoom(pickZoomForScreen());

  const savedPerPage = await readJson<number>(PER_PAGE_KEY);
  if (savedPerPage) view.perPage = Math.max(1, Math.min(maxTopicsPerPage(), savedPerPage));
}

/**
 * 첫 실행 배율.
 *
 * 다른 위젯들이 하는 방식과 같습니다 — 화면 크기로 한 번 고르고, 그 뒤로는
 * 사용자가 정한 값이 이깁니다. 켤 때마다 다시 고르면 외부 모니터를 꽂거나
 * 뺄 때마다 위젯이 제멋대로 바뀌고, 사용자가 맞춰 둔 값을 덮어쓰는 건 더
 * 나쁩니다.
 *
 * 흔한 1080p는 100% 그대로 둡니다. 손봐야 하는 건 양 끝입니다 — 배율 150%
 * 노트북은 논리 해상도가 1280×720이라 같은 위젯이 화면 절반을 먹고, 4K에서는
 * 반대로 너무 작습니다.
 */
function pickZoomForScreen(): number {
  const h = typeof window === 'undefined' ? 1080 : (window.screen?.availHeight ?? 1080);
  if (h < 800) return 0.85;
  if (h < 1300) return 1;
  if (h < 1700) return 1.15;
  return 1.3;
}

/**
 * 화면 배율.
 *
 * 창 크기와 별개의 값입니다. 창은 계속 내용을 따라가야 합니다 — 할 일이 늘면
 * 기둥이 자라고 창이 거기 맞습니다. 창 크기로 배율을 정하면 두 방향이 서로를
 * 밀어 드래그가 튕기고, 무엇보다 '스크롤 없이 한 창에 다 보인다'가 깨집니다.
 * 창이 고정된 채 내용만 늘면 넘치는 수밖에 없기 때문입니다.
 *
 * 노트북에서 보통 필요한 건 확대가 아니라 축소입니다. Windows 배율 150%
 * 노트북은 논리 해상도가 1280×720이라 같은 위젯이 화면의 절반을 먹습니다.
 */
export const ZOOM_STEPS: number[] = [0.75, 0.85, 1, 1.15, 1.3, 1.5];

/**
 * 배율과 '한 번에 보일 주제 수'를 함께 둡니다.
 *
 * 둘 다 "얼마나 보일까"라는 한 가지 질문에 대한 답이고, 데이터가 아니라 이
 * 컴퓨터에서 보는 방식이라 같은 자리에 있는 게 맞습니다.
 */
export const view = $state({ zoom: 1, perPage: theme.layout.topicsPerPage });

export function setPerPage(n: number): void {
  const clamped = Math.max(1, Math.min(maxTopicsPerPage(), Math.round(n)));
  view.perPage = clamped;
  void writeJson(PER_PAGE_KEY, clamped);
}

export function setZoom(next: number): void {
  const z = ZOOM_STEPS.includes(next) ? next : 1;
  view.zoom = z;
  // 화면은 즉시 바뀌고 저장은 뒤따릅니다. 휠을 굴릴 때마다 디스크를
  // 기다리게 하면 배율이 끊겨 따라옵니다.
  void writeJson(ZOOM_KEY, z);
}

/** delta는 -1(축소) 또는 +1(확대) */
export function nudgeZoom(delta: number): void {
  const here = ZOOM_STEPS.indexOf(view.zoom);
  const from = here < 0 ? ZOOM_STEPS.indexOf(1) : here;
  setZoom(ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, from + delta))]);
}

/**
 * 이전 버전이 살아 있는 목록에 남긴 완료 항목을 기록으로 옮깁니다.
 *
 * 예전에는 완료가 completedAt 표시일 뿐이라 같은 파일에 그대로 쌓였습니다.
 * 그대로 두면 화면에는 안 보이면서 체크할 때마다 함께 다시 쓰이는 짐이 되고,
 * 주제를 지우면 닿을 수도 없어집니다. 한 번만 훑어 옮깁니다.
 */
async function drainCompleted(): Promise<void> {
  const done = store.tasks.filter((t) => t.completedAt !== null);
  if (done.length === 0) return;

  for (const task of done) {
    const categoryName = store.categories.find((c) => c.id === task.categoryId)?.name ?? '';
    await archiveTask({ ...task, completedAt: task.completedAt ?? Date.now(), categoryName });
    await source.remove?.(task.id);
  }
  await refresh();
}

/** 저장된 것을 다시 읽어옵니다 */
export async function refresh(): Promise<void> {
  const saved = await readJson<Category[]>(CAT_KEY);
  if (saved && saved.length > 0) store.categories = saved;
  store.tasks = await source.list();
}

/** 예시 항목을 한 번만 넣기 위한 표시 */
export async function wasSeeded(): Promise<boolean> {
  return (await readJson<boolean>(SEED_KEY)) === true;
}

export async function markSeeded(): Promise<void> {
  await writeJson(SEED_KEY, true);
}

export async function addTask(input: NewTask): Promise<void> {
  await source.add?.(input);
  await refresh();
}

/**
 * 완료 — 살아 있는 목록에서 빼서 기록으로 옮깁니다.
 *
 * 지우지 않습니다. 체크하면 카드가 즉시 사라지는데 그 즉시성이 완료를 보상으로
 * 만들고, 확인 절차를 넣으면 그 감각이 죽습니다. 대신 사라진 것이 어디에도
 * 없는 게 아니라 기록으로 옮겨 갔을 뿐이라서 언제든 되돌릴 수 있습니다.
 */
export async function completeTask(task: Task): Promise<void> {
  const categoryName = store.categories.find((c) => c.id === task.categoryId)?.name ?? '';

  // 기록에 먼저 쓰고 살아 있는 목록에서 뺍니다. 그 사이에 죽으면 양쪽에 남는데,
  // init이 살아 있는 쪽을 남기므로 최악이 '한 번 더 체크'입니다.
  // 순서를 뒤집으면 최악이 '사라짐'입니다.
  await archiveTask({ ...task, completedAt: Date.now(), categoryName });
  await source.remove?.(task.id);

  undo.stack.push({ id: task.id, title: task.title });
  if (undo.stack.length > UNDO_DEPTH) undo.stack.shift();

  await refresh();
}

/** 기록에서 꺼내 되살립니다. 기록에 없으면 false */
export async function restoreTask(id: string): Promise<boolean> {
  const entry = await findArchived(id);
  if (!entry) return false;

  // 살아 있는 목록에 먼저 넣고 기록에서 뺍니다.
  // 반대로 하면 그 사이에 죽었을 때 할 일이 어디에도 없습니다.
  await source.insert?.(toTask(entry));
  await dropArchived(id);

  const i = undo.stack.findIndex((e) => e.id === id);
  if (i >= 0) undo.stack.splice(i, 1);

  await refresh();
  return true;
}

/** 가장 최근 완료부터 되돌립니다. 되돌린 항목을 반환하고, 없으면 null */
export async function undoLast(): Promise<UndoEntry | null> {
  while (undo.stack.length > 0) {
    const entry = undo.stack[undo.stack.length - 1];
    // 성공하면 restoreTask가 스택에서 빼 줍니다.
    // 기록에 없는 항목은 되돌릴 것이 없으니 스택에서만 버리고 다음으로 넘어갑니다.
    if (await restoreTask(entry.id)) return entry;
    undo.stack.pop();
  }
  return null;
}

export async function removeTask(id: string): Promise<void> {
  await source.remove?.(id);
  await refresh();
}

export function saveCategories(next: Category[]): void {
  store.categories = next;
  // 화면은 즉시 바뀌고 저장은 뒤따릅니다. 이름을 한 글자 칠 때마다
  // 디스크 쓰기를 기다리게 하면 입력이 끊깁니다.
  void writeJson(CAT_KEY, next);
}

export function addCategory(name = '새 주제'): string {
  const id = 'cat-' + Math.random().toString(36).slice(2, 8);
  const order = store.categories.reduce((m, c) => Math.max(m, c.order), -1) + 1;
  saveCategories([...store.categories, { id, name, order }]);
  return id;
}

export function renameCategory(id: string, name: string): void {
  saveCategories(store.categories.map((c) => (c.id === id ? { ...c, name } : c)));
}

/** delta는 -1(왼쪽) 또는 +1(오른쪽). 이웃과 순서를 맞바꿉니다. */
export function moveCategory(id: string, delta: number): void {
  const sorted = [...store.categories].sort((a, b) => a.order - b.order);
  const i = sorted.findIndex((c) => c.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= sorted.length) return;
  [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  saveCategories(sorted.map((c, idx) => ({ ...c, order: idx })));
}

/**
 * 비어 있을 때만 지웁니다. 할 일이 남은 주제를 지우면 그 데이터를 잃는데,
 * 되돌릴 방법이 없습니다. 삭제를 막는 편이 안전하고 설명도 필요 없습니다.
 *
 * 완료 기록은 막지 않습니다 — 기록에는 완료 시점의 주제 이름이 함께 들어 있어서
 * 주제가 사라져도 그때 무슨 일이었는지 그대로 읽힙니다. 예전에는 완료 항목이
 * 살아 있는 목록에 남아 있어서, 주제를 지우면 닿을 수 없는 고아가 됐습니다.
 */
export function removeCategory(id: string): boolean {
  if (store.tasks.some((t) => t.categoryId === id)) return false;
  if (store.categories.length <= 1) return false;
  saveCategories(store.categories.filter((c) => c.id !== id));
  return true;
}

/**
 * 시계.
 *
 * setInterval만 믿으면 절전/최대 절전에서 복귀했을 때 조용히 깨집니다.
 * 기대 경과 시간보다 훨씬 많이 흘렀으면 전체를 다시 읽습니다.
 * (Tauri 껍데기를 씌우면 여기에 창 포커스·시스템 resume 이벤트를 더 붙이세요)
 */
export function startClock(intervalMs = 30_000): () => void {
  let last = Date.now();

  const tick = () => {
    const real = Date.now();
    const drifted = real - last > intervalMs * 3;
    last = real;
    store.now = real;
    if (drifted) void refresh();
  };

  const timer = setInterval(tick, intervalMs);
  const onWake = () => {
    if (!document.hidden) tick();
  };

  document.addEventListener('visibilitychange', onWake);
  window.addEventListener('focus', onWake);

  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onWake);
    window.removeEventListener('focus', onWake);
  };
}

