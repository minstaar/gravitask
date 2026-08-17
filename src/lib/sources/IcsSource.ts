import { AHEAD_DAYS, BACK_DAYS, type Subscription } from '../subscriptions';
import type { Task, TaskSource } from '../types';

/**
 * 구독한 캘린더 하나를 할 일 소스로 봅니다.
 *
 * 우리가 소유하지 않으므로 writable은 false입니다 — 남의 캘린더를 고치거나
 * 지울 수 없습니다. 하지만 completable은 true입니다. 못 고치는 것과 "이건
 * 처리했다"고 표시하지 못하는 것은 다른 이야기이고, 오히려 표시가 이 위젯에서
 * 가장 자주 하는 일입니다. 그 표시는 store의 오버레이가 맡습니다.
 */

interface Occurrence {
  uid: string;
  occurrence_key: string;
  title: string;
  due: number;
  all_day: boolean;
}

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export class IcsSource implements TaskSource {
  readonly kind = 'ics' as const;
  readonly writable = false;
  readonly completable = true;

  #sub: Subscription;
  #listeners = new Set<() => void>();

  /**
   * 마지막으로 성공한 결과.
   *
   * list()는 네트워크를 타지 않습니다. 할 일을 하나 체크할 때마다 store가
   * refresh를 부르는데, 거기서 매번 캘린더를 받아 오면 체크가 네트워크 왕복을
   * 기다리게 됩니다. 받아 오는 일은 sync()가 따로 합니다.
   */
  #cache: Task[] = [];

  constructor(sub: Subscription) {
    this.#sub = sub;
  }

  get id(): string {
    return `ics:${this.#sub.id}`;
  }

  get label(): string {
    return this.#sub.label;
  }

  get subscription(): Subscription {
    return this.#sub;
  }

  async list(): Promise<Task[]> {
    return [...this.#cache];
  }

  subscribe(onChange: () => void): () => void {
    this.#listeners.add(onChange);
    return () => this.#listeners.delete(onChange);
  }

  /**
   * 캘린더를 받아 옵니다.
   *
   * 실패하면 캐시를 비우지 않습니다. 지하철에서 잠깐 끊겼다고 오늘 마감이
   * 화면에서 사라지면, 그건 도움이 아니라 사고입니다. 마지막으로 성공한 것을
   * 계속 보여주고 언제 받아온 것인지만 밝힙니다.
   */
  async sync(now = Date.now()): Promise<Subscription> {
    if (!inTauri) {
      this.#sub = { ...this.#sub, error: '앱에서만 캘린더를 받아 옵니다' };
      return this.#sub;
    }

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      // 주소가 아니라 손잡이를 넘깁니다. 주소는 자격 증명 저장소에 있고
      // Rust가 거기서 직접 꺼내 씁니다 — 여기로 돌아오지 않습니다.
      const found = await invoke<Occurrence[]>('fetch_calendar', {
        handle: this.#sub.id,
        backDays: BACK_DAYS,
        aheadDays: AHEAD_DAYS,
      });

      this.#cache = found.map((o) => this.#toTask(o, now));
      this.#sub = { ...this.#sub, syncedAt: now, error: undefined };
    } catch (err) {
      this.#sub = { ...this.#sub, error: String(err) };
    }

    this.#listeners.forEach((fn) => fn());
    return this.#sub;
  }

  #toTask(occurrence: Occurrence, now: number): Task {
    return {
      // 소스를 접두사로 붙입니다. 서로 다른 캘린더가 같은 UID를 쓸 수 있습니다.
      id: `${this.id}|${occurrence.occurrence_key}`,
      title: occurrence.title,
      due: occurrence.due,
      categoryId: this.#sub.categoryId,
      // 우리가 만든 것이 아니라 언제 생겼는지 알 수 없습니다. 받아온 시각을 씁니다.
      createdAt: now,
      completedAt: null,
      sourceId: this.id,
      occurrenceKey: occurrence.occurrence_key,
    };
  }
}
