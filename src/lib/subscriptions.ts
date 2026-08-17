import { readJson, writeJson } from './persist';

/**
 * 구독한 캘린더 목록.
 *
 * 캘린더 하나가 주제 하나입니다. 가장 이해하기 쉬운 매핑이고, 주제를 나누는
 * 기준을 사용자가 이미 캘린더 쪽에서 정해 두었기 때문입니다.
 *
 * 주소는 여기 없습니다. 비공개 ICS 주소는 사실상 비밀번호라(그 주소를 아는
 * 사람은 캘린더 전체를 읽습니다) OS 자격 증명 저장소에 두고, 이 파일에는
 * 그것을 가리키는 손잡이(id)와 화면에 띄울 이름만 남깁니다. 그래서 이 파일이
 * 백업이나 클라우드 동기화로 나가도 캘린더는 열리지 않습니다.
 */

const KEY = 'reminder-widget:calendars:v1';

export interface Subscription {
  /** 자격 증명 저장소에서 주소를 꺼낼 때 쓰는 손잡이이기도 합니다 */
  id: string;
  /** 화면에 띄울 이름. 주소가 아니라 호스트뿐이라 비밀이 아닙니다 */
  label: string;
  /** 이 캘린더의 일정이 놓일 주제 */
  categoryId: string;
  /** 마지막으로 성공한 동기화 시각. 한 번도 성공 못 했으면 null */
  syncedAt: number | null;
  /** 마지막 실패 사유. 성공하면 지웁니다 */
  error?: string;
}

/**
 * 지난 일정을 얼마나 남길지.
 *
 * 무한정 펴면 매주 있는 수업이 학기 내내 지남 구역에 쌓입니다. 아예 안 남기면
 * 어제 놓친 것이 조용히 사라집니다. 일주일이면 '며칠 전에 놓친 것'은 보이고
 * 지난달 수업은 저절로 굴러떨어집니다.
 */
export const BACK_DAYS = 7;
export const AHEAD_DAYS = 120;

export async function loadSubscriptions(): Promise<Subscription[]> {
  return (await readJson<Subscription[]>(KEY)) ?? [];
}

export async function saveSubscriptions(next: Subscription[]): Promise<void> {
  await writeJson(KEY, next);
}

export function newSubscriptionId(): string {
  return 'cal-' + Math.random().toString(36).slice(2, 10);
}

/**
 * 저장할 이름을 짓습니다.
 *
 * 호스트만 씁니다. 비공개 주소에는 계정을 식별하는 긴 토큰이 들어 있어서,
 * 일부라도 남기면 화면 캡처 한 장으로 새어 나갈 여지가 생깁니다. 어느 서비스인지
 * 아는 것으로 충분합니다.
 */
export function labelFor(url: string): string {
  try {
    const host = new URL(url.trim().replace(/^webcals?:\/\//, 'https://')).hostname;
    if (host.includes('google')) return '구글 캘린더';
    if (host.includes('icloud')) return 'iCloud 캘린더';
    if (host.includes('outlook') || host.includes('live.com')) return 'Outlook 캘린더';
    return host;
  } catch {
    return '캘린더';
  }
}
