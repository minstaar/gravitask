<script lang="ts">
  /**
   * 카드를 우클릭하면 나오는 메뉴.
   *
   * 여기 있는 두 가지는 다른 어디에도 없습니다 — 수정과 삭제. 완료는 넣지
   * 않습니다. 카드에 이미 동그라미가 있고, 같은 일을 두 곳에 두면 한쪽을 바꿀
   * 때마다 다른 쪽을 맞춰야 하며 그 동기화가 어긋나는 순간 표시와 실제가
   * 달라집니다.
   *
   * 미루기도 넣지 않습니다. 이 위젯의 전제는 마감이 다가오는 걸 느끼게 한다는
   * 것인데, 미루기는 느낌이 불편할 때 사실을 바꾸는 버튼입니다. 마감이 진짜로
   * 바뀌었다면 그건 수정이고, 안 바뀌었는데 옮기면 카드의 높이와 색이
   * 거짓말을 하기 시작합니다.
   */
  import type { Task } from '../types';

  let {
    task,
    x,
    y,
    onEdit,
    onDelete,
    onEndRepeat,
    onSkip,
    onClose,
  }: {
    task: Task;
    x: number;
    y: number;
    onEdit: (t: Task) => void;
    onDelete: (t: Task) => void;
    /** 반복을 끝냅니다. 카드는 남고 규칙만 떨어집니다 */
    onEndRepeat: (t: Task) => void;
    /** 이번 회차만 건너뜁니다. 계열은 다음 회차로 굴러갑니다 */
    onSkip: (t: Task) => void;
    onClose: () => void;
  } = $props();

  /** 구독한 캘린더에서 온 항목은 우리가 고칠 수도 지울 수도 없습니다 */
  const readOnly = $derived(task.sourceId !== undefined);

  /**
   * 반복은 여기서 끝냅니다.
   *
   * 기본이 '계속'이라 나가는 문이 반드시 있어야 하는데, 입력칸을 열어 칩을
   * 찾아 '안 함'을 고르는 길뿐이면 세 걸음입니다. 그만두겠다는 결정은 대개
   * 카드를 보다가 하므로, 카드 위에서 한 번에 닿아야 합니다.
   */
  const repeating = $derived(!readOnly && task.repeat !== undefined);

  let menu: HTMLDivElement | undefined = $state();

  /** 화면 밖으로 나가면 안 보입니다. 커서 옆에 붙이되 가장자리에서 접습니다 */
  const style = $derived.by(() => {
    const w = 168;
    const h = readOnly ? 74 : repeating ? 136 : 76;
    const left = Math.max(4, Math.min(x, window.innerWidth - w - 4));
    const top = Math.max(4, Math.min(y, window.innerHeight - h - 4));
    return `left:${left}px; top:${top}px; width:${w}px;`;
  });

  $effect(() => {
    menu?.focus();
    const onDown = (e: MouseEvent) => {
      if (menu && !menu.contains(e.target as Node)) onClose();
    };
    // 눌리는 순간 닫습니다. 떼는 것을 기다리면 메뉴 밖을 눌러 놓고도 한 박자
    // 남아 있어서, 그 사이의 클릭이 어디로 갈지 모호해집니다.
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  });
</script>

<div
  bind:this={menu}
  class="menu"
  {style}
  role="menu"
  tabindex="-1"
  onkeydown={(e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  }}
>
  {#if readOnly}
    <!-- 메뉴를 아예 열지 않으면 사용자는 고장으로 읽습니다. 못 하는 이유를
         말하고, 어디로 가야 하는지까지 말합니다. -->
    <p class="why">구독한 일정이라<br />여기서는 고칠 수 없습니다</p>
    <p class="why sub">원본 캘린더에서 고쳐 주세요</p>
  {:else}
    <button role="menuitem" onclick={() => onEdit(task)}>수정</button>
    <!-- 확인을 받지 않습니다. 완료와 같은 자리에서 같은 Ctrl+Z로 돌아옵니다 —
         지운 것을 되살리는 방법이 이미 손에 익은 그 동작이어야 합니다. -->
    <button role="menuitem" onclick={() => onDelete(task)}>삭제</button>
    {#if repeating}
      <!-- 완료와도 삭제와도 다릅니다. 한 것으로 치지 않으니 기록에 남지 않고,
           계열은 그대로 살아 다음 회차로 굴러갑니다. 이번 주 휴강이 이것입니다. -->
      <button role="menuitem" onclick={() => onSkip(task)}>이번 회차 건너뛰기</button>
      <!-- 지우기와 다릅니다. 아직 안 한 이번 회차는 그대로 남고, 다음 회차만
           오지 않습니다. 그래서 '반복'을 끝낸다고 적습니다 — '할 일'이 아니라. -->
      <button role="menuitem" onclick={() => onEndRepeat(task)}>반복 끝내기</button>
    {/if}
  {/if}
</div>

<style>
  .menu {
    position: fixed;
    z-index: 200;
    display: flex;
    flex-direction: column;
    padding: 4px;
    gap: 1px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(24, 27, 38, 0.98);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55);
  }

  .menu:focus {
    outline: none;
  }

  button {
    font: inherit;
    font-size: 12.5px;
    text-align: left;
    color: #f2f2f8;
    background: transparent;
    border: 0;
    border-radius: 5px;
    padding: 6px 8px;
    cursor: pointer;
  }

  button:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  button:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.7);
    outline-offset: -2px;
  }

  .why {
    margin: 0;
    padding: 5px 8px 0;
    font-size: 12px;
    line-height: 1.45;
    color: rgba(255, 255, 255, 0.82);
  }

  .why.sub {
    padding: 2px 8px 5px;
    color: rgba(255, 255, 255, 0.55);
  }
</style>
