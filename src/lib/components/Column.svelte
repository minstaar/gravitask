<script lang="ts">
  import { theme } from '../theme';
  import { computeLayout } from '../layout';
  import type { Category, Task } from '../types';
  import TaskCard from './TaskCard.svelte';

  let {
    category,
    tasks,
    now,
    reducedMotion = false,
    editing = false,
    canMoveLeft = false,
    canMoveRight = false,
    hues = [],
    onToggle,
    onRename,
    onRecolor,
    onMove,
    onRemove,
  }: {
    category: Category;
    tasks: Task[];
    now: number;
    reducedMotion?: boolean;
    editing?: boolean;
    canMoveLeft?: boolean;
    canMoveRight?: boolean;
    hues?: number[];
    onToggle: (t: Task) => void;
    onRename?: (id: string, name: string) => void;
    onRecolor?: (id: string, hue: number) => void;
    onMove?: (id: string, delta: number) => void;
    onRemove?: (id: string) => void;
  } = $props();

  const layout = $derived(computeLayout(tasks, now, { reducedMotion }));
  const accent = $derived(`hsl(${category.hue} 55% 62%)`);

  // 할 일이 남아 있으면 지울 수 없습니다. 되돌릴 방법이 없는 삭제는 막습니다.
  const isEmpty = $derived(tasks.every((t) => t.completedAt !== null));
</script>

<section
  class="widget"
  style:--accent={accent}
  style:--surface={theme.surface.background}
  style:--surface-border={theme.surface.border}
  style:--text={theme.surface.text}
  style:--text-muted={theme.surface.textMuted}
  style:--axis={theme.surface.axis}
  style:--boundary={theme.surface.boundary}
  style:--deadline={theme.surface.deadline}
  style:--fs-title="{theme.type.title}px"
  style:--fs-category="{theme.type.category}px"
  style:--fs-due="{theme.type.due}px"
  style:--fs-meta="{theme.type.meta}px"
  style:--fs-axis="{theme.type.axis}px"
  style:width="{theme.layout.columnWidth}px"
