import raw from './theme.json' with { type: 'json' };

export interface RampStep {
  id: string;
  /** 이 단계에 속하는 상한(시간). null이면 그 이상 전부 */
  withinHours: number | null;
  color: string;
  label: string;
}

export interface Theme {
  name: string;
  author: string;
  layout: {
    /** 활주로 구역의 경계. 이 시간 이내면 시간 눈금 위에 놓입니다 */
    runwayHours: number;
    /** 오늘 마감이 있을 때의 활주로 높이 */
    runwayHeight: number;
    /** 오늘 마감이 없을 때. 지남 구역처럼, 쓸 일이 없으면 자리를 비웁니다 */
    runwayCollapsed: number;
    /** 활주로 눈금 위치(0~1). 촘촘하면 오히려 안 읽힙니다 */
    runwayTicks: number[];
    cardHeight: number;
    /**
     * 카드끼리 최소로 벌어져야 하는 간격.
     *
     * 세 구역이 하나를 같이 씁니다. 예전에는 구역마다 따로 있어서 실효 간격이
     * 4·5·6px로 미묘하게 달랐는데, 그 차이에 뜻이 있었던 게 아니라 값이
     * 흩어져 있었을 뿐입니다.
     */
    cardGap: number;
    minQueueHeight: number;
    floor: number;
    /**
     * 경계선과 대기 구역 첫 카드 사이 간격.
     *
     * 0입니다 — 첫 카드가 경계선에 붙습니다. 하루 안쪽 일은 어차피 활주로로
     * 떨어지므로, 이 선 바로 위에 있다는 건 '곧 활주로로 내려온다'는 뜻이고
     * 붙어 있는 편이 그 사실을 더 잘 말합니다.
     *
     * 한때 24h 라벨을 피하느라 20까지 벌렸지만, 라벨을 왼쪽 축으로 옮기면서
     * 그 이유가 사라졌습니다.
     */
    queueTop: number;
    /**
     * 기둥이 화면 높이에서 차지할 수 있는 최대 비율.
     *
     * 구역마다 최대 개수를 손으로 정하는 대신, 예산 하나를 두고 거기서
     * 구역 높이를 나눠 씁니다. 개수 상한은 화면이 정할 일이지 사람이 미리
     * 맞힐 수 있는 값이 아닙니다 — 노트북과 외부 모니터에서 답이 다릅니다.
     *
     * 예산에 안 들어가는 항목은 접히는 게 아니라 구역 안에서 끌어 볼 수
     * 있습니다. 그래서 이 값을 줄여도 정보를 잃지는 않습니다.
     */
    maxHeightFraction: number;
    /** 화면이 아무리 작아도 기둥이 이보다 짧아지지는 않습니다 */
    minColumnHeight: number;
    /**
     * 한 번에 보여줄 주제 수의 기본값. 사용자가 바꿀 수 있습니다.
     *
     * 주제가 늘 때마다 위젯이 옆으로 자라면 안 됩니다. maxWidth가 그걸 막는
     * 값이었지만 실제로는 laneMin이 이겨서 상한 노릇을 못 했습니다 — 7주제면
     * 1166px까지 벌어졌습니다. 폭을 고정하려면 레인 수를 고정하는 수밖에 없고,
     * 나머지 주제는 페이지를 넘겨서 봅니다.
     */
    topicsPerPage: number;
    /** 레인 하나의 선호 폭. 주제가 적을 때 쓰는 값입니다 */
    laneWidth: number;
    /** 레인이 좁아질 수 있는 하한. 이보다 좁으면 제목이 거의 안 남습니다 */
    laneMin: number;
    /** 위젯 내용 폭의 상한. 주제가 늘어도 화면을 잠식하지 않게 막습니다 */
    maxWidth: number;
    laneGap: number;
    /** 시간 눈금이 들어가는 왼쪽 여백 */
    gutter: number;
  };
  /** 글자 크기(px). 위젯은 흘끗 보는 물건이라 본문이 작으면 제 역할을 못 합니다 */
  type: {
    title: number;
    due: number;
    category: number;
    /** 개수, 경계선 라벨 등 */
    meta: number;
    /** 시간 눈금 */
    axis: number;
  };
  urgency: {
    horizonHours: number;
    curve: number;
    ramp: RampStep[];
    overdue: { color: string; label: string };
  };
  card: {
    radiusCalm: number;
    radiusUrgent: number;
    stripeCalm: number;
    stripeUrgent: number;
    fillAlphaCalm: number;
    fillAlphaUrgent: number;
    liftUrgent: number;
  };
  motion: {
    enabled: boolean;
    breatheSeconds: number;
    breatheOpacity: number;
    spring: { stiffness: number; damping: number };
    completeMs: number;
  };
  night: {
    enabled: boolean;
    startHour: number;
    endHour: number;
    saturationScale: number;
    motionScale: number;
  };
  surface: {
    background: string;
    /** 로고 GRAVI / TASK 두 색. 아이콘과 같은 짝을 씁니다 */
    brandWarm: string;
    brandCool: string;
    /** 조작 중 위젯 뒤에 까는 판. 배경화면이 비치면 글자를 읽기 어렵습니다 */
    backdrop: string;
    /** 판의 위쪽 가장자리 색. 미묘한 기울기가 순색 판보다 덜 투박합니다 */
    backdropEdge: string;
    border: string;
    blur: number;
    text: string;
    textMuted: string;
    axis: string;
    boundary: string;
    deadline: string;
  };
}

export const theme: Theme = raw as Theme;
