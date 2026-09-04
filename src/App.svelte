<script lang="ts">
  import SettingsPanel from './lib/components/SettingsPanel.svelte';
  import Column from './lib/components/Column.svelte';
  import QuickAdd from './lib/components/QuickAdd.svelte';
  import CardMenu from './lib/components/CardMenu.svelte';
  import {
    addCalendar,
    addCategory,
    addTask,
    calendars,
    endRepeat,
    completeTask,
    init,
    moveCategory,
    nudgeZoom,
    removeCalendar,
    removeCategory,
    removeTask,
    renameCategory,
    startCalendarPolling,
    syncCalendars,
    markSeeded,
    setPerPage,
    setZoom,
    startClock,
    store,
    undo,
    undoLast,
    updateTask,
    view,
    wasSeeded,
    ZOOM_STEPS,
  } from './lib/store.svelte';
  import { isMac, MOD_LABEL } from './lib/platform';
  import { MS_HOUR } from './lib/urgency';
  import { maxTopicsPerPage } from './lib/layout';
  import { DEFAULTS, loadSettings, saveSettings, type Settings } from './lib/settings';
  import { runNotifications } from './lib/notify';
  import { installUpdate, onUpdateAvailable } from './lib/system';
  import { theme } from './lib/theme';
  import type { Repeat } from './lib/repeat';
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
  let toast = $state<{ title: string; kind: 'complete' | 'delete' } | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const UNDO_WINDOW = 7000;

  /**
   * 카드가 빠지는 동안 남은 카드들을 붙잡아 둡니다.
   *
   * 빠지는 애니메이션과 내려앉음이 겹치면 무엇이 사라졌는지 눈이 놓칩니다.
   * 빠지는 쪽이 끝난 뒤에 나머지가 움직이면 순서가 읽힙니다.
   */
  let settleDelay = $state(0);
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  function holdSettle() {
    if (reducedMotion) return;
    settleDelay = theme.motion.completeMs;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => (settleDelay = 0), theme.motion.completeMs);
  }

  function flash(title: string, kind: 'complete' | 'delete') {
    toast = { title, kind };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), UNDO_WINDOW);
  }

  function onComplete(task: Task) {
    holdSettle();
    void completeTask(task);
    flash(task.title, 'complete');
  }

  async function undoComplete() {
    if (!(await undoLast())) return;
    clearTimeout(toastTimer);
    toast = null;
  }

  /* ---------- 카드 우클릭: 수정과 삭제 ---------- */

  let menu = $state<{ task: Task; x: number; y: number } | null>(null);

  /**
   * 고치는 중인 항목.
   *
   * 이름이 editTarget인 것은 이 파일에 이미 editing이 있기 때문입니다 —
   * 그쪽은 설정 화면이 열렸는지를 가리킵니다.
   */
  let editTarget = $state<Task | null>(null);

  function startEdit(task: Task) {
    menu = null;
    editTarget = task;
  }

  function onDelete(task: Task) {
    menu = null;
    // 지우는 항목을 고치던 중이었다면 그 상태도 함께 놓아 줍니다.
    if (editTarget?.id === task.id) editTarget = null;
    holdSettle();
    void removeTask(task);
    flash(task.title, 'delete');
  }

  function commitEdit(
    id: string,
    patch: { title: string; due: number; categoryId: string; repeat?: Repeat }
  ) {
    void updateTask(id, patch);
    editTarget = null;
  }

  /**
   * 반복만 뗍니다. 카드는 그대로 남습니다.
   *
   * 되돌리기 팝업을 띄우지 않습니다. 완료·삭제와 달리 눈앞에서 사라지는 것이
   * 없어서 팝업이 알려 줄 것이 없고, 되돌리려면 그 카드를 다시 우클릭해
   * 수정에서 반복을 걸면 됩니다 — 방금 한 일이 화면에 그대로 있으니까요.
   */
  function onEndRepeat(task: Task) {
    menu = null;
    void endRepeat(task);
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
   *
   * 다만 '늘 붙어 있는 것'만 셉니다. 높이가 오르내리는 것을 여기 넣으면 그
   * 오르내림이 그대로 기둥의 예산이 되어, 손만 올려도 눈금이 다시 짜입니다.
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
      /**
       * 마감·반복 줄도 뺍니다.
       *
       * 이 줄들은 손을 올리면 나타나고 떼면 사라집니다. 그대로 세면 chrome이
       * 67px씩 오르내리고, 그만큼 기둥의 예산이 깎였다 늘었다 합니다. 예산이
       * 바뀌면 구역 높이가 다시 나뉘므로, 마우스를 스치기만 해도 카드가
       * 재배치되고 지남 구역의 카드가 밀려납니다.
       *
       * 빼고 재면 예산은 접히든 펴지든 같은 값입니다. 펼친 동안에는 위젯이
       * 의도한 상한보다 67px 커지지만, 그건 손을 대고 있는 잠깐이고
       * 눈금이 흔들리는 것과는 견줄 일이 아닙니다.
       */
      const reveal = root.querySelector('.reveal');
      const gap =
        root.getBoundingClientRect().height -
        col.getBoundingClientRect().height -
        (editor?.getBoundingClientRect().height ?? 0) -
        (reveal?.getBoundingClientRect().height ?? 0);
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
      .catch((err) => console.error('첫 배치 실패', err))
      // 크기를 못 맞췄더라도 창은 반드시 보여야 합니다.
      // 잘려 보이는 편이 안 보이는 것보다 낫습니다.
      .finally(revealWindow);

    return startClock();
  });

  // 구독한 캘린더를 주기적으로 받아 옵니다
  $effect(() => startCalendarPolling());

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
      // Esc는 안쪽부터 벗깁니다. 달력이나 시각 목록이 열려 있으면 QuickAdd가
      // 먼저 그것을 닫고, 여기까지 올라오면 수정 모드를 놓습니다.
      if (e.key === 'Escape' && editTarget) {
        editTarget = null;
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
      listen('gravitask://focus-input', () => {
        // 이 단축키는 언제나 같은 상태를 보장합니다 — 빈 입력칸, 커서,
        // 추가 준비. 수정 중이었다면 놓습니다.
        //
        // 그러지 않으면 사용자는 새 할 일을 적는다고 믿으면서 기존 항목을
        // 덮어씁니다. 여기서 버리는 것은 아직 확정하지 않은 초안이지만,
        // 반대쪽에서 잃는 것은 이미 저장된 값입니다.
        editTarget = null;
        quickAdd?.focus();
      }).then((un) => {
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
   *
   * ---
   *
   * 창은 왼쪽 위를 붙들고 크기만 바꿉니다. 사용자가 놓아둔 자리는 사용자의
   * 것이고, 위젯이 스스로 옮겨 다니지 않습니다.
   *
   * 한때는 마감·반복 줄이 접히고 펴질 때 그만큼 창을 위아래로 옮겨 기둥을
   * 화면에 붙들어 두었습니다. 계산은 맞았지만 전제가 틀렸습니다 — 이 위젯을
   * 화면 꼭대기에 붙여 두면 창이 올라갈 자리가 없어 결국 기둥이 내려앉는데,
   * 그러면서 창 위치까지 건드립니다. 얻는 것 없이 잃기만 하는 자리가 있는
   * 겁니다.
   *
   * 게다가 자리에 따라 동작이 갈립니다. 가운데에 두면 기둥이 가만히 있고
   * 위에 두면 움직이는 물건은, 손이 기억할 규칙을 주지 못합니다. 위젯은
   * 눈보다 손이 먼저 아는 물건이라 그 일관성이 62px보다 값집니다.
   *
   * 그래서 헤더는 아래로 자랍니다. 기둥이 그만큼 밀려 내려가지만 200ms에
   * 걸쳐 미끄러지므로 튀지 않고, 창은 놓아둔 자리에 그대로 있습니다.
   */
  async function fitWindow() {
    if (!inTauri || !panel) return;
    const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window');
    const rect = panel.getBoundingClientRect();
    const width = Math.ceil(rect.width) + PAD * 2;
    const height = Math.ceil(rect.height) + PAD * 2;
    const win = getCurrentWindow();

    try {
      await win.setSize(new LogicalSize(width, height));
    } catch (err) {
      // 조용히 지나가면 창이 내용과 어긋난 채로 남고, 사용자는 위젯 주위에
      // 설명 없는 여백을 봅니다. 무엇을 요청했는지까지 함께 적습니다 —
      // 실패했다는 사실만으로는 요청한 크기가 틀렸는지 창이 거부한 것인지
      // 갈리지 않습니다.
      console.error(`창 크기 ${width}x${height} 맞추기 실패`, err);
    }
  }

  /**
   * 패널 크기를 직접 관찰합니다.
   *
   * 어떤 상태가 바뀌면 창을 다시 맞출지 일일이 나열하면 반드시 빠뜨립니다.
   * 실제로 주제 편집을 열 때 높이가 변하는데도 창이 따라오지 않았습니다.
   * 크기 변화 자체를 신호로 삼으면 원인이 무엇이든 놓치지 않습니다.
   */
  /**
   * 한 프레임에 한 번만, 그리고 겹치지 않게 맞춥니다.
   *
   * 마감·반복 줄이 미끄러지는 200ms 동안 패널 높이가 매 프레임 바뀌므로
   * 관찰자도 매 프레임 웁니다. 울 때마다 새 프레임을 잡으면 한 프레임에 여러
   * 번 맞추게 되고, fitWindow는 창 위치를 읽고 쓰는 비동기 작업이라 겹쳐
   * 돌면 앞선 것이 읽어 둔 위치가 이미 옛것이 됩니다 — 그러면 창이 조금씩
   * 어긋나게 밀립니다.
   *
   * 프레임당 한 번으로 묶고, 도는 중에 또 부탁이 오면 끝난 뒤 한 번 더
   * 돕니다. 마지막 부탁이 반드시 반영되면서 겹치지는 않습니다.
   */
  let fitQueued = false;
  let fitting = false;
  let fitAgain = false;

  async function requestFit() {
    if (fitting) {
      fitAgain = true;
      return;
    }
    fitting = true;
    try {
      do {
        fitAgain = false;
        await fitWindow();
      } while (fitAgain);
    } finally {
      fitting = false;
    }
  }

  $effect(() => {
    if (!inTauri || !panel) return;
    const observer = new ResizeObserver(() => {
      if (fitQueued) return;
      fitQueued = true;
      requestAnimationFrame(() => {
        fitQueued = false;
        void requestFit();
      });
    });
    observer.observe(panel);
    return () => observer.disconnect();
  });

  /**
   * 처음 켠 화면을 안내로 채웁니다.
   *
   * 예전에는 그럴듯한 가짜 할 일을 넣었습니다. 그런데 이 위젯에서 카드의
   * 자리는 시간에 대한 주장입니다 — "발표 자료 준비 2일 뒤"는 읽는 사람의
   * 일정에 대해 거짓을 말합니다. 사용자는 매번 "내가 이걸 적었나"를 판단해야
   * 했습니다.
   *
   * 안내 카드는 자기가 서 있는 자리를 설명하므로 그 주장이 참입니다. 24시간
   * 안쪽 카드는 정말로 24시간 안쪽에 있고, 기한 지난 카드는 정말로 지났습니다.
   *
   * 문구는 명사로 끝냅니다. 진짜 할 일 제목이 그렇게 생겼기 때문입니다.
   * 그리고 '대기'나 '활주로' 같은 말은 쓰지 않습니다 — 그건 우리가 설계하며
   * 붙인 이름이지 사용자가 화면에서 볼 수 있는 것이 아닙니다. 보이는 것으로만
   * 씁니다: 맨 아래, 왼쪽 동그라미, 우클릭.
   *
   * 레인 폭이 158px이라 제목에 쓸 수 있는 것은 114px, 한글 여덟 자
   * 남짓입니다. 대부분의 문구가 여기를 넘는데 줄이지 않았습니다 — 잘린
   * 제목은 손을 올리게 만들고, 올리면 카드가 펼쳐지는 것까지 같이 알게
   * 됩니다. 안내가 자기 자신을 가르치는 셈입니다.
   *
   * 구역을 가리키는 둘만 줄였습니다. 원래 문구가 172px과 155px이라 앞부분만
   * 남으면 무슨 구역인지가 사라졌습니다.
   */
  async function seedIfEmpty() {
    if (store.tasks.length > 0) return;
    if (await wasSeeded()) return;
    await markSeeded();

    const now = Date.now();
    // 휠 확대는 Windows가 Ctrl, macOS가 ⌘입니다. 안내가 자기 화면에서 통하지
    // 않으면 안내가 아니라 혼란입니다.
    const zoomKey = isMac ? '⌘' : 'Ctrl';

    const demo: NewTask[] = [
      // 아래 둘은 그 구역에 실제로 서야 문구가 참이 됩니다.
      { title: '기한 만료 구역', due: now - 4 * MS_HOUR, categoryId: 'life' },
      { title: '24시간 안쪽 구역', due: now + 3 * MS_HOUR, categoryId: 'study' },
      // 이 카드가 나머지를 치우는 도구입니다. 쓰이면서 자기도 사라집니다.
      { title: '우클릭으로 수정,삭제', due: now + 48 * MS_HOUR, categoryId: 'study' },
      { title: '버튼을 클릭해서 완료', due: now + 144 * MS_HOUR, categoryId: 'life' },
      { title: '설정에서 주제 편집', due: now + 216 * MS_HOUR, categoryId: 'study' },
      { title: '외부 캘린더 연동 가능', due: now + 384 * MS_HOUR, categoryId: 'life' },
      { title: `크기 조절 ${zoomKey}+휠`, due: now + 624 * MS_HOUR, categoryId: 'study' },
    ];
    for (const t of demo) await addTask(t);
  }


  /**
   * 마감·반복 줄을 펼쳐야 하는가.
   *
   * 손을 댔거나, 설정이 열려 있거나, 고치는 중인 카드가 있을 때입니다.
   * 뒤의 둘을 빼면 안 됩니다 — 설정을 열어 둔 채 마우스를 치우거나, 카드를
   * 고치다 다른 창을 잠깐 보면, 방금 정한 마감과 반복이 눈앞에서 사라집니다.
   *
   * 전역 단축키(Ctrl+Alt+G)는 따로 다룰 것이 없습니다. 그게 입력칸에 커서를
   * 두므로 focused가 켜지고, 그러면 여기가 저절로 펼쳐집니다.
   */
  const wantsRows = $derived(interacting || editing || editTarget !== null);

  /** 펼치고 접는 데 걸리는 시간. 창이 그만큼 따라 움직입니다 */
  const REVEAL_MS = 200;

  /**
   * 접는 데는 뜸을 들입니다.
   *
   * 펼치는 것은 즉시입니다 — 손을 올렸는데 기다리게 하면 굼떠 보입니다.
   * 접는 쪽만 늦춥니다. 위젯 위를 스쳐 지나가거나, 입력칸에서 칩으로 손을
   * 옮기다 잠깐 바깥을 지나는 일이 흔한데, 그때마다 줄이 닫혔다 열리면
   * 창까지 따라 움직여서 어지럽습니다.
   */
  const HIDE_DELAY_MS = 320;

  let showRows = $state(false);

  $effect(() => {
    if (wantsRows) {
      showRows = true;
      return;
    }
    const timer = setTimeout(() => (showRows = false), HIDE_DELAY_MS);
    return () => clearTimeout(timer);
  });

  const compact = $derived(!showRows);

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
      <!--
        로고에 색을 쓰지 않습니다.
        이 위젯에서 색은 마감 하나를 뜻합니다. 주제에 색을 안 준 이유가 그것인데
        ("이 색이 급하다는 뜻인지 주제라는 뜻인지 헷갈립니다") 로고에도 같은 말이
        적용됩니다. 게다가 예전 로고의 주황(#E8913C)은 긴급도 램프의 '곧'과 '임박'
        사이에 있는 색이었습니다 — 절대 급함을 뜻하면 안 되는 자리가 급함의 색을
        입고 있었던 셈입니다.

        나누지도 않습니다. 한때 두 낱말이 읽히도록 밝기를 갈랐지만, 이름의
        말장난은 README 첫 줄이 설명하지 로고가 하는 일이 아닙니다. 12px 끌기
        막대의 라벨은 아무도 들여다보지 않고, 거기서의 미묘한 차이는 의도가
        아니라 렌더링 사고처럼 보입니다.

        조용한 게 이 위젯의 일입니다. 이름은 그냥 이름으로 둡니다.
      -->
      <span class="brand" data-tauri-drag-region={inTauri ? true : undefined}>
        <!--
          앱 아이콘과 같은 구조지만 작은 크기용으로 다시 그린 것입니다.

          아이콘 쪽은 투명도로 깊이를 줍니다 — 먼 것은 흐리고 지나간 것은 더
          흐립니다. 그런데 12px에서는 막대 하나가 1.1픽셀이라, 거기에 0.38을
          곱하면 잉크가 반 픽셀도 안 남아 사라집니다.

          그래서 여기서는 전부 불투명하게 두고 막대를 두껍게 그립니다. 깊이는
          포기하고 실루엣을 얻습니다 — 이 크기에서 사람이 읽는 것은 구조가
          아니라 모양이고, 뜻은 아이콘 크기에서 전해지면 됩니다.

          currentColor를 쓰므로 글자 색이 바뀌면 같이 바뀝니다.
        -->
        <svg class="mark" viewBox="0 0 100 100" aria-hidden="true">
          <g transform="translate(0 1.5)">
            <rect x="24" y="8" width="52" height="13" rx="6" />
            <rect x="24" y="33" width="52" height="13" rx="6" />
            <rect x="8" y="52" width="84" height="16" rx="8" />
            <rect x="24" y="76" width="52" height="13" rx="6" />
          </g>
        </svg>
        GRAVITASK
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
      editing={editTarget}
      onEdit={commitEdit}
      onCancelEdit={() => (editTarget = null)}
      {compact}
      revealMs={reducedMotion ? 0 : REVEAL_MS}
    />


    <Column
      tasks={store.tasks}
      categories={sorted}
      now={store.now}
      {reducedMotion}
      budget={columnBudget}
      zoom={view.zoom}
      perPage={view.perPage}
      {settleDelay}
      heldId={editTarget?.id ?? null}
      onToggle={onComplete}
      onMenu={(task, x, y) => (menu = { task, x, y })}
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
        calendars={calendars.list}
        onAddCalendar={addCalendar}
        onAddTopic={(name) => addCategory(name)}
        onRemoveCalendar={(id) => void removeCalendar(id)}
        onSyncCalendars={() => void syncCalendars()}
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
        <span class="done-title">{toast.kind === 'delete' ? '지움' : '완료'} · {toast.title}</span>
        <button onclick={() => void undoComplete()}>되돌리기 <kbd>{MOD_LABEL}Z</kbd></button>
      </div>
    {/if}

    <!-- 열린 팝오버가 창 밖으로 잘리지 않도록 잡아 두는 자리 -->
    <div class="reserve" bind:this={spacer} style:height="{reserve}px" aria-hidden="true"></div>
  </div>
</main>

<!-- 메뉴는 main 밖에 둡니다. 안에 두면 clip-path와 overflow가 걸린 구역들
     안쪽에서 열려 잘립니다. 어차피 커서 좌표에 붙는 물건이라 자리도 자유롭습니다. -->
{#if menu}
  <CardMenu
    task={menu.task}
    x={menu.x}
    y={menu.y}
    onEdit={startEdit}
    onDelete={onDelete}
    {onEndRepeat}
    onClose={() => (menu = null)}
  />
{/if}

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
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.16em;
    user-select: none;
  }

  /* 끌기는 부모가 받습니다. 마크가 그 위에 얹혀 있으면 여기를 잡았을 때
     창이 안 움직이므로, 마우스를 통과시킵니다. */
  .mark {
    width: 12px;
    height: 12px;
    flex: none;
    fill: currentColor;
    pointer-events: none;
  }






</style>
