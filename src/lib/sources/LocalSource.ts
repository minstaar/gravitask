import type { NewTask, Task, TaskSource } from '../types';

/**
 * v1의 유일한 소스 — 브라우저 localStorage.
 *
 * Tauri 껍데기를 씌울 때 이 클래스만 파일 기반(SQLite 또는 JSON)으로 갈아끼우면
 * 됩니다. TaskSource 인터페이스 뒤에 있으므로 UI는 건드릴 일이 없습니다.
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

  #listeners = new Set<() => void>();
  #cache: Task[] | null = null;

  #read(): Task[] {
    if (this.#cache) return this.#cache;
    try {
      const raw = localStorage.getItem(KEY);
      this.#cache = raw ? (JSON.parse(raw) as Task[]) : [];
    } catch {
      // 저장된 데이터가 깨졌다면 빈 목록으로 시작합니다.
      // 사용자 데이터를 조용히 덮어쓰지 않도록 여기서 지우지는 않습니다.
      this.#cache = [];
    }
    return this.#cache;
  }

  #write(tasks: Task[]): void {
    this.#cache = tasks;
    localStorage.setItem(KEY, JSON.stringify(tasks));
    this.#listeners.forEach((fn) => fn());
  }

  async list(): Promise<Task[]> {
    return [...this.#read()];
  }

  subscribe(onChange: () => void): () => void {
    this.#listeners.add(onChange);
    return () => this.#listeners.delete(onChange);
  }

  async add(input: NewTask): Promise<Task> {
    const task: Task = { ...input, id: uid(), createdAt: Date.now(), completedAt: null };
    this.#write([...this.#read(), task]);
    return task;
  }

  async update(id: string, patch: Partial<Omit<Task, 'id'>>): Promise<void> {
    this.#write(this.#read().map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  async remove(id: string): Promise<void> {
    this.#write(this.#read().filter((t) => t.id !== id));
  }
}
