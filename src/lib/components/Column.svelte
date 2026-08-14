<script lang="ts">
  import { theme, boundaryY } from '../theme';
  import {
    formatRemaining,
    hoursUntil,
    overdueY,
    queueY,
    runwayY,
    visualFor,
    withAlpha,
    type Visual,
  } from '../urgency';
  import type { Category, Task } from '../types';
  import TaskCard from './TaskCard.svelte';

  let {
    category,
    tasks,
    now,
    reducedMotion = false,
    onToggle,
    onRemove,
  }: {
    category: Category;
    tasks: Task[];
    now: number;
    reducedMotion?: boolean;
    onToggle: (t: Task) => void;
    onRemove: (id: string) => void;
  } = $props();

  const BOUND = boundaryY();

  interface Placed {
    task: Task;
    visual: Visual;
    y: number;
    remaining: string;
  }

  /**
   * 2구역 배치.
   * 위(대기)는 균등 간격 — 순서와 개수만 전달합니다.
   * 아래(활주로)는 실제 시간 눈금 — 마감선을 향해 연속적으로 하강합니다.
   */
  const placed = $derived.by((): { visible: Placed[]; hiddenQueue: number } => {
    const live = tasks
      .filter((t) => t.completedAt === null)
      .sort((a, b) => a.due - b.due);

    const nowDate = new Date(now);
    const out: Placed[] = [];
    let qi = 0;
    let oi = 0;
    let hiddenQueue = 0;

    for (const task of live) {
      const h = hoursUntil(task.due, now);
      const visual = visualFor(h, nowDate, { reducedMotion });
      let y: number;

      if (visual.zone === 'overdue') {
        y = overdueY(oi++);
      } else if (visual.zone === 'runway') {
        y = runwayY(h);
      } else {
        if (qi >= theme.layout.maxQueueVisible) {
          hiddenQueue++;
          continue;
        }
        y = queueY(qi++);
      }

      out.push({ task, visual, y, remaining: formatRemaining(task.due, now, visual.zone) });
    }

    return { visible: out, hiddenQueue };
  });

  // 활주로 눈금. runwayHours가 바뀌면 라벨도 따라갑니다.
  const ticks = $derived(
    [0.25, 0.5, 0.75].map((f) => {
      const h = theme.layout.runwayHours * f;
      return { label: `${Math.round(h)}h`, y: runwayY(h) + theme.layout.cardHeight / 2 };
    })
  );

  const accent = $derived(`hsl(${category.hue} 55% 62%)`);
</script>

<section
  class="widget"
  style:--accent={accent}
  style:--surface={theme.surface.background}
  style:--surface-border={theme.surface.border}
  style:--blur="{theme.surface.blur}px"
  style:--text={theme.surface.text}
  style:--text-muted={theme.surface.textMuted}
  style:--axis={theme.surface.axis}
  style:--boundary={theme.surface.boundary}
  style:--deadline={theme.surface.deadline}
>
  <header>
    <span class="name">{category.name}</span>
    <span class="count">{placed.visible.length + placed.hiddenQueue} items</span>
  </header>

  <div class="column" style:height="{theme.layout.columnHeight}px">
    <!-- 활주로 바닥 틴트. 비어 있어도 남겨둡니다 — 빈 활주로는 "오늘은 급한 게 없다"는 정보입니다 -->
    <div class="runway" style:height="{BOUND}px"></div>
    <div class="axis"></div>

    {#each ticks as tick (tick.label)}
      <span class="tick" style:bottom="{tick.y}px">{tick.label}</span>
    {/each}

    <div class="boundary" style:bottom="{BOUND}px">
      <span>{theme.layout.runwayHours}H</span>
    </div>

    {#if placed.hiddenQueue > 0}
      <span class="more">외 {placed.hiddenQueue}건</span>
    {/if}

    <span class="zonetag" style:bottom="{theme.layout.columnHeight - 11}px">대기</span>
    <span class="zonetag" style:bottom="{BOUND - 14}px">임박</span>

    {#each placed.visible as p (p.task.id)}
      <TaskCard
        task={p.task}
        visual={p.visual}
        targetY={p.y}
        remaining={p.remaining}
        {reducedMotion}
        {onToggle}
        {onRemove}
      />
    {/each}

    <div class="deadline"><span>DUE</span></div>

    {#if placed.visible.length === 0}
      <p class="empty">비어 있음</p>
    {/if}
  </div>
</section>

<style>
  /**
   * 표면은 어두운 스크림입니다. 투명 창에서는 backdrop-filter가 흐릴 대상이
   * 없으므로(창 뒤 바탕화면은 페이지 밖입니다) 블러에 가독성을 기대면 안 됩니다.
   * 실제 흐림은 OS의 acrylic이 처리하고, 글자 대비는 이 스크림이 책임집니다.
   * 흰 배경화면 위 최악의 경우에도 본문 6.6:1, 보조 텍스트 4.6:1이 나옵니다.
   */
  .widget {
    border-radius: 14px;
    padding: 14px 14px 12px;
    background: var(--surface);
    border: 1px solid var(--surface-border);
    backdrop-filter: blur(var(--blur)) saturate(1.3);
    -webkit-backdrop-filter: blur(var(--blur)) saturate(1.3);
    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.36);
    color: var(--text);
    width: 268px;
    flex: none;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .name {
    font-size: 12.5px;
    font-weight: 650;
    letter-spacing: 0.02em;
    /* 범주는 hue로만 구분합니다 — 긴급도의 채도·명도와 충돌하지 않게 */
    color: var(--accent);
  }

  .count {
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: 10px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .column {
    position: relative;
  }

  .runway {
    position: absolute;
    left: 44px;
    right: 0;
    bottom: 0;
    background: linear-gradient(to top, rgba(196, 43, 74, 0.1), rgba(196, 43, 74, 0.015));
    border-radius: 0 0 6px 6px;
  }

  .axis {
    position: absolute;
    left: 44px;
    top: 0;
    bottom: 0;
    width: 1px;
    background: linear-gradient(to top, var(--axis), transparent);
  }

  .tick {
    position: absolute;
    left: 0;
    width: 40px;
    text-align: right;
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: 9px;
    color: var(--axis);
    transform: translateY(50%);
  }

  .boundary {
    position: absolute;
    left: 44px;
    right: 0;
    border-top: 1px dashed var(--boundary);
  }

  .boundary span {
    position: absolute;
    right: 0;
    top: -15px;
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: 9px;
    color: var(--text-muted);
    letter-spacing: 0.1em;
  }

  .zonetag {
    position: absolute;
    left: 52px;
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: 8.5px;
    letter-spacing: 0.16em;
    color: var(--text-muted);
    opacity: 0.45;
  }

  .more {
    position: absolute;
    right: 2px;
    top: -2px;
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: 9px;
    color: var(--text-muted);
  }

  .deadline {
    position: absolute;
    left: 44px;
    right: 0;
    bottom: 0;
    height: 1px;
    background: linear-gradient(90deg, var(--deadline), transparent);
  }

  .deadline span {
    position: absolute;
    right: 0;
    bottom: 3px;
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: 9px;
    color: var(--deadline);
    letter-spacing: 0.08em;
  }

  .empty {
    position: absolute;
    left: 54px;
    bottom: 50%;
    margin: 0;
    font-size: 11.5px;
    color: var(--text-muted);
    opacity: 0.6;
  }
</style>
