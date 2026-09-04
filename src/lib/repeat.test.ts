/**
 * 반복 규칙 명세. `npm run test:repeat` 으로 실행합니다.
 *
 * 지키려는 것 셋입니다.
 *  1. 다음 회차는 규칙이 말한 그 날이다 — 요일 반복이 요일을 잃거나 월간
 *     반복이 31일에서 28일로 미끄러져 눌러앉으면, 사용자는 자기가 건 규칙과
 *     다른 날짜를 보게 됩니다.
 *  2. 굴린 뒤의 카드는 언제나 미래에 있다 — 지나간 회차로 굴러가면 체크하는
 *     순간 이미 지난 카드가 다시 나타납니다.
 *  3. 횟수는 정확히 그 횟수만큼이다 — 놓친 회차도 세고, 마지막 회차를 끝내면
 *     반복도 함께 끝납니다.
 */
import {
  alignToRepeat,
  cycleIdOf,
  describeCycle,
  describeRepeat,
  nextOccurrence,
  normalizeRepeat,
  rollRepeat,
  type Repeat,
} from './repeat.ts';

let pass = 0;
let fail = 0;
const check = (label: string, got: unknown, want: unknown) => {
  if (Object.is(got, want)) {
    pass++;
    console.log(`  ok   ${label.padEnd(52)} ${String(got)}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}`);
    console.log(`         got  ${String(got)}`);
    console.log(`         want ${String(want)}`);
  }
};

const at = (y: number, m: number, d: number, h = 23, mi = 59) =>
  new Date(y, m - 1, d, h, mi, 0, 0).getTime();

