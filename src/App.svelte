<script lang="ts">
  import CategoryEditor from './lib/components/CategoryEditor.svelte';
  import Column from './lib/components/Column.svelte';
  import QuickAdd from './lib/components/QuickAdd.svelte';
  import {
    addCategory,
    addTask,
    moveCategory,
    refresh,
    removeCategory,
    renameCategory,
    startClock,
    store,
    toggleTask,
  } from './lib/store.svelte';
  import { MS_HOUR } from './lib/urgency';
  import { theme } from './lib/theme';
  import type { NewTask } from './lib/types';

  // 창 테두리를 없앴기 때문에 앱 안에서 끌 수 있는 영역을 직접 제공해야 합니다.
  const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const PAD = inTauri ? 12 : 32;

  let categoryId = $state(store.categories[0]?.id ?? 'study');
  let quickAdd: QuickAdd | undefined = $state();
  let reducedMotion = $state(false);
  let panel: HTMLElement | undefined = $state();

  /** 마우스가 올라와 있거나 포커스를 쥐고 있으면 조작 중으로 봅니다 */
  let hovering = $state(false);
  let focused = $state(false);
  const interacting = $derived(hovering || focused);

  /** 편집 모드. 평소에는 위젯을 깔끔하게 두고, 손댈 때만 조작부를 드러냅니다 */
  let editing = $state(false);

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

  // 브라우저 개발용. Tauri에서는 아래 전역 단축키가 같은 일을 합니다.
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

  // 전역 단축키(Ctrl+Alt+G)로 창이 떠오르면 입력칸에 커서를 둡니다.
  // 창만 띄우고 커서가 없으면 결국 클릭하러 가야 해서 반쪽짜리입니다.
  $effect(() => {
    if (!inTauri) return;
    let stop: (() => void) | undefined;
    void import('@tauri-apps/api/event').then(({ listen }) =>
      listen('gravitask://focus-input', () => quickAdd?.focus()).then((un) => {
        stop = un;
      })
    );
    return () => stop?.();
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
    // 내용이 바뀌면 창 크기도 따라갑니다.
    void store.tasks;
    void store.categories;
    void store.now;
    if (!inTauri) return;
    // 타이머로 미루면 그 사이 내용이 창보다 커져 스크롤바가 번쩍입니다.
    // 다음 프레임에 바로 맞춥니다.
    const id = requestAnimationFrame(() => void fitWindow());
    return () => cancelAnimationFrame(id);
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


  const sorted = $derived([...store.categories].sort((a, b) => a.order - b.order));
</script>

<main
  class:desktop={!inTauri}
  class:active={interacting}
  style:padding="{PAD}px"
  style:--backdrop={theme.surface.backdrop}
  style:--backdrop-edge={theme.surface.backdropEdge}
  onmouseenter={() => (hovering = true)}
  onmouseleave={() => (hovering = false)}
>
  <!-- 배경판을 별도 레이어로 둡니다. background 색을 직접 전환하면 투명 창에서
       매끄럽지 않은데, opacity는 GPU 합성이라 확실히 부드럽습니다. -->
  <div class="backdrop" aria-hidden="true"></div>

  <div class="panel" bind:this={panel}>
    <div class="dragbar" data-tauri-drag-region={inTauri ? true : undefined}>
      <span class="brand" data-tauri-drag-region={inTauri ? true : undefined}>
        <span style:color={theme.surface.brandWarm}>GRAVI</span><span
          style:color={theme.surface.brandCool}>TASK</span
        >
      </span>
      <button
        class="edit-toggle"
        class:on={editing}
        aria-pressed={editing}
        title={editing ? '편집 끝내기' : '주제 편집'}
        onclick={() => (editing = !editing)}
      >
        {editing ? '완료' : '주제 편집'}
      </button>
    </div>

    <QuickAdd
      bind:this={quickAdd}
      categories={sorted}
      bind:categoryId
      now={store.now}
      onAdd={addTask}
    />

    {#if editing}
      <CategoryEditor
        categories={sorted}
        tasks={store.tasks}
        onAdd={() => addCategory()}
        onRename={renameCategory}
        onMove={moveCategory}
        onRemove={removeCategory}
      />
    {/if}

    <Column
      tasks={store.tasks}
      categories={sorted}
      now={store.now}
      {reducedMotion}
      onToggle={toggleTask}
    />

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
    position: relative;
  }

  /* 조작 중에는 위젯 뒤에 판을 깝니다. 카드 표면만 진하게 하면 카드 사이로
     배경화면이 그대로 비쳐 오히려 산만합니다. */
  .backdrop {
    position: fixed;
    inset: 0;
    border-radius: 18px;
    background: linear-gradient(165deg, var(--backdrop-edge), var(--backdrop));
    border: 1px solid rgba(255, 255, 255, 0.09);
    opacity: 0;
    pointer-events: none;
    /* 나갈 때. 천천히 물러나야 잔상이 남고 전환이 부드럽게 느껴집니다 */
    transition: opacity 0.42s cubic-bezier(0.33, 0, 0.67, 1);
  }

  main.active .backdrop {
    opacity: 1;
    /* 들어올 때. 손을 올린 즉시 반응해야 조작감이 붙습니다 */
    transition: opacity 0.13s cubic-bezier(0.3, 0, 0.2, 1);
  }

  @media (prefers-reduced-motion: reduce) {
    .backdrop {
      transition: none;
    }
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
    /* backdrop이 position:fixed라 그냥 두면 패널 위에 덮입니다 */
    position: relative;
    z-index: 1;
  }


  /* 눈에 띄어야 합니다. 주제가 하드코딩처럼 보이면 사용자는 자기 용도로
     바꿀 수 있다는 걸 아예 모르고 지나갑니다. */
  .edit-toggle {
    margin-left: auto;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.72);
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    padding: 5px 12px;
    cursor: pointer;
  }

  .edit-toggle:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.16);
    border-color: rgba(255, 255, 255, 0.45);
  }

  .edit-toggle.on {
    color: #cfcbff;
    border-color: rgba(160, 150, 255, 0.55);
    background: rgba(90, 80, 190, 0.28);
  }


  .dragbar {
    display: flex;
    align-items: center;
    height: 28px;
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
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.16em;
    user-select: none;
  }






</style>
