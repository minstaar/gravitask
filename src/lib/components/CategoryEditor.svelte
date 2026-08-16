<script lang="ts">
  import { theme } from '../theme';
  import type { Category, Task } from '../types';

  let {
    categories,
    tasks,
    onAdd,
    onRename,
    onMove,
    onRemove,
  }: {
    categories: Category[];
    tasks: Task[];
    onAdd: () => void;
    onRename: (id: string, name: string) => void;
    onMove: (id: string, delta: number) => void;
    onRemove: (id: string) => void;
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
  <h2>주제</h2>

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
