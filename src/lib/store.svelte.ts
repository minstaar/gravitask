import { migrateFromLocalStorage, readJson, writeJson } from './persist';
import { LocalSource } from './sources/LocalSource';
import type { Category, NewTask, Task, TaskSource } from './types';

const CAT_KEY = 'reminder-widget:categories:v1';
const TASK_KEY = 'reminder-widget:tasks:v1';
const SEED_KEY = 'reminder-widget:seeded';

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

/**
 * 저장된 것을 읽어옵니다.
 *
 * 먼저 이전 버전이 localStorage에 남긴 데이터를 파일로 옮깁니다. 업데이트로
 * 저장 위치가 바뀌는 건 사용자 사정이 아니므로, 쓰던 할 일과 주제가 그대로
 * 따라와야 합니다.
 */
export async function refresh(): Promise<void> {
  await migrateFromLocalStorage([TASK_KEY, CAT_KEY, SEED_KEY]);
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

export async function toggleTask(task: Task): Promise<void> {
  await source.update?.(task.id, { completedAt: task.completedAt ? null : Date.now() });
  await refresh();
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
 */
export function removeCategory(id: string): boolean {
  if (store.tasks.some((t) => t.categoryId === id && t.completedAt === null)) return false;
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

