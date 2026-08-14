import { theme, type Theme } from './theme';
import { formatRemaining, hoursUntil, visualFor, type Visual, type Zone } from './urgency';
import type { Category, Task } from './types';

/**
 * 시간축 하나를 모든 범주가 공유하고, 범주마다 레인을 하나씩 가집니다.
 *
 * 뼈대(마감선·24H 경계선·활주로 띠·눈금)는 한 번만 그립니다. 범주마다 축을
 * 통째로 복제하면 범주 수에 비례해 공간을 먹는 데다, 축이 다르면 높이의 의미도
 * 달라져서 범주를 가로지르는 비교가 불가능해집니다.
 *
 * 구역 높이는 전체 기준으로 계산합니다. 그래야 모든 레인이 같은 마감선과 같은
 * 경계선을 쓰고, 활주로에서 "같은 높이 = 같은 시간"이 성립합니다.
 *
 * 대기 구역은 레인마다 자기 순번으로 쌓습니다. 아직 급하지 않은 것들이라
 * 범주를 가로지르는 정밀 비교가 필요 없고, 정확한 값은 카드의 "N일 남음"이
 * 알려줍니다.
 */

export interface Placed {
  task: Task;
  visual: Visual;
  y: number;
  remaining: string;
  zone: Zone;
}

export interface Lane {
  category: Category;
  placed: Placed[];
  hiddenQueue: number;
}

export interface AxisLayout {
  /** 기둥 전체 높이(px). 모든 레인이 공유합니다 */
  height: number;
  /** 마감선의 바닥 기준 높이 */
  deadlineY: number;
  /** 24시간 경계선의 바닥 기준 높이 */
  boundaryY: number;
  /** 지금 활주로가 차지한 높이 (접혔는지 펼쳐졌는지) */
  runwayHeight: number;
  ticks: { label: string; y: number }[];
  lanes: Lane[];
}

interface Split {
  overdue: Prepared[];
  runway: Prepared[];
  queue: Prepared[];
}

interface Prepared {
  task: Task;
  h: number;
  visual: Visual;
  zone: Zone;
}

export function computeAxis(
  tasks: Task[],
  categories: Category[],
  now: number,
  opts: { reducedMotion?: boolean; t?: Theme } = {}
): AxisLayout {
  const t = opts.t ?? theme;
  const L = t.layout;
  const nowDate = new Date(now);

  const prepare = (list: Task[]): Prepared[] =>
    list
      .filter((task) => task.completedAt === null)
      .map((task) => {
        const h = hoursUntil(task.due, now);
        const visual = visualFor(h, nowDate, { reducedMotion: opts.reducedMotion, t });
        return { task, h, visual, zone: visual.zone };
      })
      .sort((a, b) => a.task.due - b.task.due);

  const splits: Split[] = categories.map((c) => {
    const mine = prepare(tasks.filter((task) => task.categoryId === c.id));
    return {
      overdue: mine.filter((x) => x.zone === 'overdue'),
      runway: mine.filter((x) => x.zone === 'runway'),
      queue: mine.filter((x) => x.zone === 'queue'),
    };
  });

  // 구역 높이는 가장 붐비는 레인에 맞춥니다. 쓸 일이 없는 구역은 자리를 비웁니다.
  const maxOverdue = Math.max(0, ...splits.map((s) => s.overdue.length));
  const anyRunway = splits.some((s) => s.runway.length > 0);
  const maxQueue = Math.max(
    0,
    ...splits.map((s) => Math.min(s.queue.length, L.maxQueueVisible))
  );

  const overdueHeight = maxOverdue > 0 ? maxOverdue * L.overdueGap + L.floor : 0;
  const runwayHeight = anyRunway ? L.runwayHeight : L.runwayCollapsed;

  const deadlineY = overdueHeight;
  const boundaryY = deadlineY + runwayHeight;
  const queueHeight = Math.max(L.minQueueHeight, maxQueue * L.queueGap + 10);
  const height = boundaryY + queueHeight;

  const runwayTravel = runwayHeight - L.cardHeight - 10;

  const lanes: Lane[] = categories.map((category, ci) => {
    const s = splits[ci];
    const placed: Placed[] = [];

    // 지남 — 마감선 아래로. 오래 밀린 것일수록 더 깊이 가라앉습니다.
    // s.overdue는 마감이 이른 순이므로 i가 0일수록 가장 오래 밀린 항목입니다.
    s.overdue.forEach((x, i) => {
      placed.push({
        task: x.task,
        visual: x.visual,
        zone: x.zone,
        y: L.floor / 2 + i * L.overdueGap,
        remaining: formatRemaining(x.task.due, now, x.zone),
      });
    });

    // 활주로 — 실제 시간 눈금. 레인이 달라도 같은 높이는 같은 시간입니다.
    s.runway.forEach((x) => {
      const frac = Math.max(0, Math.min(1, x.h / L.runwayHours));
      placed.push({
        task: x.task,
        visual: x.visual,
        zone: x.zone,
        y: deadlineY + L.floor + frac * runwayTravel,
        remaining: formatRemaining(x.task.due, now, x.zone),
      });
    });

    // 대기 — 레인별 균등 간격.
    const visible = s.queue.slice(0, L.maxQueueVisible);
    visible.forEach((x, i) => {
      placed.push({
        task: x.task,
        visual: x.visual,
        zone: x.zone,
        y: boundaryY + 10 + i * L.queueGap,
        remaining: formatRemaining(x.task.due, now, x.zone),
      });
    });

    return { category, placed, hiddenQueue: s.queue.length - visible.length };
  });

  // 접힌 활주로에는 눈금을 그릴 자리가 없습니다.
  const ticks = anyRunway
    ? L.runwayTicks.map((f) => {
        const h = L.runwayHours * f;
        return {
          label: `${Math.round(h)}h`,
          y: deadlineY + L.floor + (h / L.runwayHours) * runwayTravel + L.cardHeight / 2,
        };
      })
    : [];

  return { height, deadlineY, boundaryY, runwayHeight, ticks, lanes };
}
