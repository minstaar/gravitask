<script lang="ts">
  import { theme } from '../theme';
  import { parseTaskInput } from '../parseInput';
  import {
    alignToRepeat,
    clampCount,
    COUNT_PRESETS,
    CYCLE_PRESETS,
    cycleIdOf,
    describeCount,
    describeCycle,
    MAX_COUNT,
    normalizeRepeat,
    WEEKDAY_NAMES,
    type Repeat,
  } from '../repeat';
  import type { Category, NewTask, Task } from '../types';

  let {
    categories,
    categoryId = $bindable(),
    now,
    onAdd,
    editing = null,
    onEdit,
    onCancelEdit,
    compact = false,
    openSheet = $bindable(null),
  }: {
    categories: Category[];
    categoryId: string;
    now: number;
    onAdd: (t: NewTask) => void;
    /**
     * 고치는 중인 할 일. null이면 새로 적는 중입니다.
     *
     * 수정 폼을 따로 만들지 않는 이유는 어려운 부분이 UI가 아니라 파싱이기
     * 때문입니다. 제목과 마감을 나누고, 주제를 고르고, 날짜·시각을 직접
     * 지정하는 일을 여기가 이미 다 합니다. 폼을 하나 더 만들면 같은 말을 하는
     * 방법이 둘이 되고, 파서가 바뀔 때마다 양쪽을 맞춰야 합니다.
     */
    editing?: Task | null;
    onEdit: (
      id: string,
      patch: { title: string; due: number; categoryId: string; repeat?: Repeat }
    ) => void;
    onCancelEdit: () => void;
    /**
     * 마감·반복 줄을 접어 둘 것인가.
     *
     * 평소의 위젯은 보는 물건이지 적는 물건이 아닙니다. 그런데 칩 줄 둘이
     * 늘 자리를 차지하면, 아무것도 안 하고 있을 때조차 위젯의 위쪽 3분의 1이
     * 입력칸입니다. 손을 대는 동안에만 펼칩니다.
     *
     * 입력칸 자체는 접지 않습니다. 그건 이 위젯에 무언가를 적을 수 있다는
     * 사실을 알리는 유일한 표시라, 사라지면 적는 법을 알 방법이 없습니다.
     */
    compact?: boolean;
    /**
     * 지금 열려 있는 팝오버. 셋 중 하나만 열리므로 한 칸이면 충분합니다.
     *
     * 팝오버는 position:absolute라 패널 높이에 잡히지 않고, 창이 패널 크기를
     * 따라가므로 튀어나온 부분이 창 밖으로 잘립니다. 부모가 그만큼 자리를
     * 잡아둘 수 있도록 실제 요소를 넘깁니다.
     */
    openSheet?: HTMLElement | null;
  } = $props();

  let text = $state('');
  let input: HTMLInputElement | undefined = $state();
  let listOpen = $state(false);
  let dateOpen = $state(false);
  let timeOpen = $state(false);
  let repeatOpen = $state(false);
  /** 달력에서 넘겨 보고 있는 달. null이면 마감일이 속한 달 */
  let monthAnchor = $state<Date | null>(null);

  /** 사용자가 날짜·시각을 직접 건드리면 파싱 결과보다 우선합니다 */
  let overrideDate = $state('');
  let overrideTime = $state('');

  const parsed = $derived(parseTaskInput(text, new Date(now)));
  const ready = $derived(editing ? text.trim().length > 0 : parsed.title.length > 0);
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

  /* ---- 반복 ---- */

  /**
   * 사용자가 직접 정한 반복. null이면 파싱 결과를 씁니다.
   *
   * 날짜·시각과 같은 구조입니다 — 파서가 알아들은 값이 기본이고, 손대는 순간
   * 그쪽이 이깁니다. 여기서는 '반복 없음'도 사용자가 고를 수 있는 값이라
   * null 하나로 '안 골랐음'과 '없음'을 같이 나타낼 수 없어, 한 겹을 더 씁니다.
   */
  let overrideRepeat = $state<{ value: Repeat | null } | null>(null);

  const repeat = $derived(overrideRepeat ? overrideRepeat.value : parsed.repeat);

  /**
   * 첫 회차.
   *
   * 요일을 직접 골랐는데 마감일이 그 요일이 아니면, 규칙이 말하는 것과 화면에
   * 뜰 카드가 어긋납니다. 첫 회차를 규칙 위로 옮기고 그 값을 칩에 그대로
   * 보여 줍니다 — 조용히 옮기면 저장한 뒤에야 다른 날짜를 발견하게 됩니다.
   */
  const firstDue = $derived(repeat ? new Date(alignToRepeat(dueAt.getTime(), repeat)) : dueAt);

  /** 저장할 규칙. 비어 있던 자리(요일·날짜)를 첫 회차에서 채워 둡니다 */
  const repeatToSave = $derived(repeat ? normalizeRepeat(repeat, firstDue.getTime()) : undefined);

  const cycleId = $derived(cycleIdOf(repeat));
  const weekly = $derived(repeat?.unit === 'week');
  /** 지금 켜져 있는 요일들. 고른 적이 없으면 첫 회차의 요일 하나 */
  const chosenWeekdays = $derived(repeat?.weekdays ?? [firstDue.getDay()]);

  // 줄 앞에 '반복'이 이미 적혀 있으므로 칩은 값만 말합니다.
  const repeatLabel = $derived(
    repeat ? `${describeCycle(repeat, firstDue.getTime())} · ${describeCount(repeat.left)}` : '안 함'
  );

  /** 직접 적는 횟수. 비어 있으면 프리셋 중 하나를 쓰고 있다는 뜻입니다 */
  let countText = $state('');

  function setRepeat(next: Repeat | null) {
    overrideRepeat = { value: next };
  }

  function pickCycle(id: string) {
    const preset = CYCLE_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    // 주기를 바꿔도 횟수는 유지합니다. 바꾸는 것은 '얼마 간격인가'뿐이고,
    // '몇 번인가'는 따로 고른 값이라 같이 지워지면 다시 골라야 합니다.
    setRepeat({ ...preset.make(dueAt.getTime()), left: repeat?.left ?? null });
  }

  function toggleWeekday(w: number) {
    if (!repeat || repeat.unit !== 'week') return;
    const on = new Set(chosenWeekdays);
    if (on.has(w)) on.delete(w);
    else on.add(w);
    // 전부 끄면 규칙이 아무 날도 가리키지 않습니다. 마지막 하나는 못 끕니다 —
    // 반복을 그만두려면 '안 함'이라는 분명한 자리가 따로 있습니다.
    if (on.size === 0) return;
    setRepeat({ ...repeat, weekdays: [...on].sort((a, b) => a - b) });
  }

  function pickCount(left: number | null) {
    if (!repeat) return;
    countText = '';
    setRepeat({ ...repeat, left });
  }

  function typeCount(raw: string) {
    countText = raw;
    if (!repeat) return;
    const n = Number(raw);
    if (!raw.trim() || !Number.isFinite(n)) return;
    setRepeat({ ...repeat, left: clampCount(n) });
  }

  /* ---- 직접 그린 달력 ---- */

  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const shownMonth = $derived(
    monthAnchor ?? new Date(firstDue.getFullYear(), firstDue.getMonth(), 1)
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

  // 반복이 첫 회차를 옮겼으면 옮긴 날짜를 보여 줍니다. 실제로 생길 카드와
  // 다른 날짜를 칩에 적어 두면, 저장한 뒤에야 어긋난 것을 알게 됩니다.
  const dateLabel = $derived(
    `${firstDue.getMonth() + 1}월 ${firstDue.getDate()}일 (${WD[firstDue.getDay()]})`
  );

  /* ---- 시각 고르기 ---- */

  /**
   * 시와 분을 따로 고릅니다.
   *
   * 흔한 시각만 늘어놓으면 목록에 없는 시각을 아예 지정할 수 없습니다.
   * 두 열로 나누면 어떤 시각이든 두 번의 클릭으로 닿습니다.
   *
   * 분은 60줄을 다 놓습니다. 예전에는 5분 간격에 59분만 더했는데, 그러면
   * "23분"이라고 적으면 되는 것이 직접 고를 때는 안 되는 상태가 됩니다.
   * 같은 앱에서 한쪽 길로는 되고 다른 길로는 안 되는 것이 5분이라는 눈금보다
   * 나쁩니다. 위의 '어떤 시각이든'도 그제서야 사실이 됩니다.
   */
  const HOURS = Array.from({ length: 24 }, (_, h) => pad(h));
  const MINUTES = Array.from({ length: 60 }, (_, m) => pad(m));
  const QUICK_TIMES = ['09:00', '12:00', '18:00', '23:59'];

  /**
   * 열자마자 지금 값이 보이도록 목록을 감아 둡니다.
   *
   * 분이 60줄이 되면서 필요해졌습니다. 23분을 고르려고 목록 한복판까지 굴려
   * 내려가야 한다면, 고를 수 있다는 것과 고를 만하다는 것은 다른 이야기가
   * 됩니다. 시 열도 같은 이유로 그동안 늦은 시각이 접혀 있었습니다.
   */
  function revealSelected(node: HTMLElement) {
    const on = node.querySelector<HTMLElement>('.unit.on');
    if (on) node.scrollTop = on.offsetTop - (node.clientHeight - on.offsetHeight) / 2;
  }

  const curHour = $derived(timeValue.slice(0, 2));
  const curMin = $derived(timeValue.slice(3, 5));

  function setHour(h: string) {
    overrideTime = `${h}:${curMin}`;
  }

  function setMinute(m: string) {
    overrideTime = `${curHour}:${m}`;
  }

  function pickTime(t: string) {
    overrideTime = t;
    timeOpen = false;
  }

  function closeAll() {
    listOpen = false;
    dateOpen = false;
    timeOpen = false;
    repeatOpen = false;
  }

  function reset() {
    text = '';
    overrideDate = '';
    overrideTime = '';
    overrideRepeat = null;
    countText = '';
    monthAnchor = null;
    closeAll();
  }

  /**
   * 고칠 항목을 입력칸에 싣습니다.
   *
   * loadedId를 $state로 두지 않는 것은 이 효과가 스스로를 다시 부르지 않게
   * 하기 위해서입니다. 여기서 보는 것은 editing 하나뿐이어야 합니다.
   */
  let loadedId: string | null = null;
  $effect(() => {
    const t = editing;
    if (t) {
      if (t.id === loadedId) return;
      loadedId = t.id;
      const d = new Date(t.due);
      text = t.title;
      // 저장된 마감은 이미 사용자가 정한 값입니다. 그래서 파싱 결과가 아니라
      // override 자리에 싣습니다 — 그러지 않으면 '내일 회의 준비' 같은 제목을
      // 되돌려 넣는 순간 파서가 '내일'을 마감으로 도로 집어가고 제목에서
      // 떼어냅니다. 멀쩡하던 제목이 조용히 잘려 나가는 것입니다.
      overrideDate = toDate(d);
      overrideTime = toTime(d);
      // 마감과 같은 이유로 override 자리에 싣습니다. 파싱 결과를 쓰면 '매주
      // 회의' 같은 제목을 되돌려 넣는 순간 파서가 '매주'를 규칙으로 도로
      // 집어가고 제목에서 떼어냅니다.
      overrideRepeat = { value: t.repeat ?? null };
      countText = '';
      categoryId = t.categoryId;
      closeAll();
      input?.focus();
    } else if (loadedId !== null) {
      loadedId = null;
      reset();
    }
  });

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!ready) return;
    if (editing) {
      // 수정 모드에서 제목은 적힌 글자 그대로입니다. 마감은 아래 칩이 이미
      // 들고 있으므로 제목에서 다시 뽑을 이유가 없습니다.
      onEdit(editing.id, {
        title: text.trim(),
        due: firstDue.getTime(),
        categoryId,
        repeat: repeatToSave,
      });
    } else {
      onAdd({ title: parsed.title, due: firstDue.getTime(), categoryId, repeat: repeatToSave });
    }
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
        onclick={() => {
          listOpen = !listOpen;
          dateOpen = false;
          timeOpen = false;
        }}
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
          bind:this={openSheet}
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
      placeholder="서류 제출 내일 오후 6시"
      aria-label="할 일 입력"
      autocomplete="off"
    />

    <button type="submit" class="submit" disabled={!ready}>{editing ? '수정' : '추가'}</button>
  </div>

  <!-- 날짜·시각도 직접 그립니다. 네이티브 입력은 달력과 목록 모양을 OS가
       정해서 위젯과 따로 놀고, 지우기 버튼처럼 우리가 원치 않는 조작도 끼어듭니다. -->
  {#if !compact}
  <div class="row due">
    <span class="lbl">마감</span>
    {#if editing}
      <!-- 취소는 수정 버튼 바로 아래, 같은 크기·같은 자리에 둡니다. 손이 이미
           그 자리를 알고 있으니 찾을 필요가 없습니다. 다만 색은 한 단계
           물러나 있습니다 — 나가는 문이지 주된 행동이 아닙니다.

           보이는 출구가 반드시 있어야 합니다. Esc로도 나갈 수 있지만 그건
           보이지 않고, 모드에 갇힌 사람은 갇혔다는 것부터 모릅니다. -->
      <button type="button" class="cancel" onclick={onCancelEdit}>취소</button>
    {/if}

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
        <div class="sheet cal" role="dialog" aria-label="마감 날짜 고르기" bind:this={openSheet}>
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
        <div class="sheet times" role="dialog" aria-label="마감 시각 고르기" bind:this={openSheet}>
          <div class="quick">
            {#each QUICK_TIMES as t (t)}
              <button type="button" onclick={() => pickTime(t)}>{t}</button>
            {/each}
          </div>

          <div class="cols">
            <div class="col" role="listbox" aria-label="시">
              <span class="colhead">시</span>
              <div class="scroll" use:revealSelected>
                {#each HOURS as h (h)}
                  <button
                    type="button"
                    class="unit"
                    class:on={h === curHour}
                    role="option"
                    aria-selected={h === curHour}
                    onclick={() => setHour(h)}
                  >
                    {h}
                  </button>
                {/each}
              </div>
            </div>

            <div class="col" role="listbox" aria-label="분">
              <span class="colhead">분</span>
              <div class="scroll" use:revealSelected>
                {#each MINUTES as m (m)}
                  <button
                    type="button"
                    class="unit"
                    class:on={m === curMin}
                    role="option"
                    aria-selected={m === curMin}
                    onclick={() => setMinute(m)}
                  >
                    {m}
                  </button>
                {/each}
              </div>
            </div>
          </div>

          <button type="button" class="done" onclick={() => (timeOpen = false)}>확인</button>
        </div>
      {/if}
    </div>

  </div>

  <!--
    반복은 제 줄을 가집니다.

    마감 옆에 끼워 뒀더니 칩 글자가 바뀔 때마다 줄이 다시 짜였습니다 — '안 함'과
    '매주 월·화·수·목 · 계속'은 폭이 두 배 넘게 차이 나서, 고르는 동안 칩이
    아랫줄로 밀렸다 올라왔다 했습니다. 칩에 붙어 있는 팝오버까지 같이 뛰니
    누르려던 자리가 매번 움직였습니다.

    제 줄에 두면 옆에 다툴 것이 없어 어떤 값을 골라도 자리가 그대로입니다.
    덤으로 줄 이름이 '반복'이 되어 칩은 값만 말하면 됩니다.
  -->
  <div class="row due rep-row">
    <span class="lbl">반복</span>

    <div class="picker">
      <button
        type="button"
        class="chip"
        class:on={repeat !== null}
        aria-haspopup="dialog"
        aria-expanded={repeatOpen}
        onclick={() => {
          repeatOpen = !repeatOpen;
          dateOpen = false;
          timeOpen = false;
          listOpen = false;
        }}
      >
        {#if repeat}<span class="cycle" aria-hidden="true">↻</span>{/if}
        <span class="chip-label">{repeatLabel}</span>
        <span class="caret" class:up={repeatOpen}>▾</span>
      </button>

      {#if repeatOpen}
        <div class="sheet rep" role="dialog" aria-label="반복 고르기" bind:this={openSheet}>
          <div class="quick">
            <!-- '안 함'이 첫 자리입니다. 나가는 문은 들어온 자리와 같은 줄에
                 있어야 찾지 않고 누를 수 있습니다. -->
            <button
              type="button"
              class:on={repeat === null}
              onclick={() => {
                setRepeat(null);
                repeatOpen = false;
              }}>안 함</button
            >
            {#each CYCLE_PRESETS as p (p.id)}
              <button type="button" class:on={cycleId === p.id} onclick={() => pickCycle(p.id)}>
                {p.label}
              </button>
            {/each}
          </div>

          {#if weekly}
            <!-- 주간 반복에서만 요일이 뜻을 가집니다. 매일·매월에 요일 칸을
                 띄워 두면 눌러도 아무 일이 없는 버튼이 일곱 개 생깁니다. -->
            <div class="wdays" role="group" aria-label="반복 요일">
              {#each WEEKDAY_NAMES as name, w (w)}
                <button
                  type="button"
                  class="wd-toggle"
                  class:on={chosenWeekdays.includes(w)}
                  aria-pressed={chosenWeekdays.includes(w)}
                  onclick={() => toggleWeekday(w)}
                >
                  {name}
                </button>
              {/each}
            </div>
          {/if}

          {#if repeat}
            <div class="count">
              <span class="colhead">반복 횟수</span>
              <div class="quick">
                {#each COUNT_PRESETS as n (n ?? 'forever')}
                  <button
                    type="button"
                    class:on={repeat.left === n && countText === ''}
                    onclick={() => pickCount(n)}
                  >
                    {n === null ? '계속' : `${n}회`}
                  </button>
                {/each}
              </div>
              <label class="own">
                직접
                <input
                  type="number"
                  min="1"
                  max={MAX_COUNT}
                  inputmode="numeric"
                  placeholder="-"
                  value={countText}
                  oninput={(e) => typeCount(e.currentTarget.value)}
                />
                회
              </label>
              <!--
                한 문장으로 고정합니다.
                
                고른 값에 따라 문장을 갈아 끼웠더니, 횟수를 누를 때마다 안내가
                통째로 바뀌어 눈이 그때마다 다시 읽어야 했습니다. 게다가 그 안내가
                말하던 것("15번째 회차를 끝내면…")은 칩에 이미 '15회 남음'으로
                적혀 있어서 같은 말을 두 번 한 셈입니다.
                
                여기 남길 것은 칩이 말하지 못하는 하나뿐입니다 — 나가는 문이
                어디 있는가. 그건 무엇을 고르든 같으니 바뀔 이유가 없습니다.
              -->
              <p class="note">카드를 우클릭해 반복을 끝낼 수 있습니다.</p>
            </div>
          {/if}

          <button type="button" class="done" onclick={() => (repeatOpen = false)}>확인</button>
        </div>
      {/if}
    </div>

    {#if parsed.dateText || parsed.timeText || parsed.repeatText}
      <span class="hint">
        “{[parsed.repeatText, parsed.dateText, parsed.timeText].filter(Boolean).join(' ')}”에서 읽음
      </span>
    {/if}
  </div>
  {/if}
</form>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') closeAll();
  }}
/>

<style>
  /**
   * 폭은 위젯이 정합니다. 입력칸은 거기 맞춰 늘어날 뿐입니다.
   *
   * 설정 패널이 쓰는 것과 같은 수법입니다. 패널이 inline-flex라 가장 넓은
   * 자식을 따라가는데, 마감 줄에 칩이 셋(날짜·시각·반복)이 되면서 수정 중에는
   * '취소'까지 붙어 한 줄의 max-content가 377px이 됩니다. 그대로 두면 반복 칩
   * 하나 때문에 패널이 위젯보다 47px 넓어져 두 카드의 세로선이 어긋납니다.
   *
   * width:0으로 폭 계산에서 빠지고 min-width:100%로 정해진 폭에 맞춥니다.
   * 그제서야 마감 줄의 flex-wrap도 일을 합니다 — 아무것도 폭을 붙들지 않으면
   * 줄은 접히는 대신 옆으로 자라기만 합니다.
   */
  form {
    display: flex;
    flex-direction: column;
    gap: 7px;
    width: 0;
    min-width: 100%;
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

  /* 수정 버튼과 같은 크기·같은 자리. order로 줄 끝에 세우고 margin-left:auto가
     그 앞의 빈자리를 먹습니다. 색만 한 단계 물러나 있습니다. */
  .cancel {
    font: inherit;
    font-size: 13px;
    color: rgba(237, 237, 245, 0.62);
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 9px;
    padding: 8px 11px;
    margin-left: auto;
    order: 9;
    cursor: pointer;
  }

  .cancel:hover {
    color: #ededf5;
    background: rgba(255, 255, 255, 0.06);
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

  /**
   * 마감 줄은 좁으면 접힙니다.
   *
   * 수정 중에는 '취소'가 붙어 날짜·시각과 함께 한 줄을 넘길 수 있습니다.
   * 접지 않으면 줄이 옆으로 자라 위젯 폭을 밀어내고, 위젯이 입력줄을
   * 따라가므로 버튼 하나 때문에 기둥 전체가 넓어집니다.
   */
  .due {
    align-items: center;
    flex-wrap: wrap;
    row-gap: 5px;
    padding-left: 2px;
  }

  /**
   * 반복 줄은 절대 접히지 않습니다.
   *
   * 접히는 것을 막는 게 이 줄의 존재 이유입니다. 값이 길어지면 줄을 넘기는
   * 대신 칩 글자를 말줄임합니다 — 잘린 글자는 칩을 열면 그대로 다 보이지만,
   * 뛰어다니는 칩은 누를 때마다 자리를 다시 찾게 만듭니다.
   */
  .rep-row {
    flex-wrap: nowrap;
  }

  .rep-row .picker {
    flex: 0 1 auto;
    min-width: 0;
  }

  .rep-row .hint {
    flex: 0 1 auto;
    min-width: 0;
  }

  .chip-label {
    overflow: hidden;
    text-overflow: ellipsis;
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
    min-width: 0;
    max-width: 100%;
  }

  .chip:hover {
    background: rgba(255, 255, 255, 0.14);
  }

  /* 반복이 걸려 있을 때만 칩에 불이 들어옵니다. 나머지 둘(날짜·시각)은 언제나
     값이 있지만 이것만 '없음'이 정상 상태라, 켜짐이 정보를 담습니다. */
  .chip.on {
    color: #cfcbff;
    background: rgba(90, 80, 190, 0.28);
    border-color: rgba(160, 150, 255, 0.5);
  }

  .cycle {
    font-size: 11px;
    line-height: 1;
    opacity: 0.9;
  }

  /* ---- 반복 ---- */

  .rep {
    padding: 8px;
    gap: 7px;
    width: 232px;
  }

  /* 주기 다섯 개('안 함' 포함)가 한 줄에 들어갑니다. 좌우 여백이 8px일 때
     합이 218px으로 214px을 4px 넘겨 접혔는데, 접힌 줄에 하나만 남으면 그
     하나가 다른 종류처럼 보입니다. 여백을 6px로 낮춰 한 줄에 담습니다.
     그래도 모자란 화면에서는 접히게 두고, 각 칸은 내용만큼만 차지합니다 —
     .quick의 flex:1은 달력의 네 칸용입니다. */
  .rep > .quick {
    flex-wrap: wrap;
  }

  .rep > .quick button {
    flex: 0 1 auto;
    padding: 4px 6px;
  }

  .quick button.on {
    background: rgba(90, 80, 190, 0.55);
    border-color: rgba(160, 150, 255, 0.6);
  }

  .wdays {
    display: flex;
    gap: 3px;
  }

  .wd-toggle {
    flex: 1;
    font: inherit;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.6);
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 5px 0;
    cursor: pointer;
  }

  .wd-toggle:hover {
    background: rgba(255, 255, 255, 0.16);
  }

  .wd-toggle.on {
    color: #ededf5;
    background: rgba(90, 80, 190, 0.55);
    border-color: rgba(160, 150, 255, 0.6);
  }

  .count {
    display: flex;
    flex-direction: column;
    gap: 5px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    padding-top: 7px;
  }

  .own {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.6);
  }

  .own input {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    padding: 4px 7px;
    border-radius: 6px;
    /* 숫자가 '회' 바로 옆에 붙어야 "12회"라는 한 덩어리로 읽힙니다. 왼쪽에
       붙어 있으면 넓은 칸 건너편의 '회'와 따로 놉니다. 자리표시 하이픈도
       같은 자리에 서서, 무엇이 채워질 자리인지 가리킵니다. */
    text-align: right;
  }

  /* 숫자 칸의 증감 화살표를 뺍니다. 폭이 좁아 화살표가 숫자를 밀어냅니다 */
  .own input::-webkit-outer-spin-button,
  .own input::-webkit-inner-spin-button {
    appearance: none;
    margin: 0;
  }

  .note {
    margin: 0;
    font-size: 10.5px;
    line-height: 1.45;
    color: rgba(255, 255, 255, 0.45);
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
    padding: 8px;
    gap: 7px;
    /* 목록 좌우로 내준 4px씩만큼 넓힙니다. 숫자 칸은 있던 크기 그대로입니다 */
    width: 192px;
  }

  .cols {
    display: flex;
    gap: 6px;
  }

  .col {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .colhead {
    font-size: 9.5px;
    text-align: center;
    color: rgba(255, 255, 255, 0.42);
  }

  /* 선택된 값이 보이도록 목록을 스크롤로 두되, 높이를 낮춰
     팝오버가 위젯보다 커지지 않게 합니다.
     position은 revealSelected가 offsetTop을 이 상자 기준으로 읽기 위한 것입니다. */
  .scroll {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 152px;
    overflow-y: auto;
    scrollbar-width: thin;
    /* 세로만 스크롤로 두어도 가로까지 잘립니다. 초점 테두리가 들어설
       4px을 남깁니다 — 설정 패널의 잘린 테두리와 같은 병입니다. */
    padding-inline: 4px;
  }

  .unit {
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    color: #ededf5;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 4px 0;
    cursor: pointer;
    flex: none;
  }

  .unit:hover {
    background: rgba(255, 255, 255, 0.16);
  }

  .unit.on {
    background: rgba(90, 80, 190, 0.55);
    border-color: rgba(160, 150, 255, 0.6);
  }

  .done {
    font: inherit;
    font-size: 11.5px;
    font-weight: 600;
    color: #ededf5;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 7px;
    padding: 5px 0;
    cursor: pointer;
  }

  .done:hover {
    background: rgba(255, 255, 255, 0.2);
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
