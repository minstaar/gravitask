// 확장자를 붙입니다 — 테스트를 번들러 없이 node로 바로 돌립니다 (urgency.ts와 같은 이유)
import { theme, type Theme } from './theme.ts';
import { formatRemaining, hoursUntil, visualFor, type Visual, type Zone } from './urgency.ts';
import type { Category, Task } from './types.ts';

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
 * ---
 *
 * 높이에는 예산이 있습니다.
 *
 * 예전에는 구역마다 '최대 몇 개'를 손으로 정하고 넘치면 "외 N"으로 접었습니다.
 * 두 가지가 틀렸습니다. 첫째, 몇 개가 들어가는지는 화면이 정할 일이지 사람이
 * 미리 맞힐 수 있는 값이 아닙니다. 둘째, 접힌 항목에 닿을 방법이 없었습니다.
 *
 * 그래서 이제 구역마다 두 개의 높이를 계산합니다 — 눈에 보이는 높이(height)와
 * 카드가 실제로 차지하는 높이(content)입니다. content가 height보다 크면 그
 * 구역은 끌어서 볼 수 있고, 접히는 것은 없습니다.
 */

export interface Placed {
  task: Task;
  visual: Visual;
  /** 구역 안에서의 위치. 구역 바닥이 0이고 위로 갈수록 커집니다 */
  y: number;
  remaining: string;
  zone: Zone;
}

export interface Lane {
  category: Category;
  placed: Placed[];
  /**
   * 구역별 카드 총 높이. 구역의 보이는 높이보다 크면 그만큼 끌 수 있습니다.
   * 지남과 대기는 레인마다 다르므로 여기에 둡니다.
   */
  content: { overdue: number; queue: number };
  /**
   * 아직 마감이 지나지 않은 할 일 수 (활주로 + 대기).
   *
   * 레인 머리에 이 수를 답니다. 예전에는 '지금 안 보이는 개수'를 "외 N"으로
   * 적었는데, 구역을 끌 때마다 숫자가 바뀌어서 무엇을 세는 값인지 읽히지
   * 않았습니다. 남은 할 일 수는 끌어도 변하지 않고, 흘끗 볼 때 알고 싶은
   * 것도 그쪽입니다. 지남은 빼고 셉니다 — 이미 놓친 것은 '남은 일'이 아니고,
   * 그건 마감선 아래 색과 사선이 따로 말해 줍니다.
   */
  upcoming: number;
}

export interface AxisLayout {
  /** 기둥 전체 높이(px). 모든 레인이 공유합니다 */
  height: number;
  /** 마감선의 바닥 기준 높이 */
  deadlineY: number;
  /** 24시간 경계선의 바닥 기준 높이 */
  boundaryY: number;
  /** 구역별로 보이는 높이 */
  overdueHeight: number;
  runwayHeight: number;
  queueHeight: number;
  /**
   * 활주로가 카드를 놓는 데 실제로 쓴 높이.
   *
   * 활주로는 눈금이라서 레인마다 다를 수 없습니다 — 모든 레인이 같은 시간
   * 좌표를 써야 같은 높이가 같은 시각을 뜻합니다. 그래서 지남·대기와 달리
   * Lane이 아니라 여기 있습니다.
   */
  runwayContent: number;
  /** 활주로 안에서 시간이 실제로 흐르는 구간 (바닥 여백을 뺀 부분) */
  runwayTravel: number;
  /** 활주로 바닥에서 시간 0인 지점까지의 여백 */
  runwayFloor: number;
  lanes: Lane[];
}

interface Prepared {
  task: Task;
  h: number;
  visual: Visual;
  zone: Zone;
}