/** 사람이 읽을 수 있게 — "2026-09-07 23:59 (월)" */
const show = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  const wd = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} (${wd})`;
};

const rep = (r: Partial<Repeat> & Pick<Repeat, 'unit'>): Repeat => ({
  every: 1,
  left: null,
  ...r,
});

// 2026년 9월 3일은 목요일입니다.
const THU = at(2026, 9, 3);

/* ---- 다음 회차 ---- */

check('매일 — 하루 뒤', show(nextOccurrence(THU, rep({ unit: 'day' }))), show(at(2026, 9, 4)));
check(
  '사흘마다 — 사흘 뒤',
  show(nextOccurrence(THU, rep({ unit: 'day', every: 3 }))),
  show(at(2026, 9, 6))
);

check(
  '시각은 그대로 옮겨 간다',
  show(nextOccurrence(at(2026, 9, 3, 18, 30), rep({ unit: 'day' }))),
  show(at(2026, 9, 4, 18, 30))
);

// 요일을 안 골랐으면 마감일의 요일을 따라갑니다 — 목요일이니 다음 목요일.
check(
  '매주 — 요일을 안 고르면 마감일 요일을 따라간다',
  show(nextOccurrence(THU, rep({ unit: 'week' }))),
  show(at(2026, 9, 10))
);

check(
  '격주 — 2주 뒤 같은 요일',
  show(nextOccurrence(THU, rep({ unit: 'week', every: 2 }))),
  show(at(2026, 9, 17))
);

// 월·수 반복. 목요일에서 보면 이번 주에 남은 요일이 없으니 다음 주 월요일입니다.
check(
  '매주 월·수 — 목요일에서 보면 다음 주 월요일',
  show(nextOccurrence(THU, rep({ unit: 'week', weekdays: [1, 3] }))),
  show(at(2026, 9, 7))
);

check(
  '매주 월·수 — 월요일에서 보면 같은 주 수요일',
  show(nextOccurrence(at(2026, 9, 7), rep({ unit: 'week', weekdays: [1, 3] }))),
  show(at(2026, 9, 9))
);

check(
  '격주 월·수 — 수요일에서 보면 2주 뒤 월요일',
  show(nextOccurrence(at(2026, 9, 9), rep({ unit: 'week', every: 2, weekdays: [1, 3] }))),
  show(at(2026, 9, 21))
);

check(
  '평일 — 금요일 다음은 월요일',
  show(nextOccurrence(at(2026, 9, 4), rep({ unit: 'week', weekdays: [1, 2, 3, 4, 5] }))),
  show(at(2026, 9, 7))
);

/* ---- 월간 반복이 미끄러지지 않는가 ---- */
//
// 굴릴 때마다 현재 마감일에서 다시 세면 1월 31일이 2월 28일로 당겨진 뒤 그대로
// 28일에 눌러앉습니다. monthDay가 원래 날짜를 붙들고 있어야 3월에 돌아옵니다.

const jan31 = at(2026, 1, 31);
const monthly = normalizeRepeat(rep({ unit: 'month' }), jan31);
check('매월 — 규칙이 31일을 기억한다', monthly.monthDay, 31);

const feb = nextOccurrence(jan31, monthly);
check('매월 — 2월에는 마지막 날로 당긴다', show(feb), show(at(2026, 2, 28)));
check('매월 — 3월에는 다시 31일로 돌아온다', show(nextOccurrence(feb, monthly)), show(at(2026, 3, 31)));

check(
  '매월 15일은 매달 15일이다',
  show(nextOccurrence(at(2026, 1, 15), rep({ unit: 'month' }))),
  show(at(2026, 2, 15))
);

/* ---- 첫 회차 맞추기 ---- */
//
// "평일 스탠드업"을 토요일에 적으면 첫 카드가 일요일이 됩니다. 규칙이 평일이라
// 말하는데 첫 카드가 주말인 것은 그 자리에서 틀린 값입니다.

const sat = at(2026, 9, 5);
check(
  '평일 규칙을 토요일에 걸면 첫 회차가 월요일로 간다',
  show(alignToRepeat(sat, rep({ unit: 'week', weekdays: [1, 2, 3, 4, 5] }))),
  show(at(2026, 9, 7))
);
check(
  '이미 규칙에 맞는 날이면 그대로 둔다',
  show(alignToRepeat(THU, rep({ unit: 'week', weekdays: [4] }))),
  show(THU)
);
check(
  '요일을 안 골랐으면 마감일이 곧 규칙이라 옮기지 않는다',
  show(alignToRepeat(sat, rep({ unit: 'week' }))),
  show(sat)
);

/* ---- 시각은 규칙이 기억한다 ---- */
//
// 날짜가 이번 회차만 옮겨지는 것과 같아야 합니다. 이번 주 랩미팅만 2시에서
// 4시로 미뤘는데 다음 주도 4시가 되면, 날짜는 이번만이고 시각만 영구히
// 바뀌어 앞뒤가 맞지 않습니다.

const at2pm = at(2026, 9, 7, 14, 0); // 월요일 오후 2시
const weekly2pm = normalizeRepeat(rep({ unit: 'week', weekdays: [1] }), at2pm);
check('규칙이 시각을 기억한다 (14:00 → 840분)', weekly2pm.atMinutes, 14 * 60);

check(
  '다음 회차는 규칙의 시각에 온다',
  show(nextOccurrence(at2pm, weekly2pm)),
  show(at(2026, 9, 14, 14, 0))
);

check(
  '이번 회차만 4시로 미뤄도 다음은 2시로 돌아온다',
  show(nextOccurrence(at(2026, 9, 7, 16, 0), weekly2pm)),
  show(at(2026, 9, 14, 14, 0))
);

check(
  '날짜와 시각을 함께 옮겨도 다음은 제자리 (수 14시 → 이번만 목 16시)',
  show(
    nextOccurrence(
      at(2026, 9, 3, 16, 0),
      normalizeRepeat(rep({ unit: 'week', weekdays: [3] }), at(2026, 9, 2, 14, 0))
    )
  ),
  show(at(2026, 9, 9, 14, 0))
);

check(
  '매월도 마찬가지',
  show(
    nextOccurrence(
      at(2026, 9, 5, 20, 0),
      normalizeRepeat(rep({ unit: 'month' }), at(2026, 9, 1, 9, 0))
    )
  ),
  show(at(2026, 10, 1, 9, 0))
);

// 이 값이 생기기 전에 저장된 규칙은 시각을 안 들고 있습니다. 처음 읽을 때
// 그때의 마감에서 채워지므로, 예전과 똑같이 동작해야 합니다.
check(
  '옛 규칙(시각 없음)은 마감 시각을 따라간다',
  show(nextOccurrence(at2pm, rep({ unit: 'week', weekdays: [1] }))),
  show(at(2026, 9, 14, 14, 0))
);

/* ---- 굴리기 ---- */

const NOW = at(2026, 9, 3, 12, 0);

const rolled = rollRepeat(THU, rep({ unit: 'week' }), NOW);
check('굴리면 다음 회차로 간다', show(rolled!.due), show(at(2026, 9, 10)));
check('끝을 안 정했으면 계속 남는다', rolled!.repeat.left, null);

// 3주를 놓친 주간 과제(8/13 목). 오늘 체크했는데 다음 카드가 2주 전이면,
// 굴리자마자 이미 지난 카드를 다시 보게 됩니다. 8/20 · 8/27을 건너뛰고
// 아직 오지 않은 오늘 밤 마감으로 갑니다 — 건너뛰되 필요 이상으로 멀리
// 가지는 않습니다.
const late = rollRepeat(at(2026, 8, 13), rep({ unit: 'week' }), NOW);
check('지나간 회차는 건너뛴다', show(late!.due), show(at(2026, 9, 3)));
check('굴린 결과는 언제나 지금보다 뒤다', late!.due > NOW, true);

/* ---- 횟수 ---- */

const three = rollRepeat(THU, rep({ unit: 'week', left: 3 }), NOW);
check('3회 남았으면 굴린 뒤 2회', three!.repeat.left, 2);

const last = rollRepeat(THU, rep({ unit: 'week', left: 1 }), NOW);
check('마지막 회차를 끝내면 반복도 끝난다', last, null);

// 놓친 회차도 셉니다. 열다섯 번 있는 수업은 안 갔어도 열다섯 번입니다.
const skipped = rollRepeat(at(2026, 8, 13), rep({ unit: 'week', left: 5 }), NOW);
check('건너뛴 회차도 남은 횟수에서 깎는다', skipped!.repeat.left, 2);

const usedUp = rollRepeat(at(2026, 8, 13), rep({ unit: 'week', left: 2 }), NOW);
check('남은 횟수가 전부 지나갔으면 끝난다', usedUp, null);

// 몇 번을 굴려도 정확히 그 횟수만큼입니다.
let cur: { due: number; repeat: Repeat } | null = { due: THU, repeat: rep({ unit: 'week', left: 4 }) };
let rounds = 0;
let clock = NOW;
while (cur) {
  rounds++;
  clock = cur.due + 1000; // 그 회차를 마감 직후에 끝냈다고 봅니다
  cur = rollRepeat(cur.due, cur.repeat, clock);
}
check('4회짜리는 정확히 4번 체크하면 끝난다', rounds, 4);

/* ---- 사람이 읽는 말 ---- */

check('매일', describeCycle(rep({ unit: 'day' })), '매일');
check('평일', describeCycle(rep({ unit: 'week', weekdays: [1, 2, 3, 4, 5] })), '평일');
check('매주 월·수', describeCycle(rep({ unit: 'week', weekdays: [1, 3] })), '매주 월·수');
check('격주 금', describeCycle(rep({ unit: 'week', every: 2, weekdays: [5] })), '격주 금');
check('매월 15일', describeCycle(rep({ unit: 'month' }), at(2026, 9, 15)), '매월 15일');
check(
  '주기와 횟수를 함께',
  describeRepeat(rep({ unit: 'week', weekdays: [1], left: 15 })),
  '매주 월 · 15회 남음'
);

/* ---- 선택지와 규칙이 서로를 알아보는가 ---- */

check('매일 → day', cycleIdOf(rep({ unit: 'day' })), 'day');
check('매주 월 → week', cycleIdOf(rep({ unit: 'week', weekdays: [1] })), 'week');
// 월~금은 '평일'이라 읽히지만 주기로는 그냥 매주입니다. 버튼이 따로 없으니
// 되짚을 때도 매주로 돌아와야, 화면에서 '매주'가 켜지고 요일 줄이 월~금을
// 보여 주는 한 가지 모습만 남습니다.
check('월~금도 주기로는 매주', cycleIdOf(rep({ unit: 'week', weekdays: [1, 2, 3, 4, 5] })), 'week');
check('그래도 읽을 때는 평일', describeCycle(rep({ unit: 'week', weekdays: [1, 2, 3, 4, 5] })), '평일');
check('격주 → biweek', cycleIdOf(rep({ unit: 'week', every: 2 })), 'biweek');
check('매월 → month', cycleIdOf(rep({ unit: 'month' })), 'month');
check('선택지에 없는 규칙은 null', cycleIdOf(rep({ unit: 'day', every: 3 })), null);
check('반복이 없으면 null', cycleIdOf(null), null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
