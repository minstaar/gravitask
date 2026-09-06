import { logWarn } from '../log';
import { readJsonStrict, writeJson } from '../persist';
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
  /**
   * 저장된 목록을 실제로 읽어 왔는가.
   *
   * 못 읽은 것을 '없다'로 받으면 다음 저장이 빈 목록으로 파일을 덮습니다.
   * 할 일 하나를 더하려다 전부 잃는 셈이라, 읽기에 실패했으면 쓰지 않습니다.
   */
  #loaded = false;

  async #read(): Promise<Task[]> {
    if (this.#cache) return this.#cache;
    this.#cache = (await readJsonStrict<Task[]>(KEY)) ?? [];
    this.#loaded = true;
    return this.#cache;
  }

  /**
   * 디스크에 먼저 쓰고, 성공한 뒤에 메모리에 반영합니다.
   *
   * 순서가 반대였습니다. 그러면 저장이 실패해도 화면에는 멀쩡히 카드가 뜹니다
   * — 화면이 읽는 것은 이 캐시니까요. 사용자는 적혔다고 믿고 앱을 닫고,
   * 다시 켜면 없습니다. 조용히 잃는 것이 가장 나쁜 고장입니다.
   *
   * 이 순서면 실패했을 때 카드가 나타나지 않습니다. 적었는데 안 뜨는 것은
   * 이상하지만 그 자리에서 알아챌 수 있고, 알아챌 수 있는 고장은 잃지 않습니다.
   * 완료 처리가 '기록에 먼저 쓰고 목록에서 뺀다'고 정해 둔 것과 같은 원칙입니다.
   */
  async #write(tasks: Task[]): Promise<void> {
    if (!this.#loaded) throw new Error('저장된 할 일을 읽지 못해 덮어쓰지 않았습니다');
    await writeJson(KEY, tasks);
    this.#cache = tasks;
    this.#listeners.forEach((fn) => fn());
  }

  async list(): Promise<Task[]> {
    try {
      return [...(await this.#read())];
    } catch (err) {
      // 화면은 잠시 비어도 파일은 그대로입니다. 다음 새로고침에 다시 읽습니다.
      logWarn(`할 일을 읽지 못했습니다: ${(err as Error)?.message ?? String(err)}`);
      return [];
    }
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
