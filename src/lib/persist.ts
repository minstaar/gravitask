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

/** 살아 있는 할 일과 설정 */
export const MAIN_FILE = 'gravitask.json';

/**
 * 완료 기록.
 *
 * 파일을 나누는 이유는 쓰기 비용과 사고 반경입니다. 한 파일에 두면 오늘 할 일
 * 하나를 체크할 때마다 지난 몇 년치 기록을 함께 직렬화해 다시 씁니다. 그리고
 * 그 쓰기가 도중에 깨지면 살아 있는 할 일까지 같이 잃습니다. 나눠 두면 매일의
 * 쓰기는 작게 유지되고, 기록이 깨져도 오늘 할 일은 무사합니다.
 */
export const ARCHIVE_FILE = 'gravitask-archive.json';

/**
 * 구독한 캘린더에서 마지막으로 받아 온 일정.
 *
 * 남의 서버에서 온 것을 다시 받아올 수 있으니 없어도 되는 데이터입니다.
 * 그래도 남기는 이유는 앱을 켜는 순간에 있습니다 — 받아오기 전까지 캘린더
 * 일정이 화면에서 통째로 빠지고, 부팅 직후처럼 아직 인터넷이 안 붙었으면
 * 그 세션 내내 빠져 있습니다.
 *
 * 파일을 따로 두는 것은 쓰기 비용 때문입니다. 20분마다 갱신되는 것을 살아
 * 있는 할 일과 한 파일에 두면, 그때마다 손으로 적은 할 일까지 함께 다시
 * 씁니다. 그리고 이 파일은 언제든 지워도 되는 데이터라, 깨져도 잃을 것이
 * 없다는 점이 같은 파일에 있어서는 안 되는 이유이기도 합니다.
 */
export const CALENDAR_CACHE_FILE = 'gravitask-calendar-cache.json';

import { logError, logWarn, reasonOf } from './log';

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

type TauriStore = {
  get<T>(key: string): Promise<T | null | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  save(): Promise<void>;
};

const opening = new Map<string, Promise<TauriStore>>();

/**
 * 파일 하나당 저장소 하나. 여는 일은 한 번만 합니다.
 *
 * 실패한 약속은 캐시에 남기지 않습니다. 남기면 그 세션 내내 그 파일을 읽지도
 * 쓰지도 못합니다 — 읽기는 조용히 null이 되고(설정도 할 일도 완료 표시도
 * 사라진 것처럼 보입니다) 쓰기는 매번 같은 실패로 돌아옵니다. 앱을 껐다 켜기
 * 전에는 회복할 방법이 없고, 그 사이 적은 것은 전부 잃습니다.
 */
function openStore(file: string): Promise<TauriStore> {
  let p = opening.get(file);
  if (!p) {
    p = import('@tauri-apps/plugin-store')
      .then((m) => m.load(file, { autoSave: false }))
      .catch((err) => {
        opening.delete(file);
        throw err;
      });
    opening.set(file, p);
  }
  return p;
}

/**
 * 답이 없는 것도 실패로 칩니다.
 *
 * 거절은 누군가 받을 수 있지만, 영원히 끝나지 않는 약속은 아무도 못 받습니다.
 * 그 상태가 이 앱에서 가장 고약한 모양입니다 — 저장이 멎으면 LocalSource가
 * 메모리를 갱신하지 못해 카드가 안 생기고, 오류가 없으니 화면에 띄울 것도
 * 없고, 다음 저장도 같은 자리에서 멎습니다. 사용자에게는 "눌렀는데 아무 일도
 * 안 일어남"으로만 보입니다.
 *
 * 노트북을 덮었다 여는 사이에 백엔드로 가는 길이 한 번 엉키면 이렇게 됩니다.
 * 기다림에 끝을 두면 그 다음부터는 평범한 실패라, 저장소를 다시 열어 보고
 * 그래도 안 되면 화면에 말할 수 있습니다.
 */
const WRITE_TIMEOUT_MS = 5000;

function withDeadline<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what}이(가) ${WRITE_TIMEOUT_MS}ms 안에 응답하지 않았습니다`)),
      WRITE_TIMEOUT_MS
    );
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/** 한 번 쓰기. 실패하면 그대로 던집니다 */
async function put(key: string, value: unknown, file: string): Promise<void> {
  const store = await withDeadline(openStore(file), `${file} 열기`);
  await withDeadline(store.set(key, value), `${file} 쓰기`);
  // autoSave를 끄고 매번 명시적으로 씁니다. 할 일 하나를 체크하고 바로
  // 컴퓨터를 끄더라도 그 변경이 디스크에 남아 있어야 합니다.
  await withDeadline(store.save(), `${file} 저장`);
}

export async function readJson<T>(key: string, file = MAIN_FILE): Promise<T | null> {
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
    return (await (await openStore(file)).get<T>(key)) ?? null;
  } catch {
    return null;
  }
}

export async function writeJson(key: string, value: unknown, file = MAIN_FILE): Promise<void> {
  if (!inTauri) {
    localStorage.setItem(key, JSON.stringify(value));
    return;
  }

  try {
    await put(key, value, file);
  } catch (err) {
    // 열어 둔 저장소가 상해 있을 수 있습니다. 버리고 새로 열어 한 번 더
    // 해 봅니다. 두 번째도 실패하면 그대로 던집니다 — 저장이 안 됐다는
    // 사실이 조용히 묻히는 것이 이 앱에서 가장 나쁜 결과입니다.
    logWarn(`저장 실패 — 저장소를 다시 열고 재시도합니다 (${file}/${key}): ${reasonOf(err)}`);
    opening.delete(file);
    try {
      await put(key, value, file);
    } catch (again) {
      // 두 번 실패했으면 그대로 던집니다. 다만 그 전에 반드시 남깁니다 —
      // 사용자 PC에서 이 자리를 다시 볼 방법은 이 한 줄뿐입니다.
      logError(`저장 최종 실패 (${file}/${key})`, again);
      throw again;
    }
    // 두 번째에 성공했다는 것은 첫 번째 핸들이 상해 있었다는 뜻입니다.
    logWarn(`재시도로 저장에 성공했습니다: ${file}`);
  }
}

/**
 * 지웁니다.
 *
 * 값을 비우는 것과 키를 없애는 것은 다릅니다. 연결을 끊은 캘린더의 일정
 * 제목이 파일에 그대로 남아 있는 것은, 끊었다는 사용자의 뜻과 어긋납니다.
 */
export async function removeJson(key: string, file = MAIN_FILE): Promise<void> {
  if (!inTauri) {
    localStorage.removeItem(key);
    return;
  }

  try {
    const store = await openStore(file);
    await store.delete(key);
    await store.save();
  } catch {
    /* 없으면 지운 것과 같습니다 */
  }
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
