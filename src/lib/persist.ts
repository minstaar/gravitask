/**
 * 데이터를 어디에 둘지 정합니다.
 *
 * 설치된 앱에서는 앱 데이터 폴더의 JSON 파일에 씁니다. localStorage는 브라우저가
 * 언제든 비울 수 있는 저장소라 사용자 데이터를 맡기기에 적절하지 않고, 출처에
 * 묶여 있어 스킴이 바뀌면 통째로 고아가 됩니다. 파일이면 사용자가 백업하거나
 * 다른 PC로 옮길 수도 있습니다.
 *
 * 브라우저 개발 중에는 파일에 접근할 수 없으므로 localStorage를 씁니다.
 */

const FILE = 'gravitask.json';

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

type TauriStore = {
  get<T>(key: string): Promise<T | null | undefined>;
  set(key: string, value: unknown): Promise<void>;
  save(): Promise<void>;
};

let opening: Promise<TauriStore> | null = null;

function openStore(): Promise<TauriStore> {
  opening ??= import('@tauri-apps/plugin-store').then((m) => m.load(FILE, { autoSave: false }));
  return opening as Promise<TauriStore>;
}

export async function readJson<T>(key: string): Promise<T | null> {
  if (!inTauri) {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // 깨진 데이터는 없는 것으로 취급합니다. 여기서 지우지는 않습니다 —
      // 사용자 데이터를 조용히 버리는 것보다 남겨두는 편이 낫습니다.
      return null;
    }
  }

  try {
    return (await (await openStore()).get<T>(key)) ?? null;
  } catch {
    return null;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  if (!inTauri) {
    localStorage.setItem(key, JSON.stringify(value));
    return;
  }

  const store = await openStore();
  await store.set(key, value);
  // autoSave를 끄고 매번 명시적으로 씁니다. 할 일 하나를 체크하고 바로
  // 컴퓨터를 끄더라도 그 변경이 디스크에 남아 있어야 합니다.
  await store.save();
}

/**
 * 이전 버전이 localStorage에 남긴 데이터를 파일로 옮깁니다.
 *
 * 업데이트로 저장 위치가 바뀌는 것은 사용자 사정이 아닙니다. 쓰던 할 일이
 * 사라지면 그건 우리 잘못이지 그들의 잘못이 아닙니다.
 */
export async function migrateFromLocalStorage(keys: string[]): Promise<void> {
  if (!inTauri || typeof localStorage === 'undefined') return;

  for (const key of keys) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;

    // 파일 쪽에 이미 값이 있으면 건드리지 않습니다. 옮긴 뒤에 쌓인 변경을
    // 옛 데이터로 덮어쓰는 것이 가장 나쁜 결과입니다.
    if ((await readJson(key)) !== null) continue;

    try {
      await writeJson(key, JSON.parse(raw));
    } catch {
      /* 깨진 값은 옮기지 않습니다 */
    }
  }
}
