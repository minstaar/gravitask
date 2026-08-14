<script lang="ts">
  import Column from './lib/components/Column.svelte';
  import QuickAdd from './lib/components/QuickAdd.svelte';
  import {
    addTask,
    refresh,
    removeTask,
    setDevOffset,
    startClock,
    store,
    toggleTask,
  } from './lib/store.svelte';
  import { MS_HOUR } from './lib/urgency';
  import type { NewTask } from './lib/types';

  // 창 테두리를 없앴기 때문에 앱 안에서 끌 수 있는 영역을 직접 제공해야 합니다.
  const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const PAD = inTauri ? 12 : 32;

  let categoryId = $state(store.categories[0]?.id ?? 'study');
  let quickAdd: QuickAdd | undefined = $state();
  let reducedMotion = $state(false);
  let offsetHours = $state(0);
  let panel: HTMLElement | undefined = $state();

  /** 마우스가 올라와 있거나 포커스를 쥐고 있으면 조작 중으로 봅니다 */
  let hovering = $state(false);
  let focused = $state(false);
  const interacting = $derived(hovering || focused);

  $effect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = mq.matches;
    const on = () => (reducedMotion = mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });

  $effect(() => {
    void refresh().then(seedIfEmpty);
    return startClock();
  });

  $effect(() => {
    const onFocus = () => (focused = true);
    const onBlur = () => (focused = false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  });

  // 개발 편의를 위한 전역 단축키. 진짜 전역 단축키는 Tauri 껍데기에서 붙입니다.
  $effect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'n' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        quickAdd?.focus();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  /**
   * 창을 내용에 맞춥니다.
   *
   * 위젯에서 스크롤은 최후의 수단입니다. 할 일을 하나 추가했다고 스크롤이
   * 생기면 전체를 한눈에 본다는 전제가 무너집니다. 그래서 기둥 높이가
   * 내용에 따라 변하고, 창이 그 크기를 따라갑니다.
   */
  async function fitWindow() {
    if (!inTauri || !panel) return;
    const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window');
    const rect = panel.getBoundingClientRect();
    await getCurrentWindow().setSize(
      new LogicalSize(Math.ceil(rect.width) + PAD * 2, Math.ceil(rect.height) + PAD * 2)
    );
  }

  $effect(() => {
    // 내용이 바뀌면 창 크기도 따라갑니다
    void store.tasks;
    void store.categories;
    void store.now;
    if (!inTauri) return;
    const id = setTimeout(fitWindow, 60);
    return () => clearTimeout(id);
  });

  async function seedIfEmpty() {
    if (store.tasks.length > 0) return;
    if (localStorage.getItem('reminder-widget:seeded')) return;
    localStorage.setItem('reminder-widget:seeded', '1');

    const now = Date.now();
    const demo: NewTask[] = [
      { title: '확률론 과제 3', due: now + 6 * MS_HOUR, categoryId: 'study' },
      { title: '졸업요건 신청', due: now + 48 * MS_HOUR, categoryId: 'study' },
      { title: '논문 초안 제출', due: now + 216 * MS_HOUR, categoryId: 'study' },
      { title: '학회 등록비 납부', due: now + 624 * MS_HOUR, categoryId: 'study' },
      { title: '건강검진 예약', due: now + 30 * MS_HOUR, categoryId: 'life' },
      { title: '월세 이체', due: now + 400 * MS_HOUR, categoryId: 'life' },
    ];
    for (const t of demo) await addTask(t);
  }

  function onOffset(e: Event) {
    offsetHours = +(e.target as HTMLInputElement).value;
    setDevOffset(offsetHours * MS_HOUR);
  }

  const sorted = $derived([...store.categories].sort((a, b) => a.order - b.order));
</script>

<main
  class:desktop={!inTauri}
  style:padding="{PAD}px"
  onmouseenter={() => (hovering = true)}
  onmouseleave={() => (hovering = false)}
>
  <div class="panel" bind:this={panel}>
    {#if inTauri}
      <div class="dragbar" data-tauri-drag-region>
        <span class="brand" data-tauri-drag-region>Gravitask</span>
      </div>
    {/if}

    <QuickAdd
      bind:this={quickAdd}
      categories={sorted}
      bind:categoryId
      now={store.now}
      onAdd={addTask}
    />

    <div class="columns">
      {#each sorted as category (category.id)}
        <Column
          {category}
          tasks={store.tasks.filter((t) => t.categoryId === category.id)}
          now={store.now}
          active={interacting}
          {reducedMotion}
          onToggle={toggleTask}
          onRemove={removeTask}
        />
      {/each}
    </div>

    <!-- 개발 빌드에만 들어갑니다. 프로덕션 번들에서는 통째로 빠집니다 -->
    {#if import.meta.env.DEV}
      <div class="devbar">
        <span class="lbl">시간 이동</span>
        <input
          type="range"
          min="0"
          max="620"
          step="1"
          value={offsetHours}
          oninput={onOffset}
          aria-label="개발용 시간 이동"
        />
        <span class="val">
          {offsetHours === 0
            ? '지금'
            : offsetHours < 48
              ? `+${offsetHours}시간`
              : `+${(offsetHours / 24).toFixed(1)}일`}
        </span>
      </div>
    {/if}
  </div>
</main>

<style>
  main {
    min-height: 100vh;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    /* 위젯에서 스크롤은 최후의 수단입니다. 창이 내용에 맞춰지므로 필요 없습니다 */
    overflow: hidden;
  }

  /* 브라우저 개발용 가짜 바탕화면. Tauri에서는 창이 투명해야 하므로 뺍니다 */
  .desktop {
    align-items: center;
    background:
      radial-gradient(680px 420px at 12% -5%, rgba(90, 80, 190, 0.34), transparent 62%),
      radial-gradient(560px 400px at 96% 108%, rgba(20, 120, 130, 0.28), transparent 60%),
      linear-gradient(160deg, #171a26 0%, #0d0f17 55%, #12111c 100%);
  }

  .panel {
    display: inline-flex;
    flex-direction: column;
    gap: 14px;
  }

  .columns {
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }

  .dragbar {
    display: flex;
    align-items: center;
    height: 18px;
    cursor: grab;
    /* 끌기 영역이 넓어야 잡기 쉽습니다. 위젯은 자주 옮기게 되니까요 */
    margin: -4px -4px -6px;
    padding: 0 4px;
  }

  .dragbar:active {
    cursor: grabbing;
  }

  .brand {
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.28);
    user-select: none;
  }

  .devbar {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .lbl,
  .val {
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: 10px;
    letter-spacing: 0.12em;
    color: rgba(255, 255, 255, 0.4);
    white-space: nowrap;
  }

  .val {
    color: #cfcbff;
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
    min-width: 62px;
  }

  input[type='range'] {
    -webkit-appearance: none;
    appearance: none;
    flex: 1;
    height: 18px;
    background: transparent;
    cursor: pointer;
  }

  input[type='range']::-webkit-slider-runnable-track {
    height: 3px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.18);
  }

  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: #cfcbff;
    margin-top: -5px;
    border: 2px solid #4a45b5;
  }
</style>
