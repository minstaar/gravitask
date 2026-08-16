/**
 * 남은 시간 표기 명세. `npm run test:format` 으로 실행합니다.
 * (Node 24의 TypeScript 직접 실행을 씁니다 — 빌드 단계 없음)
 */
import { formatRemaining, zoneOf, MS_HOUR } from './urgency.ts';

// 기준 시각을 고정합니다: 2026-08-14 (금) 10:00
const NOW = new Date(2026, 7, 14, 10, 0, 0, 0).getTime();

/** 실제 호출부와 같은 방식으로 zone을 구해 넘깁니다 */
const fmt = (hoursFromNow: number) => {
  const due = NOW + hoursFromNow * MS_HOUR;
  return formatRemaining(due, NOW, zoneOf(hoursFromNow));
};

const cases: [hours: number, want: string, note: string][] = [
  // 한 시간 안쪽 — '몇 분 남았나'보다 '몇 시까지'가 행동에 가깝습니다
  [0.25, '10:15까지', '15분 뒤'],
  [0.99, '10:59까지', '한 시간 직전'],

  // 활주로 — 24시간 경계를 넘어도 표기가 끊기지 않아야 합니다
  [1, '1h', '정확히 한 시간'],
  [6, '6h', ''],
  [23.9, '23h', '경계 바로 아래'],
  [24, '1d', '경계 — 24h가 아니라 1d'],
  [24.5, '1d', '시간이 0이면 생략'],

  // 대기 — 일 + 시간
  [30, '1d 6h', ''],
  [60, '2d 12h', '기존 표기로는 2.5일'],
  [167, '6d 23h', '일주일 직전'],

  // 일주일 밖 — 시간 단위는 잡음이라 버립니다
  [168, '7d', ''],
  [185, '7d', '기존 표기로는 7.7일'],
  [288, '12d', ''],

  // 지남 — 색과 사선 패턴에만 맡기지 않고 글로도 적습니다
  [-0.003, '방금 지남', '10초 전'],
  [-0.5, '30분 지남', ''],
  [-1, '1h 지남', ''],
  [-25, '1d 1h 지남', ''],
  [-200, '8d 지남', '일주일 밖은 시간 생략'],
];

let pass = 0;
let fail = 0;
for (const [hours, want, note] of cases) {
  const got = fmt(hours);
  const label = `${hours}h`.padEnd(9) + (note ? `(${note})` : '');
  if (got === want) {
    pass++;
    console.log(`  ok   ${label.padEnd(34)} → ${got}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}`);
    console.log(`         got  "${got}"`);
    console.log(`         want "${want}"`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