>
  {#if editing}
    <div class="editor">
      <div class="row">
        <input
          class="rename"
          value={category.name}
          aria-label="범주 이름"
          oninput={(e) => onRename?.(category.id, e.currentTarget.value)}
        />
        <button
          class="danger"
          disabled={!isEmpty}
          title={isEmpty ? '범주 삭제' : '할 일이 남아 있어 지울 수 없습니다'}
          aria-label="범주 삭제"
          onclick={() => onRemove?.(category.id)}>삭제</button
        >
      </div>
      <div class="row">
        <div class="swatches">
          {#each hues as hue (hue)}
            <button
              class="swatch"
              class:on={hue === category.hue}
              style:background="hsl({hue} 55% 62%)"
              aria-label="색 {hue}"
              onclick={() => onRecolor?.(category.id, hue)}
            ></button>
          {/each}
        </div>
        <button
          class="nudge"
          disabled={!canMoveLeft}
          aria-label="왼쪽으로"
          onclick={() => onMove?.(category.id, -1)}>‹</button
        >
        <button
          class="nudge"
          disabled={!canMoveRight}
          aria-label="오른쪽으로"
          onclick={() => onMove?.(category.id, 1)}>›</button
        >
      </div>
    </div>
  {:else}
    <header>
      <span class="name">{category.name}</span>
      <span class="count">{layout.placed.length + layout.hiddenQueue} items</span>
    </header>
  {/if}

  <div class="column" style:height="{layout.height}px">
    <!-- 활주로 바닥 틴트. 비어 있어도 남겨둡니다 — 빈 활주로는 "오늘은 급한 게 없다"는 정보입니다 -->
    <div
      class="runway"
      style:bottom="{layout.deadlineY}px"
      style:height="{layout.runwayHeight}px"
    ></div>
    <div class="axis"></div>

    {#each layout.ticks as tick (tick.label)}
      <span class="tick" style:bottom="{tick.y}px">{tick.label}</span>
    {/each}

    <div class="boundary" style:bottom="{layout.boundaryY}px">
      <span>{theme.layout.runwayHours}H</span>
    </div>

    {#if layout.hiddenQueue > 0}
      <span class="more">외 {layout.hiddenQueue}건</span>
    {/if}

    <!-- 구역 이름표는 두지 않습니다. 경계선·눈금·카드 위치가 이미 구역을
         말해 주고, 라벨은 할 일 제목과 섞여 읽기만 방해합니다. -->
    {#each layout.placed as p (p.task.id)}
      <TaskCard
        task={p.task}
        visual={p.visual}
        targetY={p.y}
        remaining={p.remaining}
        {reducedMotion}
        {onToggle}
      />
    {/each}

    <!-- 마감선. 지난 항목이 있으면 그 위로 올라갑니다 -->
    <div class="deadline" style:bottom="{layout.deadlineY}px"><span>DUE</span></div>

    {#if layout.placed.length === 0}
      <p class="empty">비어 있음</p>
    {/if}
  </div>
</section>

<style>
  /**
   * 표면은 어두운 스크림입니다. 투명 창에서는 backdrop-filter가 흐릴 대상이
   * 없으므로(창 뒤 바탕화면은 페이지 밖입니다) 블러에 가독성을 기대면 안 됩니다.
   * 흰 배경화면 위 최악의 경우에도 본문 6.6:1, 보조 텍스트 4.6:1이 나옵니다.
   */
  .widget {
    border-radius: 14px;
    padding: 14px 14px 12px;
    background: var(--surface);
    border: 1px solid var(--surface-border);
    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.36);
    color: var(--text);
    flex: none;
    transition: background 0.18s ease;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .name {
    font-size: var(--fs-category);
    font-weight: 650;
    letter-spacing: 0.02em;
    /* 범주는 hue로만 구분합니다 — 긴급도의 채도·명도와 충돌하지 않게 */
    color: var(--accent);
  }

  .count {
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: var(--fs-meta);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .column {
    position: relative;
    transition: height 0.25s ease;
  }

  /* ---- 편집 모드 ---- */

  .editor {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin-bottom: 12px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .rename {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: var(--fs-category);
    font-weight: 650;
    color: var(--accent);
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 7px;
    padding: 4px 8px;
  }

  .swatches {
    display: flex;
    gap: 4px;
    flex: 1;
  }

  .swatch {
    width: 15px;
    height: 15px;
    border-radius: 50%;
    border: 1.5px solid transparent;
    cursor: pointer;
    padding: 0;
  }

  .swatch.on {
    border-color: var(--text);
  }

  .nudge,
  .danger {
    font: inherit;
    font-size: var(--fs-meta);
    color: var(--text);
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 7px;
    cursor: pointer;
    padding: 3px 8px;
    flex: none;
  }

  .nudge {
    padding: 1px 8px;
    font-size: 14px;
    line-height: 1.1;
  }

  .nudge:disabled,
  .danger:disabled {
    opacity: 0.32;
    cursor: default;
  }

  .danger:not(:disabled):hover {
    background: rgba(224, 86, 111, 0.28);
    border-color: rgba(224, 86, 111, 0.5);
  }

  .nudge:not(:disabled):hover {
    background: rgba(255, 255, 255, 0.16);
  }

  .runway {
    position: absolute;
    left: 44px;
    right: 0;
    background: linear-gradient(to top, rgba(196, 43, 74, 0.1), rgba(196, 43, 74, 0.015));
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
    font-size: var(--fs-axis);
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
    font-size: var(--fs-axis);
    color: var(--text-muted);
    letter-spacing: 0.1em;
  }

  .more {
    position: absolute;
    right: 2px;
    top: -2px;
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: var(--fs-axis);
    color: var(--text-muted);
  }

  .deadline {
    position: absolute;
    left: 44px;
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

  .empty {
    position: absolute;
    left: 54px;
    bottom: 50%;
    margin: 0;
    font-size: var(--fs-due);
    color: var(--text-muted);
    opacity: 0.6;
  }
</style>
