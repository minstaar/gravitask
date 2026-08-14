import { theme, type Theme } from './theme';
import { formatRemaining, hoursUntil, visualFor, type Visual, type Zone } from './urgency';
import type { Task } from './types';

/**
 * 3구역 배치.
 *
 * 아래에서부터: 지남 / 활주로(24시간 이내, 실제 시간 눈금) / 대기(그 이상, 균등 간격).
 *
 * 지난 항목을 겹쳐 쌓지 않는 이유: 겹치면 "밀린 게 많다"는 압박만 주고 정작
 * 무엇이 밀렸는지는 못 봅니다. 밀린 일을 처리하려면 각각이 보여야 합니다.
 *
 * 기둥 높이는 내용에 따라 달라집니다. 고정 높이로 두면 항목이 적을 때는
 * 빈 공간이, 많을 때는 스크롤이 생깁니다. 위젯에서 스크롤은 최후의 수단입니다.
 */

export interface Placed {
  task: Task;
  visual: Visual;
  y: number;
  remaining: string;
  zone: Zone;
}

export interface ColumnLayout {
  /** 기둥 전체 높이(px) */
  height: number;
  /** 마감선의 바닥 기준 높이 */
  deadlineY: number;
  /** 24시간 경계선의 바닥 기준 높이 */
  boundaryY: number;
  placed: Placed[];
  hiddenQueue: number;
  ticks: { label: string; y: number }[];
}

export function computeLayout(
  tasks: Task[],
  now: number,
  opts: { reducedMotion?: boolean; t?: Theme } = {}
): ColumnLayout {
  const t = opts.t ?? theme;
  const L = t.layout;
  const nowDate = new Date(now);

  const live = tasks
    .filter((task) => task.completedAt === null)
    .map((task) => {
      const h = hoursUntil(task.due, now);
      const visual = visualFor(h, nowDate, { reducedMotion: opts.reducedMotion, t });
      return { task, h, visual, zone: visual.zone };
    })
    .sort((a, b) => a.task.due - b.task.due);

  const overdue = live.filter((x) => x.zone === 'overdue');
  const runway = live.filter((x) => x.zone === 'runway');
  const queue = live.filter((x) => x.zone === 'queue');

  const visibleQueue = queue.slice(0, L.maxQueueVisible);
  const hiddenQueue = queue.length - visibleQueue.length;

  // 지난 항목이 없으면 그 구역은 아예 존재하지 않습니다.
  const overdueHeight = overdue.length > 0 ? overdue.length * L.overdueGap + L.floor : 0;

  const deadlineY = overdueHeight;
  const boundaryY = deadlineY + L.runwayHeight;
  const queueHeight = Math.max(L.minQueueHeight, visibleQueue.length * L.queueGap + 10);
  const height = boundaryY + queueHeight;

  const runwayTravel = L.runwayHeight - L.cardHeight - 10;
  const placed: Placed[] = [];

  // 지남 — 마감선 아래로. 오래 밀린 것일수록 더 깊이 가라앉습니다.
  // 방금 넘긴 항목이 선 바로 아래에 있어야 중력 은유가 이어집니다.
  // overdue는 마감이 이른 순, 즉 i가 0일수록 가장 오래 밀린 항목입니다.
  // 그것이 바닥(y가 작은 쪽)에 가고, 최근에 넘긴 것이 선 바로 아래에 옵니다.
  overdue.forEach((x, i) => {
    placed.push({
      task: x.task,
      visual: x.visual,
      zone: x.zone,
      y: L.floor / 2 + i * L.overdueGap,
      remaining: formatRemaining(x.task.due, now, x.zone),
    });
  });

  // 활주로 — 실제 시간 눈금. 마감선을 향해 연속적으로 하강합니다.
  runway.forEach((x) => {
    const frac = Math.max(0, Math.min(1, x.h / L.runwayHours));
    placed.push({
      task: x.task,
      visual: x.visual,
      zone: x.zone,
      y: deadlineY + L.floor + frac * runwayTravel,
      remaining: formatRemaining(x.task.due, now, x.zone),
    });
  });

  // 대기 — 균등 간격. 순서와 개수만 전달합니다.
  visibleQueue.forEach((x, i) => {
    placed.push({
      task: x.task,
      visual: x.visual,
      zone: x.zone,
      y: boundaryY + 10 + i * L.queueGap,
      remaining: formatRemaining(x.task.due, now, x.zone),
    });
  });

  const ticks = [0.25, 0.5, 0.75].map((f) => {
    const h = L.runwayHours * f;
    return {
      label: `${Math.round(h)}h`,
      y: deadlineY + L.floor + (h / L.runwayHours) * runwayTravel + L.cardHeight / 2,
    };
  });

  return { height, deadlineY, boundaryY, placed, hiddenQueue, ticks };
}
