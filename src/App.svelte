<script lang="ts">
  import SettingsPanel from './lib/components/SettingsPanel.svelte';
  import Column from './lib/components/Column.svelte';
  import QuickAdd from './lib/components/QuickAdd.svelte';
  import {
    addCategory,
    addTask,
    completeTask,
    init,
    moveCategory,
    nudgeZoom,
    removeCategory,
    renameCategory,
    markSeeded,
    setPerPage,
    setZoom,
    startClock,
    store,
    undo,
    undoLast,
    view,
    wasSeeded,
    ZOOM_STEPS,
  } from './lib/store.svelte';
  import { MS_HOUR } from './lib/urgency';
  import { maxTopicsPerPage } from './lib/layout';
  import { DEFAULTS, loadSettings, saveSettings, type Settings } from './lib/settings';
  import { runNotifications } from './lib/notify';
  import { installUpdate, onUpdateAvailable } from './lib/system';
  import { theme } from './lib/theme';
  import type { NewTask, Task } from './lib/types';

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

  /**
   * 방금 완료한 항목을 잠깐 띄웁니다.
   *
   * 이 팝업이 되돌릴 수 있는 범위를 정하는 건 아닙니다. 실제 범위는 store의
   * 되돌리기 스택이 쥐고 있고(최근 10개), 팝업은 방금 누른 것을 알아채게 하는
   * 역할만 합니다. 그래서 팝업이 사라져도 Ctrl+Z는 계속 듣습니다 — 버튼에
   * 단축키를 같이 적어 그 사실을 알립니다.
   */
  let toast = $state<{ title: string } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const UNDO_WINDOW = 7000;

  function onComplete(task: Task) {
    void completeTask(task);
    toast = { title: task.title };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), UNDO_WINDOW);
  }

  async function undoComplete() {
    if (!(await undoLast())) return;
    clearTimeout(toastTimer);
    toast = null;
  }

  /**
   * 열린 팝오버만큼 패널 아래에 자리를 잡아 둡니다.
   *
   * 달력과 시각 목록은 position:absolute라 패널 높이에 잡히지 않습니다. 창이
   * 패널 크기를 따라가고 넘치는 부분은 잘리므로, 할 일이 적어 기둥이 짧을 때는
   * 달력 아래쪽 두 줄이 창 밖으로 나가 눌리지 않았습니다.
   *
   * 자리를 QuickAdd 안이 아니라 패널 맨 아래에 잡습니다. 폼 안에 잡으면 달력을
   * 열 때마다 기둥이 통째로 밀려 내려가는데, 읽던 것이 움직이는 쪽이 잘리는
   * 것만큼 나쁩니다. 아래에 잡으면 창만 아래로 자라고 달력이 기둥을 덮습니다.
   *
   * 기준을 spacer의 위쪽 모서리로 잡는 것이 핵심입니다. 패널 바닥을 기준으로
   * 재면 자리를 넓힐수록 바닥이 내려가 다시 재게 되고 되먹임이 멈추지 않습니다.
   * spacer의 위쪽은 제 높이와 무관하므로 고정점이 됩니다.
   */
  /**
   * 기둥이 쓸 수 있는 높이.
   *
   * 화면 높이의 일부만 씁니다. 구역마다 '최대 몇 개'를 손으로 정하는 대신
   * 예산 하나를 주면, 몇 개가 들어가는지는 화면이 답합니다 — 노트북과 외부
   * 모니터에서 답이 다르니 사람이 미리 맞힐 수 있는 값이 아닙니다.
   *
   * 예산에서 밀려난 카드는 접히지 않고 구역 안에서 끌어 볼 수 있습니다.
   */
  let screenHeight = $state(1080);

  $effect(() => {
    const read = () => (screenHeight = window.screen?.availHeight || window.innerHeight);
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  });

  /**
   * 기둥 위아래로 늘 붙어 있는 것들(제목줄·입력줄·주제 편집·여백)의 높이.
   *
   * 재서 구합니다. 나열해서 더하면 편집 패널을 열고 닫을 때마다 빠뜨립니다.
   * 기둥이 줄면 패널도 같이 줄어 이 값은 그대로라, 되먹임이 생기지 않습니다.
   */
  let chromeHeight = $state(150);

  $effect(() => {
    if (!panel) return;
    const root = panel;
    const measure = () => {
      const col = root.querySelector('.column');
      if (!col) return;
      /**
       * 설정 카드는 빼고 잽니다.
       *
       * 넣어서 재면 설정을 열 때마다 기둥의 예산이 그만큼 깎여 위젯이 줄어듭니다.
       * 설정을 아래에 펼치기로 한 이유가 '무엇을 바꾸든 결과가 위에 그대로
       * 보이는 것'인데, 그 위젯이 쪼그라들면 앞뒤가 맞지 않습니다. 설정 영역은
       * 제 상한을 따로 가지고 있으므로 창은 예측 가능한 만큼만 커집니다.
       */
      const editor = root.querySelector('.editor');
      const gap =
        root.getBoundingClientRect().height -
        col.getBoundingClientRect().height -
        (editor?.getBoundingClientRect().height ?? 0);
      const next = Math.round(gap / (view.zoom || 1));
      if (Number.isFinite(next) && Math.abs(next - chromeHeight) > 1) chromeHeight = next;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  });

  const columnBudget = $derived(
    Math.round((screenHeight * theme.layout.maxHeightFraction) / (view.zoom || 1)) - chromeHeight
  );

  /**
   * 새 버전이 있으면 위젯이 직접 한 줄로 알립니다.
   *
   * 예전에는 트레이 메뉴 글자가 바뀌는 것이 유일한 통로였습니다. 열어 봐야
   * 보이고, 열어 볼 이유를 모르는 사람에게는 없는 것과 같았습니다. 시작할 때와
   * 6시간마다 같은 확인이 도니, 이 한 줄이 '켜져 있을 때'와 '껐다 켰을 때'를
   * 함께 덮습니다.
   *
   * 이 세션에서 닫으면 다시 띄우지 않습니다. 업데이트는 급한 일이 아니고,
   * 급하지 않은 것이 계속 말을 걸면 그때부터 잡음입니다.
   */
  let available = $state<string | null>(null);
  let installing = $state(false);

  $effect(() => {
    let stop: (() => void) | undefined;
    void onUpdateAvailable((v) => (available = v)).then((fn) => (stop = fn));
    return () => stop?.();
  });

  /** 알림·시스템 설정. 파일에서 읽어 오고, 바꾸면 바로 저장합니다 */
  let settings = $state<Settings>({ ...DEFAULTS });

  $effect(() => {
    void loadSettings().then((saved) => (settings = saved));
  });

  function patchSettings(patch: Partial<Settings>) {
    settings = { ...settings, ...patch };
    void saveSettings(settings);
  }

  /**
   * 시계가 움직일 때마다 알림을 살핍니다.
   *
   * 시각을 미리 예약하지 않습니다. 예약해 두면 절전에서 깨어났을 때, 마감을
   * 고쳤을 때, 할 일을 지웠을 때마다 예약을 손봐야 하고 그중 하나만 빠뜨려도
   * 엉뚱한 알림이 갑니다. 매 틱에 지금 상태를 보고 판단하면 그런 어긋남이
   * 생길 자리가 없습니다.
   */
  $effect(() => {
    const at = store.now;
    void runNotifications(store.tasks, store.categories, settings, at);
  });

  /**
   * 설정 영역이 쓸 수 있는 높이.
   *
   * 주제가 몇 개든 이 상한을 넘지 않으므로, 설정을 열었을 때 창이 얼마나
   * 커질지 예측 가능합니다. 넘치는 만큼은 영역 안에서 끌어 봅니다.
   */
  const settingsBudget = $derived(Math.round((screenHeight * 0.3) / (view.zoom || 1)));

  /** 팝오버 아래 숨 쉴 자리. 창 모서리에 딱 붙으면 잘린 것처럼 보입니다 */
  const SHEET_MARGIN = 10;

  let openSheet = $state<HTMLElement | null>(null);
  let spacer: HTMLElement | undefined = $state();
  let reserve = $state(0);

  $effect(() => {
    const sheet = openSheet;
    const anchor = spacer;
    if (!sheet || !anchor) {
      reserve = 0;
      return;
    }

    /**
     * getBoundingClientRect는 배율이 곱해진 화면 픽셀을 돌려주는데, spacer는
     * 배율이 걸린 패널 *안에* 있어서 지정한 높이에 배율이 한 번 더 곱해집니다.
     * 나눠 주지 않으면 150%에서 필요한 자리의 1.5배를 잡아 창 아래가 텅 빕니다.
     */
    const measure = () => {
      const scale = view.zoom || 1;
      const over = (sheet.getBoundingClientRect().bottom - anchor.getBoundingClientRect().top) / scale;
      reserve = over > 0 ? Math.ceil(over) + SHEET_MARGIN : 0;
    };

    // 붙자마자 한 번, 다음 프레임에 한 번 더 잽니다. 첫 프레임에는 달력이
    // 아직 자리를 잡는 중이라 몇 px 작게 잡히는 때가 있습니다.
    measure();
    const frame = requestAnimationFrame(measure);

    // 달을 넘기면 주 수가 바뀌어 달력 높이가 변합니다
    const observer = new ResizeObserver(measure);
    observer.observe(sheet);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  });

  $effect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = mq.matches;
    const on = () => (reducedMotion = mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });

  /**
   * 창은 숨은 채로 떠서, 내용에 맞는 크기를 잡은 뒤에 나타납니다.
   *
   * tauri.conf.json의 620×520은 창이 태어나는 크기일 뿐 맞는 크기가 아닙니다.
   * 실제 크기는 할 일이 몇 개인지, 배율이 얼마인지에 달려 있어서 설정 파일이
   * 미리 알 수 없습니다. 보이는 채로 띄우면 저장된 데이터를 읽어 오는 동안
   * 620×520에 눌린 화면이 먼저 보이고, 그게 "처음 켜면 잘려 보인다"의 정체입니다.
   */
  let revealed = false;

  async function revealWindow() {
    if (revealed || !inTauri) return;
    revealed = true;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().show();
  }

  /** Svelte가 DOM을 갱신하고 브라우저가 배치를 끝낼 때까지 기다립니다 */
  const settled = () =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );

  $effect(() => {
    void init()
      .then(seedIfEmpty)
      .then(settled)
      .then(fitWindow)
      .catch(() => {})
      // 크기를 못 맞췄더라도 창은 반드시 보여야 합니다.
      // 잘려 보이는 편이 안 보이는 것보다 낫습니다.
      .finally(revealWindow);

    return startClock();
  });

  // Ctrl+휠로 배율을 바꿉니다. 브라우저에서 몸에 밴 동작이라 설명이 필요 없습니다.
  $effect(() => {
    const on = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      nudgeZoom(e.deltaY < 0 ? 1 : -1);
    };
    window.addEventListener('wheel', on, { passive: false });
    return () => window.removeEventListener('wheel', on);
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
      // 되돌리기는 Ctrl+Z여야 합니다. 다른 곳에서 몸에 밴 동작입니다.
      // 팝업이 떠 있는지와 무관하게, 스택에 남아 있으면 듣습니다.
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && undo.stack.length > 0) {
        e.preventDefault();
        void undoComplete();
      }

      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        nudgeZoom(1);
      }
      if (e.key === '-') {
        e.preventDefault();
        nudgeZoom(-1);
      }
      if (e.key === '0') {
        e.preventDefault();
        setZoom(1);
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

  /**
   * 패널 크기를 직접 관찰합니다.
   *
   * 어떤 상태가 바뀌면 창을 다시 맞출지 일일이 나열하면 반드시 빠뜨립니다.
   * 실제로 주제 편집을 열 때 높이가 변하는데도 창이 따라오지 않았습니다.
   * 크기 변화 자체를 신호로 삼으면 원인이 무엇이든 놓치지 않습니다.
   */
  $effect(() => {
    if (!inTauri || !panel) return;
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => void fitWindow());
    });
    observer.observe(panel);
    return () => observer.disconnect();
  });

  async function seedIfEmpty() {
    if (store.tasks.length > 0) return;
    if (await wasSeeded()) return;
    await markSeeded();

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

  <!-- 배율은 창 크기가 아니라 여기서 정합니다. zoom은 transform과 달리 레이아웃
       단계에 반영되므로 마감선·축선 같은 1px 선이 축소에서 사라지지 않습니다. -->
  <div class="panel" bind:this={panel} style:zoom={view.zoom}>
    <div class="dragbar" data-tauri-drag-region={inTauri ? true : undefined}>
      <span class="brand" data-tauri-drag-region={inTauri ? true : undefined}>
        <span style:color={theme.surface.brandWarm}>GRAVI</span><span
          style:color={theme.surface.brandCool}>TASK</span
        >
      </span>

      <!--
        버튼 하나만 둡니다. 75% 배율에서 위젯이 300px까지 좁아지는데
        GRAVITASK에 버튼이 둘이면 붐빕니다. 배율 조절도 패널 안으로 옮겼습니다 —
        '주제 편집'이라는 이름 아래 주제 아닌 것들이 들어가면 이름이 거짓말이 되므로
        버튼은 '설정'이고, 갈래는 패널 안에서 나눕니다.
      -->
      <button
        class="edit-toggle"
        class:on={editing}
        aria-pressed={editing}
        title={editing ? '설정 닫기' : '설정'}
        onclick={() => (editing = !editing)}
      >
        {editing ? '완료' : '설정'}
      </button>
    </div>

    <QuickAdd
      bind:this={quickAdd}
      categories={sorted}
      bind:categoryId
      bind:openSheet
      now={store.now}
      onAdd={addTask}
    />


    <Column
      tasks={store.tasks}
      categories={sorted}
      now={store.now}
      {reducedMotion}
      budget={columnBudget}
      zoom={view.zoom}
      perPage={view.perPage}
      onToggle={onComplete}
    />

    {#if editing}
      <SettingsPanel
        categories={sorted}
        tasks={store.tasks}
        perPage={view.perPage}
        maxPerPage={maxTopicsPerPage()}
        zoom={view.zoom}
        zoomSteps={ZOOM_STEPS}
        onAdd={() => addCategory()}
        onRename={renameCategory}
        onMove={moveCategory}
        onRemove={removeCategory}
        onPerPage={setPerPage}
        onZoom={nudgeZoom}
        {settings}
        onSettings={patchSettings}
        maxHeight={settingsBudget}
        zoomFactor={view.zoom}
      />
    {/if}

    {#if available}
      <div class="undo notice">
        <span class="done-title">새 버전 v{available}</span>
        <button
          disabled={installing}
          onclick={() => {
            installing = true;
            void installUpdate().catch(() => (installing = false));
          }}>{installing ? '설치 중…' : '설치'}</button
        >
        <button class="dismiss" aria-label="닫기" onclick={() => (available = null)}>✕</button>
      </div>
    {/if}

    {#if toast}
      <div class="undo">
        <span class="done-title">완료 · {toast.title}</span>
        <button onclick={() => void undoComplete()}>되돌리기 <kbd>Ctrl+Z</kbd></button>
      </div>
    {/if}

    <!-- 열린 팝오버가 창 밖으로 잘리지 않도록 잡아 두는 자리 -->
    <div class="reserve" bind:this={spacer} style:height="{reserve}px" aria-hidden="true"></div>
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
  /* 패널의 flex gap이 빈 자리에도 붙으므로 그만큼 되돌립니다.
     자리를 잡지 않은 평소에 14px이 그냥 낭비되면 안 됩니다. */
  .reserve {
    flex: none;
    margin-top: -14px;
  }

  /**
   * 오른쪽 끝에 붙습니다. 눈에 띄어야 합니다 — 주제가 하드코딩처럼 보이면
   * 사용자는 자기 용도로 바꿀 수 있다는 걸 아예 모르고 지나갑니다.
   */
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

  .undo {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 11px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.14);
  }

  .done-title {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.72);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .undo button {
    flex: none;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    color: #cfcbff;
    background: rgba(90, 80, 190, 0.32);
    border: 1px solid rgba(160, 150, 255, 0.45);
    border-radius: 7px;
    padding: 4px 10px;
    cursor: pointer;
  }

  .undo button:hover {
    background: rgba(90, 80, 190, 0.5);
  }

  /* 팝업은 7초 뒤 사라지지만 Ctrl+Z는 계속 듣습니다.
     그 사실을 알 방법이 여기 적어두는 것 말고는 없습니다. */
  /* 되돌리기 팝업과 같은 자리, 같은 모양. 다만 재촉하지 않도록 색은 씁니다 */
  .notice {
    border-color: rgba(160, 150, 255, 0.35);
  }

  .dismiss {
    padding: 4px 8px !important;
    color: rgba(255, 255, 255, 0.6) !important;
    background: transparent !important;
    border-color: transparent !important;
  }

  .dismiss:hover {
    color: #fff !important;
  }

  .undo kbd {
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: 10px;
    font-weight: 500;
    opacity: 0.65;
    margin-left: 3px;
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
