<script lang="ts">
  import { untrack } from 'svelte';
  import { Spring } from 'svelte/motion';
  import { cubicIn } from 'svelte/easing';
  import { theme } from '../theme';
  import { describeCycle, describeRepeat } from '../repeat';
  import { stripePattern, withAlpha, type Visual } from '../urgency';
  import type { Task } from '../types';

  let {
    task,
    visual,
    targetY,
    remaining,
    deadline,
    flip = false,
    room = 300,
    reducedMotion = false,
    settleDelay = 0,
    held = false,
    onToggle,
    onMenu,
    onHover,
  }: {
    task: Task;
    visual: Visual;
    targetY: number;
    remaining: string;
    deadline: string;
    /** 오른쪽에 자리가 모자라면 왼쪽으로 펼칩니다 */
    flip?: boolean;
    /** 펼칠 수 있는 최대 폭. 패널 밖으로 나가면 창이 잘라 버립니다 */
    room?: number;
    reducedMotion?: boolean;
    /**
     * 자리를 옮기기 전에 기다릴 시간(ms).
     *
     * 카드 하나가 빠지면 위의 카드들이 한 칸 내려앉습니다. 그런데 빠지는
     * 카드의 애니메이션과 그 내려앉음이 같은 순간에 시작하면, 화면에서 두
     * 가지가 한꺼번에 움직여 무엇이 사라졌는지 눈이 놓칩니다.
     *
     * 빠지는 쪽을 먼저 끝내고 남는 쪽이 뒤따르면 순서가 읽힙니다 — 하나가
     * 사라졌고, 그래서 나머지가 자리를 메웠다는 순서입니다.
     */
    settleDelay?: number;
    /**
     * 지금 고치는 중인 카드인가.
     *
     * 표시만 하는 값이 아닙니다. 붙잡힌 카드는 완료되지 않습니다 — 마감을
     * 잘못 넣어 되돌리는 중에 그 항목이 기록으로 옮겨 가 버리면, 고치던 값을
     * 어디에 쓸지가 사라집니다. 상태를 나중에 수습하는 대신 만들지 않습니다.
     */
    held?: boolean;
    onToggle: (t: Task) => void;
    onMenu: (t: Task, x: number, y: number) => void;
    /**
     * 손이 올라오고 내려간 것을 알립니다.
     *
     * 펼침 자체는 CSS :hover가 하지만, 구역 밖으로 잘린 카드를 안으로
     * 끌어들이는 일은 구역의 창 크기와 끌어 놓은 자리를 아는 쪽만 할 수
     * 있습니다. 그건 Column입니다.
     */
    onHover?: (id: string | null) => void;
  } = $props();

  // 카드가 경계를 넘어 활주로로 떨어지는 순간이 이 위젯의 핵심 알림입니다.
  // 스프링이 그 낙하에 무게를 줍니다.
  // 최초 값만 잡고, 이후 변화는 아래 $effect가 target으로 흘려보냅니다
  const y = new Spring(untrack(() => targetY), theme.motion.spring);

  $effect(() => {
    const target = targetY;
    if (reducedMotion) {
      y.set(target, { instant: true });
      return;
    }
    if (settleDelay <= 0) {
      y.target = target;
      return;
    }
    const timer = setTimeout(() => (y.target = target), settleDelay);
    return () => clearTimeout(timer);
  });

  /**
   * 창이 가려지면 브라우저가 requestAnimationFrame을 멈추므로 스프링이 중간
   * 위치에서 얼어붙습니다. 바탕화면 위젯은 가려져 있는 게 정상 상태라
   * (항상 맨 아래에 깔리니까) 이 상황이 수시로 벌어집니다. 다시 보이는 순간
   * 목표 위치로 스냅시켜서, 몇 시간 전 위치에서 스르륵 기어오는 걸 막습니다.
   */
  $effect(() => {
    const onVisible = () => {
      if (!document.hidden) y.set(targetY, { instant: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });

  const overdue = $derived(visual.zone === 'overdue');
  const background = $derived(
    overdue ? stripePattern(visual.color) : withAlpha(visual.color, visual.fillAlpha)
  );

  // 저장소 왕복을 기다리지 않고 체크 표시를 먼저 채웁니다.
  // 클릭이 즉시 반응해야 완료가 보상처럼 느껴집니다.
  let justDone = $state(false);

  function complete() {
    justDone = true;
    onToggle(task);
  }

  /**
   * 완료하면 카드가 마감선 아래로 빠집니다.
   * 위에 남은 카드들이 한 칸 내려앉는 건 별도 처리가 필요 없습니다 —
   * 대기 구역 인덱스가 하나씩 당겨지면서 각자의 스프링이 알아서 따라옵니다.
   * 이 0.4초가 재방문율을 만듭니다.
   */
  function fall(_node: Element, { duration }: { duration: number }) {
    return {
      duration,
      easing: cubicIn,
      css: (t: number, u: number) =>
        `opacity: ${t};
         transform: translateY(${u * 30}px) scale(${0.94 + t * 0.06});
         filter: saturate(${0.25 + t * 0.75});`,
    };
  }
</script>

<!-- data-target은 테스트 훅입니다. 실제 bottom은 스프링이 쫓아가는 중이라
     목표 위치를 따로 노출해야 배치 로직을 검증할 수 있습니다. -->
<div
  class="card"
  role="listitem"
  class:flip
  class:breathe={visual.breathe && visual.zone !== 'queue'}
  class:held
  oncontextmenu={(e) => {
    e.preventDefault();
    onMenu(task, e.clientX, e.clientY);
  }}
  onmouseenter={() => onHover?.(task.id)}
  onmouseleave={() => onHover?.(null)}
  data-zone={visual.zone}
  data-target={targetY}
  style:--room="{room}px"
  out:fall={{ duration: reducedMotion ? 0 : theme.motion.completeMs }}
  style:bottom="{y.current}px"
  style:--h="{theme.layout.cardHeight}px"
  style:background
  style:border-left="{visual.stripe}px solid {visual.color}"
  style:border-radius="{visual.radius}px"
  style:--glow={withAlpha(visual.color, 0.34)}
  style:box-shadow={visual.lift > 0.3
    ? `0 ${visual.lift * 2}px ${visual.lift * 6}px rgba(0,0,0,0.35)`
    : 'none'}
>
  <button
    class="check"
    style:border-color={withAlpha(visual.color, 0.7)}
    style:background={justDone ? visual.color : null}
    onclick={complete}
    disabled={held}
    aria-label="{task.title} 완료"
  ></button>

  <span class="body">
    <span class="title" style:font-weight={500 + Math.round(visual.urgency * 2) * 100}>
      {task.title}
    </span>
    <span class="due">
      <!--
        반복은 글자가 아니라 기호로 답니다.

        카드에 남은 자리가 없습니다 — 제목과 남은 시간이 이미 폭을 다 쓰고,
        "매주 월" 같은 말을 늘 붙여 두면 좁은 레인에서 남은 시간을 밀어냅니다.
        평소에는 이 할 일이 다시 온다는 사실만 알면 충분하고, 얼마 간격인지는
        손을 올렸을 때 마감 시각과 함께 나옵니다.
      -->
      {#if task.repeat}<span class="cycle" title={describeRepeat(task.repeat, task.due)}>↻</span>{/if}
      {remaining}<span class="when">{deadline}</span>
      {#if task.repeat}<span class="when rule">{describeCycle(task.repeat, task.due)}</span>{/if}
    </span>
  </span>
</div>

<style>
  /* 레인 폭을 그대로 씁니다. 주제는 레인 머리가 밝히므로 카드는 제목과
     남은 시간만 담고, 좁은 폭에서는 제목을 말줄임합니다. */
  .card {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px 0 9px;
    border: 1px solid rgba(255, 255, 255, 0.09);
    box-sizing: border-box;
    height: var(--h);
  }

  .body {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
    flex: 1;
    line-height: 1.25;
  }


  .title {
    font-size: var(--fs-title);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /**
   * 레인이 좁아지면 제목이 잘립니다. 호버하면 카드가 제자리에서 떠올라
   * 필요한 만큼만 펼쳐집니다.
   *
   * 레이아웃을 밀어내는 방식이 아니라 위를 덮는 방식인 게 중요합니다. 카드
   * 하나 읽으려는데 옆 레인들이 다 움직이면 시선이 흔들려 오히려 산만합니다.
   * 여기서는 아무것도 밀리지 않습니다.
   */
  /* 카드 채움은 반투명이라 그대로 펼치면 아래 카드가 비쳐 겹쳐 보입니다.
     채움 뒤에 불투명 판을 깔아 확장된 동안만 가려 줍니다. */
  .card::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    background: var(--surface-solid, rgba(18, 19, 27, 0.97));
    opacity: 0;
  }

  .card:hover::before {
    opacity: 1;
  }

  .card:hover {
    /* 위아래 여백은 두지 않습니다. 남은 시간과 마감 시각이 이제 한 줄로
       고정이라 쓰일 일이 없고, 여백이 있으면 글자가 커지는 환경에서 카드가
       min-height를 넘어 자랄 여지만 남깁니다. */
    right: auto;
    width: max-content;
    min-width: 100%;
    max-width: min(300px, var(--room, 300px));
    z-index: 30;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
    /* 아래를 붙잡고 위로만 자랍니다 (bottom으로 배치되므로 저절로 그렇습니다) */
    height: auto;
    min-height: var(--h);
  }

  /* 오른쪽에 자리가 모자란 레인은 반대로 펼칩니다 — 팝오버가 화면 끝에서
     방향을 뒤집는 것과 같습니다. 덮는 방식이라 여기서도 밀리는 것은 없습니다. */
  .card.flip:hover {
    left: auto;
    right: 0;
  }

  /* 카드가 내용만큼 늘어나므로 여기서 잘리는 것은 상한(폭)에 걸렸을 때뿐입니다.
     그때는 삐져나가는 것보다 말줄임이 낫습니다 — 카드가 더는 클 수 없으니까요. */


  /**
   * 남은 시간과 마감 시각. 절대 줄을 바꾸지 않습니다.
   *
   * opacity로 흐리게 하면 스크림 위에서 대비가 4.5:1 아래로 떨어집니다.
   * 토큰 색을 직접 쓰고, 크기도 9.5px에서 10px로 올립니다.
   *
   * 한때는 폭이 모자라면 접히게 두었습니다. 그런데 접히면 카드가 세로로
   * 12px 자라고, 카드는 아래를 붙잡고 위로 자라므로 그만큼 구역 천장을
   * 넘습니다 — 구역 위쪽에 붙은 카드는 24h 선을, 활주로 꼭대기 카드는
   * 마감선을 밟습니다. 하필 그 자리 카드들이 가장 급한 것들입니다.
   *
   * 접힘은 폭이 모자랄 때의 안전장치였는데, 실제로는 안전장치가 아니라
   * 문제 그 자체였습니다. 넘칠 때는 마감 시각이 잘리게 둡니다. 잘린 마감
   * 시각은 정보를 조금 잃을 뿐이지만, 선을 넘은 카드는 높이가 시각을
   * 뜻한다는 이 위젯의 전제를 깨뜨립니다.
   */
  .due {
    display: flex;
    flex-wrap: nowrap;
    /**
     * 글자도 줄을 바꾸지 않습니다.
     *
     * flex-wrap:nowrap은 flex 줄이 접히는 것만 막습니다. 항목 **안쪽**의
     * 글자는 그대로 접혀서, 자리가 4px 모자라자 익명 항목이 눌리며
     * "3d 23h"가 "3d"와 "23h" 두 줄로 쪼개졌습니다. 남은 시간·마감 시각·
     * 반복이 저마다 제멋대로 접히니 한 줄이 통째로 어그러져 보였습니다.
     *
     * nowrap을 여기 걸면 상속되어 조각 전부가 한 줄에 섭니다. 넘치면 아래
     * overflow가 자릅니다 — 잘린 꼬리는 정보를 조금 잃을 뿐이지만, 접힌
     * 글자는 카드를 세로로 밀어 올려 마감선을 밟습니다.
     */
    white-space: nowrap;
    overflow: hidden;
    column-gap: 4px;
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: var(--fs-due);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    margin-top: 1px;
  }

  /**
   * 마감 시각은 손을 올렸을 때만 나옵니다.
   *
   * 남은 시간과 마감 시각은 같은 것을 다르게 묻습니다 — "얼마나 급한가"와
   * "언제까지인가"입니다. 앞의 것이 이 위젯의 기본 관심사라 늘 보이는 자리를
   * 차지하고, 뒤의 것은 계획을 세울 때 필요하니 물어볼 때만 나옵니다.
   *
   * 호버하면 카드가 어차피 제자리에서 펼쳐지므로 자리를 따로 낼 필요가
   * 없습니다. 레인 폭은 그대로고 아무것도 밀리지 않습니다.
   */
  .when {
    display: none;
  }

  /**
   * 반복 기호는 늘 보입니다. 남은 시간 앞에 두어 "이 시각이 이번 회차"라는
   * 것을 먼저 말하게 합니다.
   *
   * 세로로는 가운데에 맞춥니다. 이 기호만 글자 크기가 작고(10px) 줄 높이도
   * 1이라, flex의 기본값(stretch)으로 두면 상자는 줄 높이만큼 늘어나는데
   * 글자는 그 상자 **위쪽**에 붙습니다. 재보니 남은 시간보다 2.17px 높이
   * 떠 있었습니다.
   *
   * align-items를 통째로 바꾸지 않고 이 기호만 옮깁니다. 나머지 조각(마감
   * 시각·반복 규칙)은 본문과 같은 크기라 지금 정렬이 이미 정확한데, 컨테이너
   * 쪽을 건드리면 맞아 있던 것까지 함께 움직입니다.
   *
   * 기준선(baseline)이 아니라 가운데인 것은 이것이 글자가 아니라 기호이기
   * 때문입니다. 아이콘은 글줄의 기준선이 아니라 시각적 중심에 맞춥니다 —
   * 재봐도 가운데가 0.27px, 기준선이 0.43px 어긋납니다.
   */
  .cycle {
    align-self: center;
    color: rgba(255, 255, 255, 0.45);
    font-size: 10px;
    line-height: 1;
  }

  /**
   * 펼치면 마감 시각이 남은 시간 옆에 붙습니다.
   *
   * 예전에는 줄을 바꿔 세 줄로 만들었습니다. 한 줄로 이으면 190px쯤 되는데
   * 그때는 카드가 옆으로 갈 데가 없었기 때문입니다. 지금은 카드가 최대
   * 300px까지 펼쳐지고, 실제로 재보니 가장 긴 경우가 154px입니다.
   *
   * 줄을 바꾸지 않는 것이 중요합니다. 세 줄이 되면 카드가 세로로 28px
   * 자라는데, 카드는 아래를 붙잡고 위로 자라므로 그만큼 구역 위쪽을 넘어
   * 잘리고 마감선에 닿습니다. 두 줄로 두면 아예 자라지 않습니다.
   *
   * 레인이 아주 좁을 때를 대비해 접히게 두었던 적이 있는데, 그 대비가
   * 그대로 문제였습니다 — .due의 주석을 보세요.
   */
  .card:hover .when {
    display: block;
  }

  /* 한 줄에 붙으면 둘이 한 덩어리로 읽힙니다. 가운뎃점이 그걸 나눕니다. */
  .card:hover .when::before {
    content: '· ';
  }

  /* 규칙은 마감 시각 다음입니다. 순서가 곧 중요도라, 이번 회차가 언제인지가
     먼저고 다음이 언제 또 오는지가 나중입니다. */
  .card:hover .when.rule {
    color: rgba(255, 255, 255, 0.5);
  }

  /**
   * 이 앱에서 가장 자주 누르는 곳이라 과녁이 넉넉해야 합니다.
   *
   * 동그라미 자체는 작게 두되(카드 안에서 커지면 제목 자리를 먹습니다) 눌리는
   * 범위를 여백으로 넓힙니다 — 보이는 크기와 닿는 크기는 같을 필요가 없습니다.
   */
  .check {
    flex: none;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    border: 1.5px solid;
    background: transparent;
    cursor: pointer;
    padding: 0;
    position: relative;
  }

  .check::after {
    content: '';
    position: absolute;
    inset: -6px;
    border-radius: 50%;
  }

  .check:hover {
    background: rgba(255, 255, 255, 0.18);
  }

  .check:disabled {
    cursor: default;
    opacity: 0.4;
  }

  /**
   * 고치는 중인 카드.
   *
   * 입력칸의 '수정' 글자만으로는 무엇을 고치는 중인지 알 수 없습니다. 카드가
   * 열 장이면 열 장 중 어느 것인지 말해 주는 것이 없습니다. 여기서 그걸
   * 말합니다 — 그리고 이 표시는 장식이 아니라 뜻입니다. 표시가 붙어 있는
   * 동안 이 카드는 완료되지 않습니다.
   */
  .card.held {
    outline: 2px solid rgba(255, 255, 255, 0.85);
    /**
     * 테두리를 카드 **안쪽**에 그립니다.
     *
     * 바깥에 그리면 구역 경계에 붙은 카드에서 그 부분이 잘립니다. 구역은
     * clip-path로 위아래를 정확히 자르는데(끌어서 볼 때 창 밖 카드를 숨기려고
     * 그렇게 둡니다), 마감선이나 24시간 선에 딱 붙은 카드는 여유가 0이라
     * 바깥으로 나간 테두리가 그대로 잘려나갑니다.
     *
     * 하필 그런 카드가 가장 급한 것들입니다 — 마감 직전과 방금 지난 것.
     * 안쪽에 그리면 카드 상자를 벗어나지 않으므로 잘릴 일이 없습니다.
     */
    outline-offset: -2px;
  }

  :global(button:focus-visible) {
    outline: 2px solid rgba(255, 255, 255, 0.7);
    outline-offset: 2px;
  }

  /**
   * 숨쉬기 — 주변시에 걸리는 유일한 채널. 절대 과하게 쓰지 말 것.
   *
   * 예전에는 box-shadow 값 자체를 오르내리게 했습니다. 그런데 box-shadow는
   * 합성기로 넘길 수 없는 속성이라, 매 프레임 요소를 다시 칠하고 16px 흐림을
   * 다시 굽습니다. 앱이 켜져 있는 내내 그러니 실측해 보니 코어 하나의 4분의
   * 1을 먹고 있었습니다(GPU 16%, 렌더러 8%). 가만히 있는 위젯이 그럴 이유가
   * 없고, 저사양 PC에서는 그대로 체감됩니다.
   *
   * 빛무리는 ::after에 고정해 두고 opacity만 오르내립니다. opacity는 합성기가
   * 처리하므로 다시 칠하지 않습니다 — 그림은 한 번만 구워집니다.
   *
   * z-index를 내려 카드 배경 뒤에 둡니다. box-shadow가 원래 그 자리에
   * 그려지던 것이라 보이는 결과는 이전과 같습니다.
   */
  .card::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    pointer-events: none;
    box-shadow: 0 0 0 3px var(--glow), 0 0 16px var(--glow);
    opacity: 0;
  }

  .breathe::after {
    will-change: opacity;
    animation: breathe 6s ease-in-out infinite;
  }

  @keyframes breathe {
    0%,
    100% {
      opacity: 0;
    }
    50% {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .breathe::after {
      animation: none;
    }
  }
</style>
