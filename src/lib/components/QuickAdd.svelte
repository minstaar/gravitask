<script lang="ts">
  import { parseTaskInput } from '../parseInput';
  import type { Category, NewTask } from '../types';

  let {
    categories,
    categoryId = $bindable(),
    now,
    onAdd,
  }: {
    categories: Category[];
    categoryId: string;
    now: number;
    onAdd: (t: NewTask) => void;
  } = $props();

  let text = $state('');
  let input: HTMLInputElement | undefined = $state();

  const parsed = $derived(parseTaskInput(text, new Date(now)));
  const ready = $derived(parsed.title.length > 0);

  const preview = $derived.by(() => {
    if (!parsed.due) return null;
    const d = parsed.due;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!ready) return;
    // 날짜를 못 알아들었으면 오늘 끝을 기본 마감으로 둡니다.
    // 입력을 막는 것보다 낫고, 사용자가 카드에서 바로 눈치챌 수 있습니다.
    const due = parsed.due ?? new Date(new Date(now).setHours(23, 59, 0, 0));
    onAdd({ title: parsed.title, due: due.getTime(), categoryId });
    text = '';
    input?.focus();
  }

  export function focus() {
    input?.focus();
  }
</script>

<form onsubmit={submit}>
  <select bind:value={categoryId} aria-label="범주">
    {#each categories as c (c.id)}
      <option value={c.id}>{c.name}</option>
    {/each}
  </select>

  <div class="field">
    <input
      bind:this={input}
      bind:value={text}
      type="text"
      placeholder="확률론 과제 내일 오후 6시"
      aria-label="할 일 입력"
      autocomplete="off"
    />
    {#if text && preview}
      <span class="chip">{preview}</span>
    {:else if text && ready}
      <span class="chip faint">오늘 23:59</span>
    {/if}
  </div>

  <button type="submit" disabled={!ready}>추가</button>
</form>

<style>
  form {
    display: flex;
    gap: 8px;
    align-items: stretch;
  }

  .field {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
  }

  input,
  select,
  button {
    font: inherit;
    font-size: 13px;
    color: #ededf5;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 9px;
    padding: 9px 11px;
  }

  input {
    width: 100%;
    padding-right: 108px;
  }

  input::placeholder {
    color: rgba(255, 255, 255, 0.3);
  }

  select {
    cursor: pointer;
  }

  select option {
    background: #1a1c25;
  }

  .chip {
    position: absolute;
    right: 8px;
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: 10px;
    color: #cfcbff;
    background: rgba(90, 80, 190, 0.3);
    border: 1px solid rgba(160, 150, 255, 0.35);
    border-radius: 6px;
    padding: 2px 6px;
    pointer-events: none;
    white-space: nowrap;
  }

  .chip.faint {
    color: rgba(255, 255, 255, 0.45);
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.12);
  }

  button {
    cursor: pointer;
    flex: none;
    font-weight: 600;
  }

  button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  button:not(:disabled):hover {
    background: rgba(255, 255, 255, 0.14);
  }

  :focus-visible {
    outline: 2px solid #cfcbff;
    outline-offset: 2px;
  }
</style>
