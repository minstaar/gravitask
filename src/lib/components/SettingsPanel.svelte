<script lang="ts">
  import { theme } from '../theme';
  import {
    checkUpdate,
    installUpdate,
    isAutostartOn,
    onUpdateProgress,
    setAutostart,
  } from '../system';
  import type { Settings } from '../settings';
  import type { Subscription } from '../subscriptions';
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
    settings,
    onSettings,
    calendars,
    onAddCalendar,
    onAddTopic,
    onRemoveCalendar,
    onSyncCalendars,
    maxHeight,
    zoomFactor = 1,
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
    settings: Settings;
    onSettings: (patch: Partial<Settings>) => void;
    calendars: Subscription[];
    onAddCalendar: (url: string, categoryId: string) => Promise<void>;
    /** 새 주제를 만들고 그 id를 돌려줍니다 */
    onAddTopic: (name: string) => string;
    onRemoveCalendar: (id: string) => void;
    onSyncCalendars: () => void;
    /** 이 영역이 쓸 수 있는 최대 높이. 넘치는 만큼은 끌어서 봅니다 */
    maxHeight: number;
    /** 배율. 끄는 거리를 화면 픽셀에서 CSS 픽셀로 되돌리는 데 씁니다 */
    zoomFactor?: number;
  } = $props();

  // 할 일이 남아 있으면 지울 수 없습니다. 되돌릴 방법이 없는 삭제는 막습니다.
  // tasks에는 살아 있는 할 일만 들어옵니다 — 완료한 것은 기록으로 옮겨 갔고,
  // 기록에는 주제 이름이 함께 있어서 주제를 지워도 읽을 수 있습니다.
  const openCount = $derived(
    new Map(categories.map((c) => [c.id, tasks.filter((t) => t.categoryId === c.id).length]))
  );

  /**
   * 설정이 길어지면 창이 끝없이 자라지 않도록 상한을 두고 끌어서 봅니다.
   *
   * 위젯은 이 영역 위에 그대로 남아 스크롤에서 빠져 있습니다. 그래서 어떤
   * 컨트롤을 쓰려고 끌어 내리든, 그 컨트롤이 보이는 순간 위젯도 같이 보입니다 —
   * 바꾼 결과를 못 보면서 조작하는 상황이 생기지 않습니다.
   */
  let content: HTMLElement | undefined = $state();
  let contentHeight = $state(0);
  let pan = $state(0);
  let dragging = $state(false);

  const range = $derived(Math.max(0, contentHeight - maxHeight));
  const offset = $derived(Math.min(pan, range));
  const boxHeight = $derived(Math.min(contentHeight || maxHeight, maxHeight));

  $effect(() => {
    if (!content) return;
    const el = content;
    const measure = () => (contentHeight = el.scrollHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  });

  /* ---------- 캘린더 ---------- */

  let calUrl = $state('');
  let calTopic = $state('');
  let calBusy = $state(false);

  const nameOf = (id: string) => categories.find((c) => c.id === id)?.name ?? '(없는 주제)';

  /**
   * 마지막으로 받아온 시각.
   *
   * '방금'이라고만 적으면 무엇에 대한 방금인지도, 실제로 언제인지도 알 수
   * 없습니다. 시각을 그대로 적습니다. 오늘이면 시:분이면 충분하고, 그보다
   * 오래됐다면 며칠 묵었는지가 중요하므로 날짜를 붙입니다.
   */
  const pad = (n: number) => String(n).padStart(2, '0');

  function syncedLabel(at: number | null): string {
    if (!at) return '받은 적 없음';
    const d = new Date(at);
    const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const sameDay = new Date().toDateString() === d.toDateString();
    return sameDay ? clock : `${d.getMonth() + 1}/${d.getDate()} ${clock}`;
  }

  /**
   * 주제 고르기.
   *
   * 브라우저 기본 select는 이 앱의 다른 어떤 것과도 닮지 않았습니다. 대신
   * 목록을 제자리에서 펼칩니다 — 이 패널은 잘린 창(overflow:hidden) 안에 있어서,
   * 떠오르는 방식으로 만들면 목록 아래쪽이 잘립니다. QuickAdd의 팝오버가 창
   * 밖으로 나가 잘리던 것과 같은 문제입니다.
   */
  let topicOpen = $state(false);
  let newTopic = $state('');
  let addingTopic = $state(false);

  function pickTopic(id: string) {
    calTopic = id;
    topicOpen = false;
    addingTopic = false;
  }

  function confirmNewTopic() {
    const name = newTopic.trim();
    if (!name) return;
    const id = onAddTopic(name);
    calTopic = id;
    newTopic = '';
    addingTopic = false;
    topicOpen = false;
  }

  async function submitCalendar() {
    const url = calUrl.trim();
    const topic = calTopic;
    if (!url || !topic || calBusy) return;
    calBusy = true;
    try {
      await onAddCalendar(url, topic);
      calUrl = '';
    } finally {
      calBusy = false;
    }
  }

  /* ---------- 시작 · 업데이트 ---------- */

  let autostart = $state(false);

  $effect(() => {
    void isAutostartOn().then((on) => (autostart = on));
  });

  async function toggleAutostart() {
    const next = !autostart;
    autostart = next; // 먼저 반응하고
    try {
      await setAutostart(next);
    } catch (err) {
      // 실패하면 되돌립니다. 켜졌다고 표시해놓고 실제로는 안 켜지는 게
      // 가장 나쁜 결과입니다.
      autostart = !next;
      console.warn('자동 시작 설정 실패', err);
    }
  }

  let newVersion = $state<string | null>(null);
  let updateBusy = $state(false);
  let updateNote = $state('');
  let progress = $state<number | null>(null);

  /**
   * ' 업데이트'라는 이름은 그대로 두고 상태만 옆에 씁니다.
   *
   * 이름 자리를 상태가 갈아치우면 무엇에 대한 줄인지가 순간순간 사라져서,
   * 눈이 매번 다시 읽어야 합니다. 이름은 고정된 이정표여야 합니다.
   */
  const updateStatus = $derived.by(() => {
    if (updateNote) return updateNote;
    if (progress !== null) return `내려받는 중… ${progress}%`;
    if (updateBusy) return '확인 중…';
    if (newVersion) return `v${newVersion}으로 업데이트`;
    return '';
  });

  $effect(() => {
    let stop: (() => void) | undefined;
    void onUpdateProgress((pct) => (progress = pct)).then((fn) => (stop = fn));
    return () => stop?.();
  });

  /**
   * 눌렀는데 아무 표시도 없으면 사용자는 고장과 구분할 수 없습니다.
   * '최신입니다'도 답이므로 반드시 적고, 잠시 뒤 원래 이름으로 돌립니다 —
   * 그대로 두면 다음에 눌러야 할 버튼인지 알 수 없습니다.
   */
  function note(text: string) {
    updateNote = text;
    setTimeout(() => (updateNote = ''), 4000);
  }

  async function onUpdateClick() {
    if (updateBusy) return;
    updateBusy = true;
    updateNote = '';
    try {
      if (newVersion) {
        await installUpdate(); // 성공하면 앱이 재시작하므로 여기로 돌아오지 않습니다
      } else {
        const found = await checkUpdate();
        newVersion = found;
        if (!found) note('최신입니다');
      }
    } catch (err) {
      note(String(err).includes('최신') ? '최신입니다' : '실패 — 다시 시도');
    } finally {
      updateBusy = false;
      progress = null;
    }
  }

  /** 4px은 움직여야 끄는 것으로 봅니다. 누르는 손이 흔들렸다고 화면이 밀리면 안 됩니다 */
  const DRAG_THRESHOLD = 4;

  function startPan(e: PointerEvent) {
    if (e.button !== 0 || range <= 0) return;
    const startY = e.clientY;
    const from = offset;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const delta = (ev.clientY - startY) / (zoomFactor || 1);
      if (!moved && Math.abs(delta) < DRAG_THRESHOLD) return;
      moved = true;
      dragging = true;
      pan = Math.max(0, Math.min(range, from - delta));
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      dragging = false;
      // 정말 끌었다면 손을 뗀 자리의 버튼이 눌리면 안 됩니다
      if (moved) {
        window.addEventListener('click', (ev) => ev.stopPropagation(), {
          capture: true,
          once: true,
        });
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function wheelPan(e: WheelEvent) {
    if (e.ctrlKey || e.metaKey || range <= 0) return; // 배율 조작은 가로채지 않습니다
    e.preventDefault();
    pan = Math.max(0, Math.min(range, offset + e.deltaY));
  }
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
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="viewport"
    class:pannable={range > 0}
    class:dragging
    style:height="{boxHeight}px"
    onpointerdown={startPan}
    onwheel={wheelPan}
  >
    <div class="content" bind:this={content} style:transform="translateY({-offset}px)">
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
      </div>

      <h2 class="section">캘린더 연동</h2>

      <!--
        어디서 주소를 가져오는지 적어 둡니다. 이 화면만 보고는 무엇을 붙여넣어야
        할지 알 방법이 없고, 구글과 애플은 부르는 이름조차 다릅니다.
      -->
      <div class="guide">
        <p><strong>구글</strong></p>
        <p>캘린더 설정 → 내 캘린더의 설정 → 캘린더 통합 → <em>iCal 형식의 비공개 주소</em> 복사</p>
        <p class="next"><strong>애플</strong></p>
        <p>캘린더 앱 → 캘린더 목록 → 캘린더 옆 ⓘ → <em>공개 캘린더</em> 켜기 → 링크 공유</p>
      </div>

      {#each calendars as cal (cal.id)}
        <div class="row sub">
          <span class="label">{nameOf(cal.categoryId)} · {cal.label || '캘린더'}</span>
          <span class="status" class:stale={!!cal.error}>{syncedLabel(cal.syncedAt)}</span>
          <button class="danger" aria-label="연결 해제" onclick={() => onRemoveCalendar(cal.id)}>
            연결 해제
          </button>
        </div>
        {#if cal.error}
          <div class="row why"><span>{cal.error}</span></div>
        {/if}
      {/each}

      <div class="row">
        <input
          class="rename"
          placeholder="캘린더 주소 붙여넣기"
          bind:value={calUrl}
          onkeydown={(e) => {
            if (e.key === 'Enter') void submitCalendar();
          }}
        />
      </div>

      <!--
        주제 고르기. 제자리에서 펼칩니다 — 떠오르면 잘린 창 밖으로 나갑니다.

        고르기 전에는 등록을 막습니다. 버튼이 '주제 선택'이라고 해놓고 몰래
        첫 주제에 넣으면, 나중에 엉뚱한 레인에서 일정을 찾게 됩니다.
      -->
      <!--
        주제 고르기와 등록을 한 줄에 둡니다. 등록은 글자만큼만 차지하고 나머지를
        주제가 채웁니다 — 고르는 일이 넓고 마무리가 좁은 것이 순서와 맞습니다.
        목록은 주제 버튼 아래에 그 폭 그대로 붙어야 무엇의 목록인지 보입니다.
      -->
      <div class="row top">
        <div class="picker">
          <button class="nudge topic" onclick={() => (topicOpen = !topicOpen)}>
            <span>{calTopic ? nameOf(calTopic) : '주제 선택'}</span>
            <span class="caret" class:up={topicOpen}>▾</span>
          </button>

          {#if topicOpen}
            <div class="options">
              {#each categories as c (c.id)}
                <button class="option" class:on={c.id === calTopic} onclick={() => pickTopic(c.id)}>
                  {c.name}
                </button>
              {/each}

              {#if addingTopic}
                <div class="row">
                  <!-- svelte-ignore a11y_autofocus -->
                  <input
                    class="rename"
                    placeholder="새 주제 이름"
                    autofocus
                    bind:value={newTopic}
                    onkeydown={(e) => {
                      if (e.key === 'Enter') confirmNewTopic();
                      if (e.key === 'Escape') addingTopic = false;
                    }}
                  />
                  <button class="nudge" disabled={!newTopic.trim()} onclick={confirmNewTopic}>
                    확인
                  </button>
                </div>
              {:else}
                <button class="option new" onclick={() => (addingTopic = true)}>＋ 주제 추가</button>
              {/if}
            </div>
          {/if}
        </div>

        <button
          class="add register"
          disabled={!calUrl.trim() || !calTopic || calBusy}
          onclick={() => void submitCalendar()}
        >
          {calBusy ? '받는 중…' : '등록'}
        </button>
      </div>

      {#if calendars.length > 0}
        <div class="row">
          <span class="label">20분마다 자동으로 갱신됩니다</span>
          <button class="danger action" onclick={onSyncCalendars}>지금 갱신</button>
        </div>
      {/if}

      <h2 class="section">알림</h2>

      <!--
        켜야 아래 항목이 나타납니다. 꺼진 채로 하위 항목을 흐리게 남겨 두면
        만질 수 있는 것처럼 보이는데 실제로는 아무 효과가 없어서, 아예 감추는
        편이 정직합니다.
      -->
      <div class="row">
        <span class="label">마감 알림</span>
        <button
          class="toggle"
          class:on={settings.notify}
          role="switch"
          aria-label="마감 알림"
          aria-checked={settings.notify}
          onclick={() => onSettings({ notify: !settings.notify })}
        >
          <span class="knob"></span>
        </button>
      </div>

      {#if settings.notify}
        {#each [
          { key: 'notifyDayBefore' as const, label: '마감 24시간 전' },
          { key: 'notifyHourBefore' as const, label: '마감 1시간 전' },
          { key: 'nightAlerts' as const, label: '야간 알림 수신' },
        ] as item (item.key)}
          <div class="row sub">
            <span class="label">{item.label}</span>
            <button
              class="toggle"
              class:on={settings[item.key]}
              role="switch"
              aria-label={item.label}
              aria-checked={settings[item.key]}
              onclick={() => onSettings({ [item.key]: !settings[item.key] })}
            >
              <span class="knob"></span>
            </button>
          </div>
        {/each}
      {/if}

      <h2 class="section">시작 · 업데이트</h2>

      <div class="row">
        <span class="label">로그인 시 자동 시작</span>
        <button
          class="toggle"
          class:on={autostart}
          role="switch"
          aria-checked={autostart}
          aria-label="로그인 시 자동 시작"
          onclick={toggleAutostart}
        >
          <span class="knob"></span>
        </button>
      </div>

      <!--
        눌렀는데 아무 표시도 없으면 사용자는 고장과 구분할 수 없습니다.
        '최신입니다'도 답이므로 반드시 적습니다.
      -->
      <div class="row">
        <span class="label">업데이트</span>
        {#if updateStatus}<span class="status" class:ready={newVersion}>{updateStatus}</span>{/if}
        <button class="danger action" disabled={updateBusy} onclick={onUpdateClick}>
          {newVersion ? '설치' : '확인'}
        </button>
      </div>
    </div>

    <!-- 스크롤바를 두지 않기로 했으므로 "더 있다"는 이 그늘로만 전해집니다 -->
    {#if offset > 0.5}<div class="fade up"></div>{/if}
    {#if offset < range - 0.5}<div class="fade down"></div>{/if}
  </div>
</section>

<style>
  .editor {
    border-radius: 14px;
    padding: 12px 14px 14px;
    background: var(--surface);
    border: 1px solid var(--surface-border);
    color: var(--text);
  }

  /* 상한 있는 창. 내용이 넘치면 끌어서 봅니다 */
  .viewport {
    position: relative;
    overflow: hidden;
  }

  .viewport.pannable {
    cursor: grab;
    touch-action: none;
  }

  .viewport.dragging {
    cursor: grabbing;
  }

  .content {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  .fade {
    position: absolute;
    left: 0;
    right: 0;
    height: 14px;
    pointer-events: none;
  }

  .fade.up {
    top: 0;
    background: linear-gradient(to bottom, rgba(10, 11, 16, 0.8), transparent);
  }

  .fade.down {
    bottom: 0;
    background: linear-gradient(to top, rgba(10, 11, 16, 0.8), transparent);
  }

  /**
   * 소제목은 본문과 같은 글꼴을 씁니다.
   *
   * 고정폭에 자간을 넓히고 색까지 흐리게 하면 네 가지가 한꺼번에 약해지는
   * 방향이라 위계가 서지 않습니다. 고정폭은 이 앱에서 '시간 축'이라는 뜻을
   * 지고 있으니(12h, DUE) 소제목이 빌려 쓸 채널도 아닙니다.
   * 크기와 굵기로만 구분하고, 갈래는 얇은 선이 나눕니다.
   */
  h2 {
    font: inherit;
    font-size: var(--fs-name);
    font-weight: 700;
    color: var(--text);
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

  /**
   * 온오프 스위치.
   *
   * 체크박스 대신 쓰는 이유는 오른쪽 끝에 정렬되기 때문입니다. 라벨은 왼쪽,
   * 상태는 오른쪽 — 위의 배율·주제 수 행과 같은 축에 서서 눈이 한 줄로 훑힙니다.
   */
  .toggle {
    flex: none;
    width: 42px;
    height: 24px;
    padding: 0;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.08);
    cursor: pointer;
    position: relative;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .toggle:hover {
    border-color: rgba(255, 255, 255, 0.4);
  }

  /* 켜짐이 확실히 켜져 보여야 합니다. 예전 색은 어두운 표면 위에서 꺼짐과
     잘 구분되지 않아, 켜져 있는데도 꺼진 것으로 읽혔습니다. */
  .toggle.on {
    background: #6a5fd0;
    border-color: rgba(190, 182, 255, 0.85);
  }

  .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.75);
    transition: transform 0.15s ease, background 0.15s ease;
  }

  .toggle.on .knob {
    transform: translateX(18px);
    background: #fff;
  }

  @media (prefers-reduced-motion: reduce) {
    .toggle,
    .knob {
      transition: none;
    }
  }

  /* 상태는 이름보다 밝게 둡니다. 둘 다 흐리면 지금 무슨 일이 벌어지는지
     눈에 안 들어옵니다. 퍼센트가 흔들리지 않게 고정폭 숫자를 씁니다. */
  .status {
    font-size: var(--fs-meta);
    color: var(--text);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* 사유는 한 줄 통째로 씁니다. 줄여 봤자 무엇을 고칠지 알 수 없게 됩니다 */
  .why {
    padding-left: 12px;
  }

  .why span {
    font-size: var(--fs-meta);
    color: var(--deadline);
    line-height: 1.35;
  }

  .status.stale {
    color: var(--deadline);
  }

  /**
   * 안내문. 서비스 이름과 경로를 줄로 나눕니다.
   *
   * 한 줄에 붙여 쓰면 '구글'이 경로의 첫 단어처럼 읽혀서, 어디까지가 이름이고
   * 어디부터가 따라 할 순서인지 눈으로 갈리지 않습니다.
   */
  .guide {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .guide p {
    margin: 0;
    font-size: var(--fs-meta);
    line-height: 1.5;
    color: var(--text-muted);
  }

  .guide p.next {
    margin-top: 8px;
  }

  .guide strong {
    color: var(--text);
    font-weight: 700;
    margin-right: 3px;
  }

  .guide em {
    font-style: normal;
    color: var(--text);
  }

  /* 주제 고르기 — 앱의 다른 버튼과 같은 모양을 씁니다 */
  /**
   * 주소 칸과 같은 폭으로 한 줄을 채웁니다.
   *
   * 옆에 등록 버튼을 나란히 두면 둘이 같은 층위로 보여서, 주제를 고르는 일과
   * 등록하는 일이 동시에 할 수 있는 것처럼 읽힙니다. 실제로는 주소를 넣고
   * 주제를 고른 뒤에야 등록입니다. 한 줄씩 내려가야 그 순서가 보입니다.
   */
  /* 목록이 딸려 있으므로 세로로 쌓입니다. 등록은 위쪽에 붙어 있어야 합니다 */
  .row.top {
    align-items: flex-start;
  }

  .picker {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }

  .row .topic {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    min-width: 0;
    padding: 6px 10px;
    font-weight: 600;
  }

  /* 등록은 글자만큼만. 고르는 일이 넓고 마무리가 좁은 것이 순서와 맞습니다 */
  .row .register {
    flex: none;
  }

  .caret {
    font-size: 9px;
    opacity: 0.6;
    transition: transform 0.15s ease;
  }

  .caret.up {
    transform: rotate(180deg);
  }

  /* 제자리에서 펼칩니다. 떠오르면 잘린 창 밖으로 나가 아래쪽이 안 보입니다 */
  .options {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .option {
    font: inherit;
    font-size: var(--fs-meta);
    text-align: left;
    color: var(--text);
    background: transparent;
    border: none;
    border-radius: 7px;
    padding: 7px 9px;
    min-height: 26px;
    cursor: pointer;
  }

  .option:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .option.on {
    background: rgba(90, 80, 190, 0.32);
    font-weight: 600;
  }

  .option.new {
    color: var(--text-muted);
  }

  .status.ready {
    color: #cfcbff;
    font-weight: 600;
  }

  /* 확인/설치 버튼. 삭제 버튼과 같은 모양이되 위험한 동작이 아닙니다 */
  .action {
    min-width: 46px;
  }

  /* 하위 항목은 한 단 들여씁니다 — 무엇에 딸린 설정인지 줄만 봐도 읽힙니다 */
  .row.sub .label {
    padding-left: 12px;
    color: var(--text-muted);
  }

  .label {
    flex: 1;
    font-size: var(--fs-meta);
    color: var(--text-muted);
  }

  .count {
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: var(--fs-meta);
    font-variant-numeric: tabular-nums;
    color: var(--text);
    min-width: 28px;
    text-align: center;
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

  /**
   * 클릭 과녁은 최소 26px입니다.
   *
   * ↑↓와 −＋가 21×19였는데, 데스크톱에서 24×24가 실질 하한입니다. 그보다 작으면
   * 겨눴다고 생각한 곳과 실제로 눌리는 곳이 어긋나서, 눌렀는데 아무 일도 안
   * 일어나는 일이 생깁니다. 글자는 그대로 두고 과녁만 키웁니다.
   */
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
    min-height: 26px;
    padding: 4px 8px;
  }

  .nudge {
    min-width: 26px;
  }

  .add {
    min-height: 30px;
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
