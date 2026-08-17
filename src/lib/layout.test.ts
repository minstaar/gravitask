/**
 * 배치 명세. `npm run test:layout` 으로 실행합니다.
 *
 * 지키려는 것 둘입니다.
 *  1. 기둥 높이가 예산을 넘지 않는다 — 밀린 일이 쌓일수록 위젯이 화면을
 *     가로막으면, 하필 가장 도움이 필요한 사람에게서 도망가는 물건이 됩니다.
 *  2. 그래도 아무것도 잃지 않는다 — 예산 밖으로 밀려난 카드는 접히는 게
 *     아니라 구역 안에서 끌어 볼 수 있어야 합니다(content > height).
 */
import { computeAxis } from './layout.ts';
import { theme } from './theme.ts';
import { MS_HOUR } from './urgency.ts';
import type { Category, Task } from './types.ts';

const NOW = new Date(2026, 7, 14, 10, 0, 0, 0).getTime();
const L = theme.layout;

const categories: Category[] = [
  { id: 'a', name: '학업', order: 0 },
  { id: 'b', name: '생활', order: 1 },
];

let seq = 0;
const task = (categoryId: string, hoursFromNow: number): Task => ({
  id: `t${seq++}`,
  title: `할 일 ${seq}`,
  due: NOW + hoursFromNow * MS_HOUR,
  categoryId,
  createdAt: NOW - 100 * MS_HOUR,
  completedAt: null,
});

/** 한 레인을 구역별로 원하는 만큼 채웁니다 */
const fill = (cat: string, overdue: number, runway: number, queue: number): Task[] => [
  ...Array.from({ length: overdue }, (_, i) => task(cat, -(i + 1) * 3)),
  ...Array.from({ length: runway }, (_, i) => task(cat, 1 + i * 1.7)),
  ...Array.from({ length: queue }, (_, i) => task(cat, 30 + i * 24)),
];

let pass = 0;
let fail = 0;
const check = (label: string, got: unknown, want: unknown) => {
  if (Object.is(got, want)) {
    pass++;
    console.log(`  ok   ${label.padEnd(48)} ${String(got)}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}`);
    console.log(`         got  ${String(got)}`);
    console.log(`         want ${String(want)}`);
  }
};

// ---- 예산이 지켜지는가 ----

const BUDGET = 420;
const crowded = fill('a', 12, 15, 20).concat(fill('b', 8, 10, 14));
const axis = computeAxis(crowded, categories, NOW, { budget: BUDGET });

check('빠듯한 예산 안에 들어간다', axis.height <= BUDGET, true);
check('구역 높이의 합이 곧 기둥 높이다', axis.overdueHeight + axis.runwayHeight + axis.queueHeight, axis.height);

const doubled = computeAxis(
  fill('a', 40, 40, 40).concat(fill('b', 40, 40, 40)),
  categories,
  NOW,
  { budget: BUDGET }
);
check('항목을 몇 배로 늘려도 높이가 같다', doubled.height, axis.height);

// ---- 접히지 않고 끌 수 있는가 ----

check('넘친 만큼 지남 구역을 끌 수 있다', axis.lanes[0].content.overdue > axis.overdueHeight, true);
check('넘친 만큼 대기 구역을 끌 수 있다', axis.lanes[0].content.queue > axis.queueHeight, true);
check('넘친 만큼 활주로를 끌 수 있다', axis.runwayContent > axis.runwayHeight, true);

const drawn = axis.lanes[0].placed.length;
const given = crowded.filter((t) => t.categoryId === 'a').length;
check('한 장도 버리지 않고 전부 배치한다', drawn, given);

// ---- 모자랄 때 고르게 나누는가 ----
//
// 급한 순서로 몰아주면, 오늘 마감이 스무 개인 날 활주로가 예산을 다 먹고
// 지남과 대기가 사라집니다. 하필 그런 날 정작 봐야 하는 게 밀린 일입니다.

const runwayHeavy = computeAxis(fill('a', 5, 30, 10), categories, NOW, { budget: 420 });

check('활주로가 넘쳐도 지남이 최소치보다 많이 받는다', runwayHeavy.overdueHeight > L.cardHeight + L.floor, true);
check('활주로가 넘쳐도 대기가 최소치보다 많이 받는다', runwayHeavy.queueHeight > L.minQueueHeight, true);
check(
  '한 구역이 예산의 3분의 2를 넘게 먹지 않는다',
  Math.max(runwayHeavy.overdueHeight, runwayHeavy.runwayHeight, runwayHeavy.queueHeight) <
    runwayHeavy.height * 0.67,
  true
);

// 반대로, 적게 필요한 구역이 자리를 붙들고 있어도 안 됩니다.
const queueOnly = computeAxis(fill('a', 0, 1, 30), categories, NOW, { budget: 420 });
check('덜 필요한 구역이 남긴 몫은 다른 구역이 가져간다', queueOnly.queueHeight > 420 * 0.6, true);
check('그래도 활주로는 최소치를 지킨다', queueOnly.runwayHeight >= L.runwayHeight, true);

// ---- 경계에 딱 걸린 항목이 경계선에 닿는가 ----
//
// 활주로는 순번이 아니라 눈금이다. 마감이 정확히 24시간 남았는데 24H 선에 닿지
// 않거나 마감 순간인데 DUE 선에 닿지 않으면, 두 선이 무엇을 가리키는지 흐려진다.

