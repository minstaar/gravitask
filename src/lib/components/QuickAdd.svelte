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
  let dateOpen = $state(false);
  let timeOpen = $state(false);
  /** 달력에서 넘겨 보고 있는 달. null이면 마감일이 속한 달 */
  let monthAnchor = $state<Date | null>(null);

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

  /* ---- 직접 그린 달력 ---- */

  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const shownMonth = $derived(
    monthAnchor ?? new Date(dueAt.getFullYear(), dueAt.getMonth(), 1)
  );

  /** 달력 한 판. 앞뒤 빈칸을 null로 채워 요일이 어긋나지 않게 합니다 */
  const monthCells = $derived.by(() => {
    const first = new Date(shownMonth.getFullYear(), shownMonth.getMonth(), 1);
    const days = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + 1, 0).getDate();
    const cells: (Date | null)[] = Array(first.getDay()).fill(null);
    for (let d = 1; d <= days; d++) {
      cells.push(new Date(shownMonth.getFullYear(), shownMonth.getMonth(), d));
    }
    return cells;
  });

  const todayKey = $derived(toDate(new Date(now)));

  function pickDate(d: Date) {
    overrideDate = toDate(d);
    monthAnchor = null;
    dateOpen = false;
  }

  function shiftDays(n: number) {
    const d = new Date(now);
    d.setDate(d.getDate() + n);
    pickDate(d);
  }

  function shiftMonth(n: number) {
    monthAnchor = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + n, 1);
  }

  const dateLabel = $derived(
    `${dueAt.getMonth() + 1}월 ${dueAt.getDate()}일 (${WD[dueAt.getDay()]})`
  );

  /* ---- 시각 고르기 ---- */

  /**
   * 흔히 쓰는 시각만 늘어놓습니다. 30분 간격이면 대부분 한 번에 집히고,
   * 하루 끝인 23:59는 마감 기본값이라 따로 둡니다.
   */
  const TIMES = $derived.by(() => {
    const out: string[] = [];
    for (let h = 8; h <= 23; h++) {
      out.push(`${pad(h)}:00`);
      if (h < 23) out.push(`${pad(h)}:30`);
    }
    out.push('23:59');
    return out;
  });

  function pickTime(t: string) {
    overrideTime = t;
    timeOpen = false;
  }

  function closeAll() {
    listOpen = false;
    dateOpen = false;
    timeOpen = false;
  }

  function reset() {
    text = '';
    overrideDate = '';
    overrideTime = '';
    monthAnchor = null;
    closeAll();
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
        {selected?.name ?? '주제'}
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

  <!-- 날짜·시각도 직접 그립니다. 네이티브 입력은 달력과 목록 모양을 OS가
       정해서 위젯과 따로 놀고, 지우기 버튼처럼 우리가 원치 않는 조작도 끼어듭니다. -->
  <div class="row due">
    <span class="lbl">마감</span>

    <div class="picker">
      <button
        type="button"
        class="chip"
        aria-haspopup="dialog"
        aria-expanded={dateOpen}
        onclick={() => {
          dateOpen = !dateOpen;
          timeOpen = false;
          listOpen = false;
        }}
      >
        {dateLabel}
        <span class="caret" class:up={dateOpen}>▾</span>
      </button>

      {#if dateOpen}
        <div class="sheet cal" role="dialog" aria-label="마감 날짜 고르기">
          <div class="quick">
            <button type="button" onclick={() => shiftDays(0)}>오늘</button>
            <button type="button" onclick={() => shiftDays(1)}>내일</button>
            <button type="button" onclick={() => shiftDays(2)}>모레</button>
            <button type="button" onclick={() => shiftDays(7)}>1주 뒤</button>
          </div>

          <div class="mon">
            <button type="button" class="nav" aria-label="이전 달" onclick={() => shiftMonth(-1)}>‹</button>
            <span>{shownMonth.getFullYear()}년 {shownMonth.getMonth() + 1}월</span>
            <button type="button" class="nav" aria-label="다음 달" onclick={() => shiftMonth(1)}>›</button>
          </div>

          <div class="grid">
            {#each WD as w (w)}
              <span class="wd">{w}</span>
            {/each}
            {#each monthCells as cell, i (i)}
              {#if cell}
                <button
                  type="button"
                  class="day"
                  class:sel={toDate(cell) === dateValue}
                  class:today={toDate(cell) === todayKey}
                  onclick={() => pickDate(cell)}
                >
                  {cell.getDate()}
                </button>
              {:else}
                <span class="day empty"></span>
              {/if}
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <div class="picker">
      <button
        type="button"
        class="chip"
        aria-haspopup="listbox"
        aria-expanded={timeOpen}
        onclick={() => {
          timeOpen = !timeOpen;
          dateOpen = false;
          listOpen = false;
        }}
      >
        {timeValue}
        <span class="caret" class:up={timeOpen}>▾</span>
      </button>

      {#if timeOpen}
        <div class="sheet times" role="listbox" aria-label="마감 시각 고르기">
          {#each TIMES as t (t)}
            <button
              type="button"
              class="tt"
              class:on={t === timeValue}
              role="option"
              aria-selected={t === timeValue}
              onclick={() => pickTime(t)}
            >
              {t}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    {#if parsed.dateText || parsed.timeText}
      <span class="hint">
        “{[parsed.dateText, parsed.timeText].filter(Boolean).join(' ')}”에서 읽음
      </span>
    {/if}
  </div>
</form>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') closeAll();
  }}
/>

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

  /* ---- 주제 고르기 ---- */

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

  .chip {
    display: flex;
    align-items: center;
    gap: 6px;
    font: inherit;
    font-size: var(--fs-meta);
    color: #ededf5;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 8px;
    padding: 5px 9px;
    cursor: pointer;
    white-space: nowrap;
  }

  .chip:hover {
    background: rgba(255, 255, 255, 0.14);
  }

  /* ---- 달력 ---- */

  .cal {
    padding: 8px;
    gap: 7px;
    width: 232px;
  }

  .quick {
    display: flex;
    gap: 4px;
  }

  .quick button {
    flex: 1;
    font: inherit;
    font-size: 11px;
    color: #ededf5;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 6px;
    padding: 4px 0;
    cursor: pointer;
  }

  .quick button:hover {
    background: rgba(255, 255, 255, 0.18);
  }

  .mon {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    font-weight: 600;
  }

  .nav {
    font: inherit;
    font-size: 15px;
    line-height: 1;
    color: #ededf5;
    background: transparent;
    border: none;
    border-radius: 5px;
    padding: 1px 8px;
    cursor: pointer;
  }

  .nav:hover {
    background: rgba(255, 255, 255, 0.14);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
  }

  .wd {
    font-size: 9.5px;
    text-align: center;
    color: rgba(255, 255, 255, 0.42);
    padding-bottom: 2px;
  }

  .day {
    font: inherit;
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    color: #ededf5;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 4px 0;
    cursor: pointer;
  }

  .day.empty {
    cursor: default;
  }

  .day:not(.empty):hover {
    background: rgba(255, 255, 255, 0.14);
  }

  .day.today {
    border-color: rgba(255, 255, 255, 0.4);
  }

  .day.sel {
    background: rgba(90, 80, 190, 0.55);
    border-color: rgba(160, 150, 255, 0.6);
  }

  /* ---- 시각 ---- */

  .times {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 3px;
    padding: 6px;
    width: 208px;
    max-height: 188px;
    overflow-y: auto;
  }

  .tt {
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: 11px;
    color: #ededf5;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 4px 0;
    cursor: pointer;
  }

  .tt:hover {
    background: rgba(255, 255, 255, 0.16);
  }

  .tt.on {
    background: rgba(90, 80, 190, 0.55);
    border-color: rgba(160, 150, 255, 0.6);
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