interface Split {
  overdue: Prepared[];
  runway: Prepared[];
  queue: Prepared[];
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

/**
 * 예산을 구역들에 나눠 줍니다.
 *
 * 필요한 만큼 다 주고도 남으면 그대로 줍니다. 모자라면 먼저 각자의 최소치를
 * 보장하고, 남은 것을 고르게 나눕니다. 덜 필요한 구역이 남긴 몫은 나머지가
 * 다시 나눠 갖습니다.
 *
 * 급한 순서로 몰아주지 않습니다. 그렇게 하면 오늘 마감이 스무 개인 날 활주로가
 * 예산을 다 먹고 지남과 대기가 통째로 사라지는데, 하필 그런 날 정작 봐야 하는
 * 것이 밀린 일입니다. 우선순위는 최소치에만 담아 둡니다 — 활주로의 최소치가
 * 가장 크고, 그래서 한가한 날에도 오늘 할 일은 늘 보입니다.
 */
function allocate(need: number[], floor_: number[], budget: number): number[] {
  const total = need.reduce((a, b) => a + b, 0);
  if (total <= budget) return need.slice();

  const out = floor_.map((f, i) => Math.min(f, need[i]));
  let left = budget - out.reduce((a, b) => a + b, 0);

  // 최소치조차 예산을 넘으면 더 줄일 곳이 없습니다. 그대로 둡니다 —
  // 여기서 더 깎으면 카드 한 장도 못 보여주는 구역이 생깁니다.
  if (left <= 0) return out.map((v) => Math.floor(v));

  const want = need.map((n, i) => Math.max(0, n - out[i]));
  let open = want.map((w, i) => (w > 0 ? i : -1)).filter((i) => i >= 0);

  while (left > 0.5 && open.length > 0) {
    const share = left / open.length;
    const modest = open.filter((i) => want[i] <= share);

    if (modest.length === 0) {
      // 모두가 제 몫 이상을 원합니다 — 똑같이 나누고 끝냅니다
      for (const i of open) out[i] += share;
      break;
    }

    // 적게 원하는 쪽을 먼저 채워 주고, 남은 것을 다음 바퀴에서 다시 나눕니다
    for (const i of modest) {
      out[i] += want[i];
      left -= want[i];
      want[i] = 0;
    }
    open = open.filter((i) => want[i] > 0);
  }

  return out.map((v) => Math.floor(v));
}

/**
 * 한 페이지에 넣을 수 있는 주제 수의 상한.
 *
 * maxWidth를 진짜 상한으로 만드는 값입니다. 예전에는 maxWidth가 있어도
 * laneMin이 이겨서 주제가 늘수록 위젯이 옆으로 자랐습니다 — 7주제에 1166px.
 * 폭을 붙들려면 레인 수를 붙드는 수밖에 없고, 나머지는 페이지를 넘겨 봅니다.
 */
export function maxTopicsPerPage(t: Theme = theme): number {
  const L = t.layout;
  return Math.max(1, Math.floor((L.maxWidth - L.gutter + L.laneGap) / (L.laneMin + L.laneGap)));
}

export function computeAxis(
  tasks: Task[],
  categories: Category[],
  now: number,
  opts: { reducedMotion?: boolean; t?: Theme; budget?: number } = {}
): AxisLayout {
  const t = opts.t ?? theme;
  const L = t.layout;
  const nowDate = new Date(now);
  const spacing = L.cardHeight + L.cardGap;

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

  /** n장을 겹치지 않게 쌓는 데 필요한 높이 */
  const stack = (n: number, pad: number) =>
    n > 0 ? (n - 1) * spacing + L.cardHeight + pad : 0;

  // 카드가 실제로 차지하는 높이. 구역마다 가장 붐비는 레인에 맞춥니다.
  const overdueContent = Math.max(0, ...splits.map((s) => stack(s.overdue.length, L.floor)));
  const queueContent = Math.max(
    0,
    ...splits.map((s) => (s.queue.length > 0 ? stack(s.queue.length, L.floor) + L.queueTop : 0))
  );

  /**
   * 활주로는 위아래로 물러나지 않습니다.
   *
   * 지남과 대기는 순번이라 가장자리 여백이 그냥 여백이지만, 활주로는 진짜
   * 눈금입니다. 여기서 물러나면 마감이 딱 24시간 남은 일이 24H 선에 닿지 않고
   * 마감 순간인 일이 DUE 선에 닿지 않습니다 — 두 선이 무엇을 가리키는지가
   * 흐려집니다. 그래서 h=0이면 카드 바닥이 DUE 선에, h=24면 카드 위쪽이 24H
   * 선에 정확히 붙습니다.
   */
  const RUNWAY_EDGE = 0;

  const anyRunway = splits.some((s) => s.runway.length > 0);
  const maxRunway = Math.max(0, ...splits.map((s) => s.runway.length));
  const runwayContent = anyRunway
    ? Math.max(L.runwayHeight, stack(maxRunway, RUNWAY_EDGE * 2))
    : L.runwayCollapsed;

  /**
   * 예산.
   *
   * 주지 않으면 필요한 만큼 다 씁니다 — 테스트나 화면 크기를 모르는 상황에서
   * 예산을 멋대로 지어내는 것보다, 예산이 없다는 사실을 그대로 두는 편이 낫습니다.
   */
  const budget = Math.max(L.minColumnHeight, opts.budget ?? Number.POSITIVE_INFINITY);

  // 빈 대기 구역은 자리를 붙들지 않습니다. 카드가 한 장이라도 있어야 최소
  // 높이를 주장할 자격이 생깁니다.
  const anyQueue = splits.some((s) => s.queue.length > 0);
  const queueNeed = anyQueue ? Math.max(L.minQueueHeight, queueContent) : L.queueCollapsed;

  const [overdueHeight, runwayHeight, queueHeight] = allocate(
    [overdueContent, runwayContent, queueNeed],
    [
      overdueContent > 0 ? L.cardHeight + L.floor : 0,
      anyRunway ? Math.min(runwayContent, L.runwayHeight) : L.runwayCollapsed,
      anyQueue ? L.minQueueHeight : L.queueCollapsed,
    ],
    budget
  );

  const deadlineY = overdueHeight;
  const boundaryY = deadlineY + runwayHeight;
  const height = boundaryY + queueHeight;

  // 활주로 안에서 시간이 흐르는 구간. 보이는 높이가 아니라 content 기준입니다 —
  // 끌어서 보더라도 같은 높이가 같은 시각이어야 하니까요.
  const runwayTravel = Math.max(0, runwayContent - L.cardHeight - RUNWAY_EDGE * 2);

  const lanes: Lane[] = categories.map((category, ci) => {
    const s = splits[ci];
    const placed: Placed[] = [];

    /**
     * 지남 — 마감선에 매달아 아래로 쌓습니다.
     *
     * 깊이가 '얼마나 오래 밀렸나'를 뜻하려면 기준이 마감선이어야 합니다.
     * 구역 바닥을 기준으로 쌓으면, 구역 높이는 가장 붐비는 레인이 정하므로
     * 같은 항목의 깊이가 옆 레인 사정에 따라 달라집니다 — 52분 전에 놓친 것이
     * 다른 레인에 밀린 일이 많다는 이유로 화면 맨 밑에 가라앉아, 몇 주 밀린
     * 것처럼 읽힙니다.
     *
     * 매다는 지점은 보이는 높이와 카드가 차지하는 높이 중 큰 쪽입니다. 넘칠
     * 때는 카드 더미의 꼭대기가 곧 마감선이고, 모자랄 때는 구역 천장이
     * 마감선입니다. 어느 쪽이든 가장 최근에 놓친 것이 마감선에 붙습니다.
     */
    const overdueStack = stack(s.overdue.length, L.floor);
    const anchor = Math.max(overdueHeight, overdueStack);

    // s.overdue는 마감이 이른 순이라, 뒤로 갈수록 최근에 놓친 항목입니다.
    s.overdue.forEach((x, i) => {
      const fromDeadline = s.overdue.length - 1 - i;
      placed.push({
        task: x.task,
        visual: x.visual,
        zone: x.zone,
        y: anchor - fromDeadline * spacing - L.cardHeight,
        remaining: formatRemaining(x.task.due, now, x.zone),
      });
    });

    // 활주로 — 실제 시간 눈금. 레인이 달라도 같은 높이는 같은 시간입니다.
    // 이상적인 위치를 먼저 구하고, 겹치는 만큼만 밀어냅니다.
    const ideal = s.runway.map((x) => {
      const frac = Math.max(0, Math.min(1, x.h / L.runwayHours));
      return RUNWAY_EDGE + frac * runwayTravel;
    });
    const resolved = spreadApart(ideal, spacing, RUNWAY_EDGE, RUNWAY_EDGE + runwayTravel);

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
    s.queue.forEach((x, i) => {
      placed.push({
        task: x.task,
        visual: x.visual,
        zone: x.zone,
        y: L.queueTop + i * spacing,
        remaining: formatRemaining(x.task.due, now, x.zone),
      });
    });

    return {
      category,
      placed,
      content: {
        overdue: overdueStack,
        queue: s.queue.length > 0 ? stack(s.queue.length, L.floor) + L.queueTop : 0,
      },
      upcoming: s.runway.length + s.queue.length,
    };
  });

  return {
    height,
    deadlineY,
    boundaryY,
    overdueHeight,
    runwayHeight,
    queueHeight,
    runwayContent,
    runwayTravel,
    runwayFloor: RUNWAY_EDGE,
    lanes,
  };
}
