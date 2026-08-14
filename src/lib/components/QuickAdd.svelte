<script lang="ts">
  import { theme } from '../theme';
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
  let listOpen = $state(false);

  /** 사용자가 날짜·시각을 직접 건드리면 파싱 결과보다 우선합니다 */
  let overrideDate = $state('');
  let overrideTime = $state('');

  const parsed = $derived(parseTaskInput(text, new Date(now)));
  const ready = $derived(parsed.title.length > 0);
  const selected = $derived(categories.find((c) => c.id === categoryId) ?? categories[0]);

  const pad = (n: number) => String(n).padStart(2, '0');
  const toDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const toTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  /**
   * 마감 기본값. 자연어를 알아들었으면 그 값을, 못 알아들었으면 오늘 끝을 씁니다.
   * 어느 쪽이든 화면에 편집 가능한 필드로 드러납니다. 파싱이 빗나갔을 때
   * 손댈 방법이 없으면 입력 자체를 신뢰할 수 없게 됩니다.
   */
  const base = $derived(parsed.due ?? new Date(new Date(now).setHours(23, 59, 0, 0)));
  const dateValue = $derived(overrideDate || toDate(base));
  const timeValue = $derived(overrideTime || toTime(base));

  const dueAt = $derived.by(() => {
    const [y, m, d] = dateValue.split('-').map(Number);
    const [hh, mm] = timeValue.split(':').map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 23, mm ?? 59, 0, 0);
  });

  function reset() {
    text = '';
    overrideDate = '';
    overrideTime = '';
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!ready) return;
    onAdd({ title: parsed.title, due: dueAt.getTime(), categoryId });
    reset();
    input?.focus();
  }

  export function focus() {
    input?.focus();
  }
</script>

<form onsubmit={submit} style:--fs-meta="{theme.type.meta}px" style:--fs-name="{theme.type.category}px">
  <div class="row">
    <!-- 기본 select는 목록 모양을 OS가 정해서 위젯과 따로 놉니다.
         직접 그리면 나머지 UI와 같은 언어를 쓸 수 있습니다. -->
    <div class="picker">
      <button
        type="button"
        class="trigger"
        aria-haspopup="listbox"
        aria-expanded={listOpen}
        onclick={() => (listOpen = !listOpen)}
      >
        {selected?.name ?? '범주'}
        <span class="caret" class:up={listOpen}>▾</span>
      </button>

      {#if listOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="sheet"
          role="listbox"
          tabindex="-1"
          onmouseleave={() => (listOpen = false)}
        >
          {#each categories as c (c.id)}
            <button
              type="button"
              class="option"
              class:on={c.id === categoryId}
              role="option"
              aria-selected={c.id === categoryId}
              onclick={() => {
                categoryId = c.id;
                listOpen = false;
                input?.focus();
              }}
            >
              <span class="mark">{c.id === categoryId ? '✓' : ''}</span>
              {c.name}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <input
      bind:this={input}
      bind:value={text}
      type="text"
      class="title"
      placeholder="확률론 과제 내일 오후 6시"
      aria-label="할 일 입력"
      autocomplete="off"
    />

    <button type="submit" class="submit" disabled={!ready}>추가</button>
  </div>

  <div class="row due">
    <span class="lbl">마감</span>
    <input type="date" aria-label="마감 날짜" bind:value={() => dateValue, (v) => (overrideDate = v)} />
    <input type="time" aria-label="마감 시각" bind:value={() => timeValue, (v) => (overrideTime = v)} />
    {#if parsed.dateText || parsed.timeText}
      <span class="hint">
        “{[parsed.dateText, parsed.timeText].filter(Boolean).join(' ')}”에서 읽음
      </span>
    {/if}
  </div>
</form>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .row {
    display: flex;
    gap: 7px;
    align-items: stretch;
  }

  input,
  .trigger,
  .submit {
    font: inherit;
    font-size: 13px;
    color: #ededf5;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 9px;
    padding: 8px 11px;
  }

  .title {
    flex: 1;
    min-width: 0;
  }

  .title::placeholder {
    color: rgba(255, 255, 255, 0.3);
  }

  .submit {
    cursor: pointer;
    flex: none;
    font-weight: 600;
  }

  .submit:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .submit:not(:disabled):hover {
    background: rgba(255, 255, 255, 0.14);
  }

  /* ---- 범주 고르기 ---- */

  .picker {
    position: relative;
    flex: none;
  }

  .trigger {
    display: flex;
    align-items: center;
    gap: 7px;
    cursor: pointer;
    white-space: nowrap;
    height: 100%;
    font-weight: 600;
  }

  .trigger:hover {
    background: rgba(255, 255, 255, 0.14);
  }

  .caret {
    font-size: 9px;
    opacity: 0.6;
    transition: transform 0.15s ease;
  }

  .caret.up {
    transform: rotate(180deg);
  }

  .sheet {
    position: absolute;
    top: calc(100% + 5px);
    left: 0;
    min-width: 100%;
    z-index: 50;
    display: flex;
    flex-direction: column;
    padding: 4px;
    gap: 2px;
    border-radius: 10px;
    background: rgba(20, 22, 32, 0.98);
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 10px 26px rgba(0, 0, 0, 0.5);
  }

  .option {
    display: flex;
    align-items: center;
    gap: 6px;
    font: inherit;
    font-size: 13px;
    color: #ededf5;
    background: transparent;
    border: none;
    border-radius: 7px;
    padding: 6px 9px 6px 6px;
    cursor: pointer;
    white-space: nowrap;
    text-align: left;
  }

  .option:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .option.on {
    background: rgba(90, 80, 190, 0.32);
  }

  .mark {
    width: 12px;
    flex: none;
    font-size: 11px;
    opacity: 0.9;
  }

  /* ---- 마감 ---- */

  .due {
    align-items: center;
    padding-left: 2px;
  }

  .due input {
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: var(--fs-meta);
    padding: 5px 8px;
    color-scheme: dark;
  }

  .lbl,
  .hint {
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: var(--fs-meta);
    color: rgba(255, 255, 255, 0.5);
    white-space: nowrap;
  }

  .hint {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  :focus-visible {
    outline: 2px solid #cfcbff;
    outline-offset: 2px;
  }
</style>
