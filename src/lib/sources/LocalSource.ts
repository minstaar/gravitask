import { readJson, writeJson } from '../persist';
import type { NewTask, Task, TaskSource } from '../types';

/**
 * v1의 유일한 소스 — 로컬 저장.
 *
 * 실제 저장 위치는 persist.ts가 정합니다. 설치된 앱에서는 앱 데이터 폴더의
 * JSON 파일, 브라우저 개발 중에는 localStorage입니다. 이 클래스는 어느 쪽인지
 * 알 필요가 없습니다.
 *
 * 여기에는 살아 있는 할 일만 있습니다. 완료한 것은 store가 archive.ts로
 * 옮기므로, 이 목록의 completedAt은 언제나 null입니다.
 */

const KEY = 'reminder-widget:tasks:v1';

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export class LocalSource implements TaskSource {
  readonly id = 'local';
  readonly kind = 'local' as const;
  readonly label = '내 할 일';
  readonly writable = true;
  readonly completable = true;

  #listeners = new Set<() => void>();
  #cache: Task[] | null = null;

  async #read(): Promise<Task[]> {
    this.#cache ??= (await readJson<Task[]>(KEY)) ?? [];
    return this.#cache;
  }

  async #write(tasks: Task[]): Promise<void> {
    this.#cache = tasks;
    await writeJson(KEY, tasks);
    this.#listeners.forEach((fn) => fn());
  }

  async list(): Promise<Task[]> {
    return [...(await this.#read())];
  }

  subscribe(onChange: () => void): () => void {
    this.#listeners.add(onChange);
    return () => this.#listeners.delete(onChange);
  }

  async add(input: NewTask): Promise<Task> {
    const task: Task = { ...input, id: uid(), createdAt: Date.now(), completedAt: null };
    await this.#write([...(await this.#read()), task]);
    return task;
  }

  async update(id: string, patch: Partial<Omit<Task, 'id'>>): Promise<void> {
    const tasks = await this.#read();
    await this.#write(tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  async remove(id: string): Promise<void> {
    const tasks = await this.#read();
    if (!tasks.some((t) => t.id === id)) return;
    await this.#write(tasks.filter((t) => t.id !== id));
  }

  /** 되돌리기용. 원래 id를 그대로 지킨 채 도로 넣습니다 */
  async insert(task: Task): Promise<void> {
    const tasks = await this.#read();
    if (tasks.some((t) => t.id === task.id)) return;
    await this.#write([...tasks, task]);
  }
}
