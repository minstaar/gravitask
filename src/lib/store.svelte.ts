import { LocalSource } from './sources/LocalSource';
import type { Category, NewTask, Task, TaskSource } from './types';

const CAT_KEY = 'reminder-widget:categories:v1';

const SEED: Category[] = [
  { id: 'study', name: '학업', hue: 258, order: 0 },
  { id: 'life', name: '생활', hue: 168, order: 1 },
];

function loadCategories(): Category[] {
  try {
    const raw = localStorage.getItem(CAT_KEY);
    if (raw) return JSON.parse(raw) as Category[];
  } catch {
    /* 깨진 데이터면 기본값으로 */
  }
  return SEED;
}

export const source: TaskSource = new LocalSource();

export const store = $state({
  tasks: [] as Task[],
  categories: loadCategories(),
  /** 렌더링 기준 시각. 실제 시계 + devOffset */
  now: Date.now(),
  /** 개발용 시간 이동(ms). 배포 빌드에서는 항상 0 */
  devOffset: 0,
});

export async function refresh(): Promise<void> {
  store.tasks = await source.list();
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
  localStorage.setItem(CAT_KEY, JSON.stringify(next));
}

/**
 * 범주 색 프리셋.
 *
 * 자유로운 색상환을 열어주지 않는 이유: 범주 hue가 긴급도 색(적·주황·황색)과
 * 겹치면 "급한 건지 범주 색인지" 구분이 안 됩니다. 그 대역을 비워둔 프리셋만
 * 제공하면 충돌이 구조적으로 막힙니다.
 */
export const CATEGORY_HUES = [140, 168, 190, 210, 235, 258, 285, 310];

function nextHue(used: Category[]): number {
  const taken = new Set(used.map((c) => c.hue));
  return CATEGORY_HUES.find((h) => !taken.has(h)) ?? CATEGORY_HUES[used.length % CATEGORY_HUES.length];
}

export function addCategory(name = '새 범주'): string {
  const id = 'cat-' + Math.random().toString(36).slice(2, 8);
  const order = store.categories.reduce((m, c) => Math.max(m, c.order), -1) + 1;
  saveCategories([...store.categories, { id, name, hue: nextHue(store.categories), order }]);
  return id;
}

export function renameCategory(id: string, name: string): void {
  saveCategories(store.categories.map((c) => (c.id === id ? { ...c, name } : c)));
}

export function recolorCategory(id: string, hue: number): void {
  saveCategories(store.categories.map((c) => (c.id === id ? { ...c, hue } : c)));
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
 * 비어 있을 때만 지웁니다. 할 일이 남은 범주를 지우면 그 데이터를 잃는데,
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
    store.now = real + store.devOffset;
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

export function setDevOffset(ms: number): void {
  store.devOffset = ms;
  store.now = Date.now() + ms;
}