seq = 0;
const edges = computeAxis(
  [task('a', 24), task('a', 0.001), task('a', 12)],
  categories,
  NOW,
  { budget: 1000 }
);
const atHour = (h: number) =>
  edges.lanes[0].placed.find((p) => Math.abs((p.task.due - NOW) / MS_HOUR - h) < 0.01);

check('마감 순간인 항목은 카드 바닥이 DUE 선에 붙는다', atHour(0.001)?.y, 0);
check(
  '딱 24시간 남은 항목은 카드 위쪽이 24H 선에 붙는다',
  (atHour(24)?.y ?? -1) + L.cardHeight,
  edges.runwayContent
);
check('활주로는 가장자리 여백이 없다', edges.runwayFloor, 0);
check(
  '12시간 남은 항목은 활주로 한가운데에 온다',
  Math.round(((atHour(12)?.y ?? 0) / edges.runwayTravel) * 100),
  50
);

// ---- 지남은 마감선에 매달리는가 ----
//
// 깊이가 '얼마나 오래 밀렸나'를 뜻하려면 기준이 마감선이어야 한다. 바닥을
// 기준으로 쌓으면 구역 높이(가장 붐비는 레인이 정한다)에 따라 같은 항목의
// 깊이가 달라져, 방금 놓친 것이 몇 주 밀린 것처럼 보인다.

seq = 0;
const lopsided = computeAxis(
  // a는 한 건만 밀렸고 b는 열 건이 밀렸습니다. 구역 높이는 b가 정합니다.
  [task('a', -0.5), ...Array.from({ length: 10 }, (_, i) => task('b', -(i + 1) * 3))],
  categories,
  NOW,
  { budget: 900 }
);
const soloTop = (lopsided.lanes[0].placed[0]?.y ?? 0) + L.cardHeight;
check(
  '밀린 게 하나뿐인 레인도 그 카드가 마감선에 붙는다',
  soloTop,
  Math.max(lopsided.overdueHeight, lopsided.lanes[1].content.overdue)
);

const crowdedLane = lopsided.lanes[1].placed.filter((p) => p.zone === 'overdue');
const newest = crowdedLane.reduce((a, b) => (a.task.due > b.task.due ? a : b));
check('붐비는 레인도 가장 최근에 놓친 것이 마감선에 붙는다', newest.y + L.cardHeight, soloTop);

// ---- 빈 대기 구역이 자리를 붙들지 않는가 ----

const noQueue = computeAxis(fill('a', 10, 0, 0), categories, NOW, { budget: 420 });
check('대기가 비면 접힌다', noQueue.queueHeight, L.queueCollapsed);
check(
  '그만큼 지남이 더 받는다',
  noQueue.overdueHeight > 420 - L.queueCollapsed - L.runwayCollapsed - 1,
  true
);

// ---- content 좌표에서는 절대 겹치지 않는가 ----

const worstOverlap = (zone: string) => {
  const ys = axis.lanes[0].placed
    .filter((p) => p.zone === zone)
    .map((p) => p.y)
    .sort((a, b) => a - b);
  let worst = 0;
  for (let i = 1; i < ys.length; i++) worst = Math.max(worst, L.cardHeight - (ys[i] - ys[i - 1]));
  return +worst.toFixed(2);
};
check('지남 카드가 겹치지 않는다 (겹침 px)', worstOverlap('overdue'), 0);
check('활주로 카드가 겹치지 않는다 (겹침 px)', worstOverlap('runway'), 0);
check('대기 카드가 겹치지 않는다 (겹침 px)', worstOverlap('queue'), 0);

// 같은 시각에 전부 몰린 최악의 경우에도
seq = 0;
const piled = computeAxis(
  Array.from({ length: 12 }, () => task('a', 6)),
  categories,
  NOW,
  { budget: BUDGET }
);
const pys = piled.lanes[0].placed.map((p) => p.y).sort((a, b) => a - b);
let pileWorst = 0;
for (let i = 1; i < pys.length; i++) pileWorst = Math.max(pileWorst, L.cardHeight - (pys[i] - pys[i - 1]));
check('같은 시각에 12개가 몰려도 겹치지 않는다', +pileWorst.toFixed(2), 0);

// ---- 한가할 때는 작은가 ----

const empty = computeAxis([], categories, NOW, { budget: BUDGET });
check('빈 판은 활주로를 접는다', empty.runwayHeight, L.runwayCollapsed);
check('빈 판 높이', empty.height, L.runwayCollapsed + L.queueCollapsed);
check('빈 판은 끌 것이 없다', empty.runwayContent <= empty.runwayHeight, true);

const light = computeAxis(fill('a', 0, 1, 2), categories, NOW, { budget: BUDGET });
check('한가하면 예산을 다 쓰지 않는다', light.height < BUDGET, true);
check('한가하면 지남 구역이 자리를 비운다', light.overdueHeight, 0);

console.log(`\n예산 ${BUDGET}px → 기둥 ${axis.height}px (지남 ${axis.overdueHeight} / 활주로 ${axis.runwayHeight} / 대기 ${axis.queueHeight})`);
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
