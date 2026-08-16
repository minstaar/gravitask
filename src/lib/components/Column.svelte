<script lang="ts">
  import { theme } from '../theme';
  import { computeAxis } from '../layout';
  import type { Category, Task } from '../types';
  import { hoursUntil, type Zone } from '../urgency';
  import TaskCard from './TaskCard.svelte';

  let {
    tasks,
    categories,
    now,
    reducedMotion = false,
    budget,
    zoom = 1,
    perPage = 4,
    onToggle,
  }: {
    tasks: Task[];
    categories: Category[];
    now: number;
    reducedMotion?: boolean;
    /** 한 번에 보여줄 주제 수 */
    perPage?: number;
    /** 기둥이 쓸 수 있는 최대 높이(px). 화면 크기에서 옵니다 */
    budget?: number;
    /** 배율. 끄는 거리를 화면 픽셀에서 CSS 픽셀로 되돌리는 데 씁니다 */
    zoom?: number;
    onToggle: (t: Task) => void;
  } = $props();

  const L = theme.layout;

  /**
   * 주제가 많으면 페이지로 나눕니다.
   *
   * 주제 수만큼 옆으로 자라게 두면 7과목에 1166px까지 벌어집니다. 폭을 붙들려면
   * 레인 수를 붙드는 수밖에 없습니다.
   *
   * 대신 안 보이는 주제의 급한 일까지 같이 숨으면 위젯이 본업을 잃습니다.
   * 그래서 페이지 표시에 점을 찍어, 저쪽에 오늘 마감이나 밀린 일이 있다는
   * 사실만은 넘겨보지 않아도 알 수 있게 합니다.
   */
  const pages = $derived.by(() => {
    const size = Math.max(1, Math.min(perPage, categories.length || 1));
    const out: Category[][] = [];
    for (let i = 0; i < categories.length; i += size) out.push(categories.slice(i, i + size));
    return out.length > 0 ? out : [[]];
  });

  let pageWanted = $state(0);
  const page = $derived(Math.min(pageWanted, pages.length - 1));
  const visible = $derived(pages[page] ?? []);

  /** 그 페이지에 오늘 마감이거나 이미 지난 일이 있는가 */
  const urgentPages = $derived(
    pages.map((group) => {
      const ids = new Set(group.map((c) => c.id));
      return tasks.some(
        (t) =>
          t.completedAt === null &&
          ids.has(t.categoryId) &&
          hoursUntil(t.due, now) <= L.runwayHours
      );
    })
  );

  const axis = $derived(computeAxis(tasks, visible, now, { reducedMotion, budget }));


  /**
   * 레인 폭은 주제가 늘면 줄어듭니다.
   *
   * 선호 폭을 고정해두면 주제 수에 폭이 선형으로 붙어 학기 중 6과목이면
   * 화면 절반을 먹습니다. 상한을 두고 그 안에서 나눠 쓰되, 제목이 거의 남지
   * 않는 하한 아래로는 줄이지 않습니다. 좁아진 제목은 호버로 펼쳐 봅니다.
   */
  const laneW = $derived.by(() => {
    const n = Math.max(1, visible.length);
    const available = L.maxWidth - L.gutter - (n - 1) * L.laneGap;
    return Math.max(L.laneMin, Math.min(L.laneWidth, Math.floor(available / n)));
  });

  const width = $derived(
    L.gutter + visible.length * laneW + Math.max(0, visible.length - 1) * L.laneGap
  );

  /**
   * 구역을 끌어 본 거리.
   *
   * 지남과 대기는 레인마다 따로입니다 — 높이가 순서(몇 번째)를 뜻할 뿐이라
   * 레인끼리 맞춰 둘 이유가 없습니다.
   *
   * 활주로는 하나를 모든 레인이 같이 씁니다. 여기서 높이는 순서가 아니라
   * 실제 시각이라, 레인마다 따로 밀면 "같은 높이 = 같은 시간"이 깨져 이 위젯의
   * 전제가 무너집니다. 같이 밀면 보이는 시간 창이 옮겨질 뿐 비교는 그대로입니다.
   */
  const RUNWAY = 'runway';
  let pan = $state<Record<string, number>>({});

  const keyOf = (laneId: string, zone: Zone) => (zone === 'runway' ? RUNWAY : `${laneId}|${zone}`);

  const viewportOf = (zone: Zone) =>
    zone === 'overdue' ? axis.overdueHeight : zone === 'runway' ? axis.runwayHeight : axis.queueHeight;

  const contentOf = (laneIndex: number, zone: Zone) =>
    zone === 'overdue'
      ? axis.lanes[laneIndex].content.overdue
      : zone === 'runway'
        ? axis.runwayContent
        : axis.lanes[laneIndex].content.queue;

  const rangeOf = (laneIndex: number, zone: Zone) =>
    Math.max(0, contentOf(laneIndex, zone) - viewportOf(zone));

  const panOf = (laneId: string, laneIndex: number, zone: Zone) =>
    Math.min(pan[keyOf(laneId, zone)] ?? 0, rangeOf(laneIndex, zone));

  /**
   * 할 일이 줄면 끌 수 있는 범위도 줄어듭니다. 그대로 두면 빈 곳을 보고 있게
   * 되므로 범위 안으로 되돌립니다.
   */
  $effect(() => {
    const next: Record<string, number> = {};
    let changed = false;
    for (const [k, v] of Object.entries(pan)) {
      let limit = 0;
      if (k === RUNWAY) limit = Math.max(0, axis.runwayContent - axis.runwayHeight);
      else {
        const [laneId, zone] = k.split('|') as [string, Zone];
        const i = visible.findIndex((c) => c.id === laneId);
        if (i < 0) {
          // 다른 페이지의 주제는 지금 잴 수 없습니다. 버리지 않고 그대로 둡니다 —
          // 페이지를 돌아왔을 때 밀어둔 자리가 남아 있어야 합니다.
          next[k] = v;
          continue;
        }
        limit = rangeOf(i, zone);
      }
      const clamped = Math.min(v, limit);
      if (clamped > 0) next[k] = clamped;
      if (clamped !== v) changed = true;
    }
    if (changed) pan = next;
  });

  /** 활주로는 offset이 하나뿐이라 가장자리 그늘도 레인마다가 아니라 한 번만 그립니다 */
  const runwayRange = $derived(Math.max(0, axis.runwayContent - axis.runwayHeight));
  const runwayPan = $derived(Math.min(pan[RUNWAY] ?? 0, runwayRange));

  /* ---------- 끌기 ---------- */

  let dragging = $state<string | null>(null);

  /**
   * 4px은 움직여야 끄는 것으로 봅니다.
   *
   * 카드마다 완료 버튼이 있어서, 누르는 손이 조금 흔들렸다고 화면이 밀리면
   * 체크가 불안해집니다. 반대로 정말 끌었다면 그 끝의 클릭은 삼켜야 합니다 —
   * 손을 떼는 위치에 있던 카드가 완료되면 그게 더 나쁩니다.
   */
  const DRAG_THRESHOLD = 4;

  function startPan(e: PointerEvent, laneId: string, laneIndex: number, zone: Zone) {
    if (e.button !== 0) return;
    const limit = rangeOf(laneIndex, zone);
    if (limit <= 0) return;

    const key = keyOf(laneId, zone);
    const startY = e.clientY;
    const startPan = pan[key] ?? 0;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      // clientY는 배율이 곱해진 화면 픽셀인데 pan은 배율 안쪽의 CSS 픽셀입니다
      const delta = (ev.clientY - startY) / (zoom || 1);
      if (!moved && Math.abs(delta) < DRAG_THRESHOLD) return;
      moved = true;
      dragging = key;
      pan = { ...pan, [key]: Math.max(0, Math.min(limit, startPan + delta)) };
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      dragging = null;
      if (moved) {
        window.addEventListener('click', (ev) => ev.stopPropagation(), {
          capture: true,
          once: true,
        });
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function wheelPan(e: WheelEvent, laneId: string, laneIndex: number, zone: Zone) {
    if (e.ctrlKey || e.metaKey) return; // 배율 조작이라 여기서 가로채면 안 됩니다
    const limit = rangeOf(laneIndex, zone);
    if (limit <= 0) return;
    e.preventDefault();
    const key = keyOf(laneId, zone);
    pan = { ...pan, [key]: Math.max(0, Math.min(limit, (pan[key] ?? 0) - e.deltaY)) };
  }

  /* ---------- 눈금 ---------- */

  /**
   * 눈금은 활주로를 끈 만큼 같이 움직입니다.
   *
   * 눈금이 제자리에 남으면 카드와 어긋나 거짓말을 하게 됩니다. 창 밖으로 나간
   * 눈금은 그리지 않습니다.
   */
  const ticks = $derived.by(() => {
    if (axis.runwayContent <= L.runwayCollapsed) return [];
    const offset = pan[RUNWAY] ?? 0;
    return L.runwayTicks
      .map((f) => {
        const h = L.runwayHours * f;
        const local = axis.runwayFloor + f * axis.runwayTravel + L.cardHeight / 2 - offset;
        return { label: `${Math.round(h)}h`, y: axis.deadlineY + local, local };
      })
      .filter((t) => t.local > 6 && t.local < axis.runwayHeight - 6);
  });

  const zones: Zone[] = ['overdue', 'runway', 'queue'];
  const bottomOf = (zone: Zone) =>
    zone === 'overdue' ? 0 : zone === 'runway' ? axis.deadlineY : axis.boundaryY;
</script>

<!--
  시간축 하나를 모든 주제가 공유하고, 주제마다 레인을 하나씩 가집니다.

  뼈대(마감선·경계선·활주로 띠·눈금)는 한 번만 그립니다. 주제마다 축을 통째로
  복제하면 공간이 주제 수에 비례해 늘고, 축이 다르면 높이의 의미도 달라져
  주제를 가로지르는 비교가 불가능해집니다.
-->
<section
  class="widget"
  style:--surface={theme.surface.background}
  style:--surface-border={theme.surface.border}
  style:--text={theme.surface.text}
  style:--text-muted={theme.surface.textMuted}
  style:--axis={theme.surface.axis}
  style:--boundary={theme.surface.boundary}
  style:--deadline={theme.surface.deadline}
  style:--fs-title="{theme.type.title}px"
  style:--fs-due="{theme.type.due}px"
  style:--fs-meta="{theme.type.meta}px"
  style:--fs-axis="{theme.type.axis}px"
  style:--gutter="{L.gutter}px"
  style:--lane-w="{laneW}px"
  style:--lane-gap="{L.laneGap}px"
  style:--content-w="{width}px"
>
  <!--
    쪽 번호를 직접 누릅니다. 화살표로 한 칸씩 넘기게 하면 3쪽으로 가는 데 두 번
    눌러야 하고, 무엇보다 과녁이 너무 작습니다.
  -->
  {#if pages.length > 1}
    <div class="pager" style:width="{width}px">
      {#each pages as group, i (i)}
        <button
          class="page"
          class:on={i === page}
          class:urgent={urgentPages[i] && i !== page}
          aria-current={i === page ? 'page' : undefined}
          title={group.map((c) => c.name).join(', ')}
          onclick={() => (pageWanted = i)}
        >
          {i + 1}
        </button>
      {/each}
    </div>
  {/if}

  <header style:padding-left="{L.gutter}px">
    {#each axis.lanes as lane (lane.category.id)}
      <span class="lane-name">
        {lane.category.name}
        {#if lane.upcoming > 0}<em title="남은 할 일">{lane.upcoming}</em>{/if}
      </span>
    {/each}
  </header>

  <div class="column" style:height="{axis.height}px">
    <!-- 활주로 바닥 틴트. 비어 있어도 남겨둡니다 — 빈 활주로는 "오늘은 급한 게 없다"는 정보입니다 -->
    <div class="runway" style:bottom="{axis.deadlineY}px" style:height="{axis.runwayHeight}px"></div>
    <div class="axis-line"></div>

    <!--
      축 표기는 전부 왼쪽 여백에 모읍니다.
      12h 눈금과 DUE·24H는 다 같은 종류 — 높이가 무슨 시각인지 말하는 값입니다.
      한데 모으면 왼쪽은 축, 오른쪽은 내용으로 갈려서 읽기 쉽고, 라벨이 카드와
      겹칠 일도 사라집니다.
    -->
    {#each ticks as tick (tick.label)}
      <span class="tick" style:bottom="{tick.y}px">{tick.label}</span>
    {/each}

    <!-- 시간 단위는 소문자로 통일합니다. DUE만 대문자인데, 그건 단위가 아니라 단어입니다 -->
    <span class="tick edge" style:bottom="{axis.boundaryY}px">{L.runwayHours}h</span>
    <span class="tick edge due" style:bottom="{axis.deadlineY}px">DUE</span>

    <div class="boundary" style:bottom="{axis.boundaryY}px"></div>

    <!-- 레인. 뼈대를 공유하므로 같은 높이는 모든 레인에서 같은 뜻입니다 -->
    <div class="lanes">
      {#each axis.lanes as lane, li (lane.category.id)}
        <div class="lane">
          {#each zones as zone (zone)}
            {@const range = rangeOf(li, zone)}
            {@const offset = panOf(lane.category.id, li, zone)}
            {@const height = viewportOf(zone)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="zone"
              class:pannable={range > 0}
              class:dragging={dragging === keyOf(lane.category.id, zone)}
              style:bottom="{bottomOf(zone)}px"
              style:height="{height}px"
              onpointerdown={(e) => startPan(e, lane.category.id, li, zone)}
              onwheel={(e) => wheelPan(e, lane.category.id, li, zone)}
            >
              <div class="zone-content" style:transform="translateY({offset}px)">
                {#each lane.placed.filter((p) => p.zone === zone) as p (p.task.id)}
                  <TaskCard
                    task={p.task}
                    visual={p.visual}
                    targetY={p.y}
                    remaining={p.remaining}
                    {reducedMotion}
                    {onToggle}
                  />
                {/each}
              </div>

              <!-- 가장자리 그늘. 스크롤바 없이 "더 있다"를 알리는 유일한 신호입니다.
                   활주로는 offset을 모든 레인이 공유하므로 여기서 그리지 않습니다 —
                   레인마다 그리면 레인 폭만큼 끊긴 띠가 7개 생기고, 그 사이 틈이
                   주제를 가르는 선처럼 보입니다. -->
              {#if zone !== 'runway'}
                {#if offset > 0.5}<div class="fade down"></div>{/if}
                {#if offset < range - 0.5}<div class="fade up"></div>{/if}
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    </div>

    <!-- 활주로의 가장자리 그늘. 레인을 가로질러 한 번만 그립니다 -->
    {#if runwayPan > 0.5}
      <div class="fade down wide" style:bottom="{axis.deadlineY}px"></div>
    {/if}
    {#if runwayPan < runwayRange - 0.5}
      <div class="fade up wide" style:bottom="{axis.boundaryY - 16}px"></div>
    {/if}

    <!-- 마감선. 지난 항목이 있으면 그 위로 올라갑니다 -->
    <div class="deadline" style:bottom="{axis.deadlineY}px"></div>
  </div>
</section>

<style>
  /**
   * 표면은 어두운 스크림입니다. 투명 창에서는 backdrop-filter가 흐릴 대상이
   * 없으므로(창 뒤 바탕화면은 페이지 밖입니다) 블러에 가독성을 기대면 안 됩니다.
   * 흰 배경화면 위 최악의 경우에도 본문 6.6:1, 보조 텍스트 4.6:1이 나옵니다.
   */
  /* 폭은 내용(header·column)에만 주고 바깥은 감쌉니다. .widget에 직접 주면
     border-box라 패딩과 테두리가 그 안에 포함돼 레인이 삐져나갑니다. */
  .widget {
    border-radius: 14px;
    padding: 12px 14px 12px;
    background: var(--surface);
    border: 1px solid var(--surface-border);
    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.36);
    color: var(--text);
    flex: none;
    width: max-content;
  }

  header {
    display: flex;
    gap: var(--lane-gap);
    margin-bottom: 10px;
    width: var(--content-w);
  }

  .pager {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    margin-bottom: 8px;
  }

  .page {
    position: relative;
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: var(--fs-meta);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    color: var(--text-muted);
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 6px;
    min-width: 26px;
    height: 26px;
    padding: 0 5px;
    cursor: pointer;
  }

  .page:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.14);
  }

  .page.on {
    color: var(--text);
    background: rgba(90, 80, 190, 0.32);
    border-color: rgba(160, 150, 255, 0.5);
    cursor: default;
  }

  /**
   * 안 보이는 쪽에 오늘 마감이나 밀린 일이 있으면 번호 위에 불이 들어옵니다.
   *
   * 이게 없으면 페이지를 나눈 대가로 위젯이 본업을 잃습니다 — 흘끗 보고 아는
   * 물건인데 절반이 숨어 버리니까요. 무엇이 급한지까지는 말하지 않습니다.
   * 넘겨볼 이유가 있다는 것만 알리면 충분합니다.
   */
  .page.urgent::after {
    content: '';
    position: absolute;
    top: -2px;
    right: -2px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--deadline);
    box-shadow: 0 0 5px var(--deadline);
  }

  /* 주제에는 색을 쓰지 않습니다. 카드가 이미 긴급도 색을 쓰고 있어서
     색 체계가 둘이 되면 서로 부조화하고 신호가 흐려집니다. */
  .lane-name {
    width: var(--lane-w);
    flex: none;
    font-size: var(--fs-meta);
    font-weight: 650;
    letter-spacing: 0.02em;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .lane-name em {
    font-style: normal;
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: var(--fs-axis);
    color: var(--text-muted);
    margin-left: 5px;
  }

  .column {
    position: relative;
    width: var(--content-w);
    transition: height 0.25s ease;
  }

  .lanes {
    position: absolute;
    inset: 0;
    left: var(--gutter);
    display: flex;
    gap: var(--lane-gap);
  }

  .lane {
    position: relative;
    width: var(--lane-w);
    flex: none;
  }

  /**
   * 구역은 저마다 창입니다. 안의 카드가 창보다 높으면 끌어서 봅니다.
   *
   * overflow:hidden 대신 clip-path를 쓰는 이유는 가로는 열어 두어야 하기
   * 때문입니다. 좁은 레인에서 잘린 제목을 호버로 펼쳐 보는 기능이 있는데,
   * overflow:hidden은 세로만 자를 방법이 없어 그 펼침까지 같이 잘라 버립니다.
   */
  .zone {
    position: absolute;
    left: 0;
    right: 0;
    clip-path: inset(0 -420px 0 0);
  }

  .zone.pannable {
    cursor: grab;
    touch-action: none;
  }

  .zone.dragging {
    cursor: grabbing;
  }

  .zone-content {
    position: absolute;
    inset: 0;
  }

  /* 스크롤바를 두지 않기로 했으므로 "더 있다"는 이 그늘로만 전해집니다.
     너무 옅으면 아무 말도 못 하고, 진하면 카드를 가립니다. */
  .fade {
    position: absolute;
    left: 0;
    right: 0;
    height: 16px;
    pointer-events: none;
    z-index: 5;
  }

  .fade.up {
    top: 0;
    background: linear-gradient(to bottom, rgba(10, 11, 16, 0.75), transparent);
  }

  .fade.down {
    bottom: 0;
    background: linear-gradient(to top, rgba(10, 11, 16, 0.75), transparent);
  }

  /* 활주로용. 레인을 가로질러 한 줄로 이어져야 주제 사이 틈이 선처럼 보이지 않습니다 */
  .fade.wide {
    left: var(--gutter);
    right: 0;
    top: auto;
  }

  .runway {
    position: absolute;
    left: var(--gutter);
    right: 0;
    background: linear-gradient(to top, rgba(196, 43, 74, 0.1), rgba(196, 43, 74, 0.015));
  }

  .axis-line {
    position: absolute;
    left: var(--gutter);
    top: 0;
    bottom: 0;
    width: 1px;
    background: linear-gradient(to top, var(--axis), transparent);
    margin-left: -10px;
  }

  .tick {
    position: absolute;
    left: 0;
    width: calc(var(--gutter) - 16px);
    text-align: right;
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: var(--fs-axis);
    color: var(--axis);
    transform: translateY(50%);
  }

  /**
   * DUE와 24H도 눈금입니다.
   *
   * 예전에는 오른쪽 끝에 붙어 있어서 맨 오른쪽 레인의 카드와 자리를 다퉜습니다.
   * 라벨을 옮기고 카드를 밀어내는 짓을 번갈아 하다가, 애초에 자리가 잘못이었다는
   * 걸 알았습니다 — 이 값들이 말하는 건 '높이가 무슨 시각인가'이고, 그건 왼쪽
   * 여백이 하는 일입니다. 옮기고 나니 겹칠 일 자체가 사라져서, 카드를 밀어내려고
   * 벌려 두었던 queueTop도 원래대로 돌렸습니다.
   */
  .tick.edge {
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }

  .tick.due {
    color: var(--deadline);
  }

  /**
   * 경계선은 카드 위에 그립니다.
   *
   * 대기 구역 첫 카드가 이 선에 딱 붙어 있어서(queueTop = 0), 카드를 나중에
   * 그리면 카드가 점선을 덮어 레인 폭만큼 선이 끊깁니다. 선을 위로 올리면
   * 붙는 것과 선이 이어지는 것을 둘 다 얻습니다. 마감선도 같은 이유로
   * z-index를 씁니다.
   */
  .boundary {
    position: absolute;
    left: calc(var(--gutter) - 10px);
    right: 0;
    border-top: 1px dashed var(--boundary);
    z-index: 6;
  }

  .deadline {
    position: absolute;
    left: calc(var(--gutter) - 10px);
    right: 0;
    height: 1px;
    background: linear-gradient(90deg, var(--deadline), transparent);
    z-index: 6;
  }
</style>
