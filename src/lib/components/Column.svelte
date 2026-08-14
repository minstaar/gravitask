<script lang="ts">
  import { theme } from '../theme';
  import { computeAxis } from '../layout';
  import type { Category, Task } from '../types';
  import TaskCard from './TaskCard.svelte';

  let {
    tasks,
    categories,
    now,
    reducedMotion = false,
    onToggle,
  }: {
    tasks: Task[];
    categories: Category[];
    now: number;
    reducedMotion?: boolean;
    onToggle: (t: Task) => void;
  } = $props();

  const axis = $derived(computeAxis(tasks, categories, now, { reducedMotion }));
  const L = theme.layout;

  /**
   * 레인 폭은 주제가 늘면 줄어듭니다.
   *
   * 선호 폭을 고정해두면 주제 수에 폭이 선형으로 붙어 학기 중 6과목이면
   * 화면 절반을 먹습니다. 상한을 두고 그 안에서 나눠 쓰되, 제목이 거의 남지
   * 않는 하한 아래로는 줄이지 않습니다. 좁아진 제목은 호버로 펼쳐 봅니다.
   */
  const laneW = $derived.by(() => {
    const n = Math.max(1, categories.length);
    const available = L.maxWidth - L.gutter - (n - 1) * L.laneGap;
    return Math.max(L.laneMin, Math.min(L.laneWidth, Math.floor(available / n)));
  });

  const width = $derived(
    L.gutter + categories.length * laneW + Math.max(0, categories.length - 1) * L.laneGap
  );
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
  <header style:padding-left="{L.gutter}px">
    {#each axis.lanes as lane (lane.category.id)}
      <span class="lane-name">
        {lane.category.name}
        {#if lane.hiddenQueue > 0}<em>외 {lane.hiddenQueue}</em>{/if}
      </span>
    {/each}
  </header>

  <div class="column" style:height="{axis.height}px">
    <!-- 활주로 바닥 틴트. 비어 있어도 남겨둡니다 — 빈 활주로는 "오늘은 급한 게 없다"는 정보입니다 -->
    <div class="runway" style:bottom="{axis.deadlineY}px" style:height="{axis.runwayHeight}px"></div>
    <div class="axis-line"></div>

    {#each axis.ticks as tick (tick.label)}
      <span class="tick" style:bottom="{tick.y}px">{tick.label}</span>
    {/each}

    <div class="boundary" style:bottom="{axis.boundaryY}px">
      <span>{L.runwayHours}H</span>
    </div>

    <!-- 레인. 뼈대를 공유하므로 같은 높이는 모든 레인에서 같은 뜻입니다 -->
    <div class="lanes">
      {#each axis.lanes as lane (lane.category.id)}
        <div class="lane">
          {#each lane.placed as p (p.task.id)}
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
      {/each}
    </div>

    <!-- 마감선. 지난 항목이 있으면 그 위로 올라갑니다 -->
    <div class="deadline" style:bottom="{axis.deadlineY}px"><span>DUE</span></div>
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

  .boundary {
    position: absolute;
    left: calc(var(--gutter) - 10px);
    right: 0;
    border-top: 1px dashed var(--boundary);
  }

  .boundary span {
    position: absolute;
    right: 0;
    top: -15px;
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: var(--fs-axis);
    color: var(--text-muted);
    letter-spacing: 0.1em;
  }

  .deadline {
    position: absolute;
    left: calc(var(--gutter) - 10px);
    right: 0;
    height: 1px;
    background: linear-gradient(90deg, var(--deadline), transparent);
  }

  .deadline span {
    position: absolute;
    right: 0;
    bottom: 3px;
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: var(--fs-axis);
    color: var(--deadline);
    letter-spacing: 0.08em;
  }
</style>
