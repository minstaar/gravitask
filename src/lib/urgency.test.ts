/**
 * 남은 시간 표기 명세. `npm run test:format` 으로 실행합니다.
 * (Node 24의 TypeScript 직접 실행을 씁니다 — 빌드 단계 없음)
 */
import { formatDeadline, formatRemaining, zoneOf, MS_HOUR } from './urgency.ts';

// 기준 시각을 고정합니다: 2026-08-14 (금) 10:00
const NOW = new Date(2026, 7, 14, 10, 0, 0, 0).getTime();

/** 실제 호출부와 같은 방식으로 zone을 구해 넘깁니다 */
const fmt = (hoursFromNow: number) => {
  const due = NOW + hoursFromNow * MS_HOUR;
  return formatRemaining(due, NOW, zoneOf(hoursFromNow));
};

const cases: [hours: number, want: string, note: string][] = [
  // 하루 안쪽 — 분까지 적는다. 오늘 안에 끝낼 일은 분이 계획을 바꾼다
  [0.25, '15m', '15분 뒤'],
  [0.99, '59m', '한 시간 직전'],
  [1, '1h', '정확히 한 시간 — 0인 단위는 생략'],
  [2.5, '2h 30m', ''],
  [6, '6h', ''],
  [23.9, '23h 54m', '경계 바로 아래'],

  // 하루 밖 — 시간까지
  [24, '1d', '경계 — 24h가 아니라 1d'],
  [24.5, '1d', '시간이 0이면 생략'],
  [30, '1d 6h', ''],
  [60, '2d 12h', '기존 표기로는 2.5일'],
  [167, '6d 23h', '일주일 직전'],

  // 일주일 밖 — 시간 단위는 잡음이라 버린다
  [168, '7d', ''],
  [185, '7d', '기존 표기로는 7.7일'],
  [288, '12d', ''],

  // 지남 — 색과 사선 패턴에만 맡기지 않고 글로도 적는다
  [-0.003, '방금 지남', '10초 전'],
  [-0.5, '30m 지남', ''],
  [-1, '1h 지남', ''],
  [-2.25, '2h 15m 지남', ''],
  [-25, '1d 1h 지남', ''],
  [-200, '8d 지남', '일주일 밖은 시간 생략'],
];

/* 마감 시각 — 카드에 손을 올렸을 때만 보이는 쪽 */
const dueCases: [due: Date, want: string, note: string][] = [
  [new Date(2026, 7, 14, 14, 0), '오늘 14:00', ''],
  [new Date(2026, 7, 14, 7, 0), '오늘 07:00', '지난 것도 오늘이면 오늘'],
  [new Date(2026, 7, 15, 6, 0), '내일 06:00', ''],
  [new Date(2026, 7, 13, 14, 0), '어제 14:00', ''],
  [new Date(2026, 7, 24, 10, 0), '8/24(월) 10:00', '그 밖은 날짜와 요일'],
  [new Date(2027, 0, 3, 9, 30), '2027/1/3(일) 09:30', '해가 바뀌면 연도까지'],
];

let pass = 0;
let fail = 0;

const check = (label: string, got: string, want: string) => {
  if (got === want) {
    pass++;
    console.log(`  ok   ${label.padEnd(36)} → ${got}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}`);
    console.log(`         got  "${got}"`);
    console.log(`         want "${want}"`);
  }
};

for (const [hours, want, note] of cases) {
  check(`${hours}h`.padEnd(9) + (note ? `(${note})` : ''), fmt(hours), want);
}

for (const [due, want, note] of dueCases) {
  check(want.padEnd(9) + (note ? ` (${note})` : ''), formatDeadline(due.getTime(), NOW), want);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
