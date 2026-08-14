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
