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
    reducedMotion = false,
    onToggle,
  }: {
    task: Task;
    visual: Visual;
    targetY: number;
    remaining: string;
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
  class:breathe={visual.breathe && visual.zone !== 'queue'}
  data-zone={visual.zone}
  data-target={targetY}
  out:fall={{ duration: reducedMotion ? 0 : theme.motion.completeMs }}
  style:bottom="{y.current}px"
  style:height="{theme.layout.cardHeight}px"
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
    <span class="due">{remaining}</span>
  </span>
</div>

<style>
  /* 레인 폭을 그대로 씁니다. 범주는 레인 머리가 밝히므로 카드는 제목과
     남은 시간만 담고, 좁은 폭에서는 제목을 말줄임합니다. */
  .card {
    position: absolute;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px 0 9px;
    border: 1px solid rgba(255, 255, 255, 0.09);
    overflow: hidden;
    box-sizing: border-box;
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


  /* opacity로 흐리게 하면 스크림 위에서 대비가 4.5:1 아래로 떨어집니다.
     토큰 색을 직접 쓰고, 크기도 9.5px에서 10px로 올립니다. */
  .due {
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: var(--fs-due);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    margin-top: 1px;
  }

  .check {
    flex: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1.5px solid;
    background: transparent;
    cursor: pointer;
    padding: 0;
  }

  .check:hover {
    background: rgba(255, 255, 255, 0.18);
  }

  :global(button:focus-visible) {
    outline: 2px solid rgba(255, 255, 255, 0.7);
    outline-offset: 2px;
  }

  /* 주변시에 걸리는 유일한 채널. 절대 과하게 쓰지 말 것 */
  .breathe {
    animation: breathe 6s ease-in-out infinite;
  }

  @keyframes breathe {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(0, 0, 0, 0);
    }
    50% {
      box-shadow: 0 0 0 3px var(--glow), 0 0 16px var(--glow);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .breathe {
      animation: none;
    }
  }
</style>
