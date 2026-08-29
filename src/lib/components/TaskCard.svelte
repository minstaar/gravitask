<script lang="ts">
  import { untrack } from 'svelte';
  import { Spring } from 'svelte/motion';
  import { cubicIn } from 'svelte/easing';
  import { theme } from '../theme';
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
    onToggle,
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
    onToggle: (t: Task) => void;
  } = $props();

  // 카드가 경계를 넘어 활주로로 떨어지는 순간이 이 위젯의 핵심 알림입니다.
  // 스프링이 그 낙하에 무게를 줍니다.
  // 최초 값만 잡고, 이후 변화는 아래 $effect가 target으로 흘려보냅니다
  const y = new Spring(untrack(() => targetY), theme.motion.spring);

  $effect(() => {
    if (reducedMotion) y.set(targetY, { instant: true });
    else y.target = targetY;
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
  class:flip
  class:breathe={visual.breathe && visual.zone !== 'queue'}
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
    aria-label="{task.title} 완료"
  ></button>

  <span class="body">
    <span class="title" style:font-weight={500 + Math.round(visual.urgency * 2) * 100}>
      {task.title}
    </span>
    <span class="due">{remaining}<span class="when">{deadline}</span></span>
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


  /* opacity로 흐리게 하면 스크림 위에서 대비가 4.5:1 아래로 떨어집니다.
     토큰 색을 직접 쓰고, 크기도 9.5px에서 10px로 올립니다. */
  .due {
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
   * 펼치면 세 줄이 됩니다 — 제목 / 남은 시간 / 마감일.
   *
   * 한 줄에 이어 붙이면 `5h 58m · 8/24(월) 01:35`가 190px쯤 되는데, 주제를
   * 하나만 보이게 두면 레인이 158px이고 패널 자체가 194px입니다. 옆으로는
   * 갈 데가 없어 그대로 창 밖에서 잘렸습니다. 줄을 바꾸면 필요한 폭이 가장
   * 긴 한 줄만큼으로 줄어듭니다.
   *
   * 카드는 아래를 붙잡고 위로 자랍니다. 이 위젯에서 높이는 시각이고 카드의
   * 아래 모서리가 그 시각이므로, 위로 자라는 동안 그 뜻은 그대로입니다.
   */
  .card:hover .when {
    display: block;
    margin-top: 1px;
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
