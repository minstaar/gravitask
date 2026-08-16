<script lang="ts">
  import { theme } from '../theme';
  import type { Category, Task } from '../types';

  let {
    categories,
    tasks,
    perPage,
    maxPerPage,
    zoom,
    zoomSteps,
    onAdd,
    onRename,
    onMove,
    onRemove,
    onPerPage,
    onZoom,
    onOpenSettings,
  }: {
    categories: Category[];
    tasks: Task[];
    /** 한 번에 보여줄 주제 수 */
    perPage: number;
    /** 폭 상한에 걸려 더는 늘릴 수 없는 지점 */
    maxPerPage: number;
    zoom: number;
    zoomSteps: number[];
    onAdd: () => void;
    onRename: (id: string, name: string) => void;
    onMove: (id: string, delta: number) => void;
    onRemove: (id: string) => void;
    onPerPage: (n: number) => void;
    /** delta는 -1(축소) 또는 +1(확대) */
    onZoom: (delta: number) => void;
    onOpenSettings: () => void;
  } = $props();

  // 할 일이 남아 있으면 지울 수 없습니다. 되돌릴 방법이 없는 삭제는 막습니다.
  // tasks에는 살아 있는 할 일만 들어옵니다 — 완료한 것은 기록으로 옮겨 갔고,
  // 기록에는 주제 이름이 함께 있어서 주제를 지워도 읽을 수 있습니다.
  const openCount = $derived(
    new Map(categories.map((c) => [c.id, tasks.filter((t) => t.categoryId === c.id).length]))
  );
</script>

<section
  class="editor"
  style:--surface={theme.surface.background}
  style:--surface-border={theme.surface.border}
  style:--text={theme.surface.text}
  style:--text-muted={theme.surface.textMuted}
  style:--fs-meta="{theme.type.meta}px"
  style:--fs-name="{theme.type.category}px"
>
  <h2>주제 편집</h2>

  <ul>
    {#each categories as category, i (category.id)}
      {@const open = openCount.get(category.id) ?? 0}
      <li>
        <input
          class="rename"
          value={category.name}
          aria-label="주제 이름"
          oninput={(e) => onRename(category.id, e.currentTarget.value)}
        />

        <button
          class="nudge"
          disabled={i === 0}
          aria-label="위로"
          onclick={() => onMove(category.id, -1)}>↑</button
        >
        <button
          class="nudge"
          disabled={i === categories.length - 1}
          aria-label="아래로"
          onclick={() => onMove(category.id, 1)}>↓</button
        >
        <button
          class="danger"
          disabled={open > 0 || categories.length <= 1}
          title={open > 0
            ? `할 일 ${open}건이 남아 있어 지울 수 없습니다`
            : categories.length <= 1
              ? '마지막 주제는 지울 수 없습니다'
              : '주제 삭제'}
          aria-label="{category.name} 삭제"
          onclick={() => onRemove(category.id)}>삭제</button
        >
      </li>
    {/each}
  </ul>

  <button class="add" onclick={onAdd}>＋ 주제 추가</button>

  <!--
    보기 — 화면에 얼마나 담을지. 배율과 주제 수는 사실 같은 질문에 대한 답이라
    나란히 둡니다. 둘 다 결과가 그 자리에서 즉시 보이므로 위젯 안에 있어야 합니다.
  -->
  <h2 class="section">보기</h2>

  <div class="row">
    <span class="label">배율</span>
    <button class="nudge" aria-label="축소" disabled={zoom <= zoomSteps[0]} onclick={() => onZoom(-1)}
      >−</button
    >
    <span class="count">{Math.round(zoom * 100)}%</span>
    <button
      class="nudge"
      aria-label="확대"
      disabled={zoom >= zoomSteps[zoomSteps.length - 1]}
      onclick={() => onZoom(1)}>＋</button
    >
  </div>

  <!--
    주제가 늘 때마다 위젯이 옆으로 자라면 안 되므로, 한 번에 보여줄 수를 정하고
    나머지는 페이지를 넘겨 봅니다. 상한은 폭 예산이 정합니다 — 그보다 더 넣으면
    제목이 거의 남지 않습니다.
  -->
  <div class="row">
    <span class="label">한 화면에 표시할 주제 수</span>
    <button
      class="nudge"
      aria-label="적게 보기"
      disabled={perPage <= 1}
      onclick={() => onPerPage(perPage - 1)}>−</button
    >
    <span class="count">{perPage}개</span>
    <button
      class="nudge"
      aria-label="많이 보기"
      disabled={perPage >= maxPerPage}
      onclick={() => onPerPage(perPage + 1)}>＋</button
    >
    {#if categories.length > perPage}
      <span class="note">{Math.ceil(categories.length / perPage)}쪽</span>
    {/if}
  </div>

  <!--
    환경설정은 별도 창입니다.
    결과가 그 자리에서 보이지 않고, 자주 열지 않고, 폼이 큽니다. 위젯 창은
    테두리도 크기 조절도 스크롤도 없고 내용에 맞춰 크기가 정해져서, 여기 담으면
    열 때마다 위젯이 두 배가 됩니다.
  -->
  <h2 class="section">환경설정</h2>

  <button class="add outbound" onclick={onOpenSettings}>
    알림 · 시작 · 업데이트 설정 열기
  </button>
</section>

<style>
  .editor {
    border-radius: 14px;
    padding: 12px 14px 14px;
    background: var(--surface);
    border: 1px solid var(--surface-border);
    color: var(--text);
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  h2 {
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: var(--fs-meta);
    font-weight: 600;
    letter-spacing: 0.14em;
    color: var(--text-muted);
    margin: 0;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  li {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* 큰 갈래를 나눕니다. 주제 편집과 환경설정은 성격이 다른 일입니다 */
  .section {
    padding-top: 9px;
    border-top: 1px solid rgba(255, 255, 255, 0.09);
  }

  .outbound {
    text-align: left;
  }

  .label {
    flex: 1;
    font-size: var(--fs-meta);
    color: var(--text-muted);
  }

  .count,
  .note {
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: var(--fs-meta);
    font-variant-numeric: tabular-nums;
    color: var(--text);
    min-width: 28px;
    text-align: center;
  }

  .note {
    color: var(--text-muted);
    min-width: 0;
    margin-left: 2px;
  }

  .rename {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: var(--fs-name);
    font-weight: 650;
    color: var(--text);
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 7px;
    padding: 4px 8px;
  }

  .nudge,
  .danger,
  .add {
    font: inherit;
    font-size: var(--fs-meta);
    color: var(--text);
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 7px;
    cursor: pointer;
    flex: none;
    padding: 4px 8px;
  }

  .nudge {
    padding: 2px 7px;
    line-height: 1.2;
  }

  .add {
    align-self: flex-start;
    padding: 5px 11px;
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

  .nudge:not(:disabled):hover,
  .add:hover {
    background: rgba(255, 255, 255, 0.16);
  }

  :global(button:focus-visible),
  input:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.7);
    outline-offset: 2px;
  }
</style>
