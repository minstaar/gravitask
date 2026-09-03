import { ARCHIVE_FILE, readJson, writeJson } from './persist';
import type { ArchivedTask, Task } from './types';

/**
 * 완료 기록을 담는 곳.
 *
 * 완료는 삭제가 아닙니다. 체크한 할 일은 살아 있는 목록에서 빠져나와 이 파일로
 * 옮겨 갈 뿐이고, 지워지지 않습니다. 나중에 완료 기록 화면이나 통계를 붙일 때
 * 필요한 재료가 여기 쌓입니다.
 *
 * 기록은 마감이 아니라 완료 순으로 봅니다. 배열 끝이 가장 최근에 끝낸 일입니다.
 */

const KEY = 'reminder-widget:archive:v1';

let cache: ArchivedTask[] | null = null;

async function read(): Promise<ArchivedTask[]> {
  cache ??= (await readJson<ArchivedTask[]>(KEY, ARCHIVE_FILE)) ?? [];
  return cache;
}

async function write(entries: ArchivedTask[]): Promise<void> {
  cache = entries;
  await writeJson(KEY, entries, ARCHIVE_FILE);
}

/** 완료 순. 마지막이 가장 최근입니다 */
export async function listArchive(): Promise<ArchivedTask[]> {
  return [...(await read())];
}

export async function archiveTask(entry: ArchivedTask): Promise<void> {
  const entries = await read();
  // 같은 id가 이미 있으면 최신 기록으로 갈아 끼웁니다. 완료 → 되돌리기 →
  // 다시 완료를 반복해도 기록이 불어나지 않아야 합니다.
  await write([...entries.filter((e) => e.id !== entry.id), entry]);
}

export async function findArchived(id: string): Promise<ArchivedTask | null> {
  return (await read()).find((e) => e.id === id) ?? null;
}

export async function dropArchived(id: string): Promise<void> {
  const entries = await read();
  if (!entries.some((e) => e.id === id)) return;
  await write(entries.filter((e) => e.id !== id));
}

/**
 * 살아 있는 목록과 겹치는 기록을 정리합니다.
 *
 * 완료 처리는 '아카이브에 쓰기 → 살아 있는 목록에서 지우기' 두 단계라, 그
 * 사이에 앱이 죽으면 같은 항목이 양쪽에 남습니다. 그때는 살아 있는 쪽을
 * 진짜로 칩니다 — 최악의 결과가 '한 번 더 체크해야 함'이어야지 '사라짐'이면
 * 안 됩니다.
 */
export async function pruneArchive(liveIds: Set<string>): Promise<void> {
  const entries = await read();
  const kept = entries.filter((e) => !liveIds.has(e.id));
  if (kept.length !== entries.length) await write(kept);
}

/** 기록에서 할 일만 꺼냅니다. 주제 이름 스냅샷은 기록 쪽에 남습니다 */
export function toTask(entry: ArchivedTask): Task {
  return {
    id: entry.id,
    title: entry.title,
    due: entry.due,
    categoryId: entry.categoryId,
    createdAt: entry.createdAt,
    completedAt: null,
    // 반복 규칙은 따라와야 합니다. 기록에서 되살린 할 일이 반복을 잃으면,
    // 되돌리기가 한 회차를 되살리는 대신 계열 전체를 끊어 버립니다.
    repeat: entry.repeat,
  };
}
