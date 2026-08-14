import { theme, type Theme } from './theme';
import { formatRemaining, hoursUntil, visualFor, type Visual, type Zone } from './urgency';
import type { Category, Task } from './types';

/**
 * 시간축 하나를 모든 주제가 공유하고, 주제마다 레인을 하나씩 가집니다.
 *
 * 뼈대(마감선·24H 경계선·활주로 띠·눈금)는 한 번만 그립니다. 주제마다 축을
 * 통째로 복제하면 주제 수에 비례해 공간을 먹는 데다, 축이 다르면 높이의 의미도
 * 달라져서 주제를 가로지르는 비교가 불가능해집니다.
 *
 * 구역 높이는 전체 기준으로 계산합니다. 그래야 모든 레인이 같은 마감선과 같은
 * 경계선을 쓰고, 활주로에서 "같은 높이 = 같은 시간"이 성립합니다.
 *
 * 대기 구역은 레인마다 자기 순번으로 쌓습니다. 아직 급하지 않은 것들이라
 * 주제를 가로지르는 정밀 비교가 필요 없고, 정확한 값은 카드의 "N일 남음"이
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

/**
 * 겹치는 카드를 최소 간격만큼 벌립니다.
 *
 * ys는 아래에서 위로 정렬돼 있어야 합니다(마감이 이른 순). 아래에서부터 위로
 * 밀어 올린 뒤, 천장을 넘으면 위에서 아래로 되밀어 구역 안에 가둡니다.
 * 시간 위치를 그대로 두면 정확하지만 읽을 수 없고, 균등 간격으로 바꾸면
 * 읽히지만 시간 정보를 잃습니다. 겹치는 만큼만 건드리는 것이 절충입니다.
 */
function spreadApart(ys: number[], gap: number, lo: number, hi: number): number[] {
  const out = ys.slice();

  for (let i = 1; i < out.length; i++) {
    out[i] = Math.max(out[i], out[i - 1] + gap);
  }

  // 위로 밀다 천장을 넘었으면 전체를 아래로 되밉니다.
  if (out.length > 0 && out[out.length - 1] > hi) {
    for (let i = out.length - 1; i >= 0; i--) {
      const ceiling = i === out.length - 1 ? hi : out[i + 1] - gap;
      out[i] = Math.min(out[i], ceiling);
    }
    // 되밀다 바닥을 뚫으면 어쩔 수 없이 균등 간격으로 눌러 담습니다.
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.max(out[i], lo + i * Math.min(gap, (hi - lo) / Math.max(1, out.length - 1)));
    }
  }

  return out;
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

  /**
   * 활주로는 붐비면 늘어납니다.
   *
   * 활주로 안에서 카드는 실제 시간 위치에 놓이므로, 비슷한 시각에 마감이
   * 몰리면 서로 겹칩니다. 고정 높이를 유지한 채 밀어내면 시간 위치가 크게
   * 왜곡되므로, 먼저 구역을 키워 자리를 만들고 남은 겹침만 밀어냅니다.
   */
  const maxRunway = Math.max(0, ...splits.map((s) => s.runway.length));
  const spacing = L.cardHeight + L.minCardGap;
  const neededRunway =
    maxRunway > 0 ? (maxRunway - 1) * spacing + L.cardHeight + L.floor * 2 : 0;
  const runwayHeight = anyRunway
    ? Math.max(L.runwayHeight, neededRunway)
    : L.runwayCollapsed;

  const deadlineY = overdueHeight;
  const boundaryY = deadlineY + runwayHeight;
  const queueHeight = Math.max(L.minQueueHeight, maxQueue * L.queueGap + 10);
  const height = boundaryY + queueHeight;

  const runwayFloor = deadlineY + L.floor;
  const runwayTravel = runwayHeight - L.cardHeight - L.floor * 2;
  const runwayCeil = runwayFloor + runwayTravel;

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
    // 이상적인 위치를 먼저 구하고, 겹치는 만큼만 밀어냅니다.
    const ideal = s.runway.map((x) => {
      const frac = Math.max(0, Math.min(1, x.h / L.runwayHours));
      return runwayFloor + frac * runwayTravel;
    });
    const resolved = spreadApart(ideal, spacing, runwayFloor, runwayCeil);

    s.runway.forEach((x, i) => {
      placed.push({
        task: x.task,
        visual: x.visual,
        zone: x.zone,
        y: resolved[i],
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
