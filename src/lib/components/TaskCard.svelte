<script lang="ts">
  import { untrack } from 'svelte';
  import { Spring } from 'svelte/motion';
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
    onRemove,
  }: {
    task: Task;
    visual: Visual;
    targetY: number;
    remaining: string;
    reducedMotion?: boolean;
    onToggle: (t: Task) => void;
    onRemove: (id: string) => void;
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
</script>

<div
  class="card"
  class:breathe={visual.breathe && visual.zone !== 'queue'}
  data-zone={visual.zone}
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
    onclick={() => onToggle(task)}
    aria-label="{task.title} 완료"
  ></button>

  <span class="body">
    <span class="title" style:font-weight={500 + Math.round(visual.urgency * 2) * 100}>
      {task.title}
    </span>
    <span class="due">{remaining}</span>
  </span>

  <button class="kill" onclick={() => onRemove(task.id)} aria-label="{task.title} 삭제">×</button>
</div>

<style>
  .card {
    position: absolute;
    left: 54px;
    right: 2px;
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
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .due {
    font-family: 'Cascadia Code', Consolas, ui-monospace, monospace;
    font-size: 9.5px;
    opacity: 0.72;
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

  .kill {
    flex: none;
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.32);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    padding: 2px 3px;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .card:hover .kill {
    opacity: 1;
  }

  .kill:hover {
    color: rgba(255, 255, 255, 0.85);
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
