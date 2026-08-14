import raw from './theme.json';

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
    queueGap: number;
    overdueGap: number;
    minQueueHeight: number;
    floor: number;
    maxQueueVisible: number;
    /** 레인 하나의 선호 폭. 범주가 적을 때 쓰는 값입니다 */
    laneWidth: number;
    /** 레인이 좁아질 수 있는 하한. 이보다 좁으면 제목이 거의 안 남습니다 */
    laneMin: number;
    /** 위젯 내용 폭의 상한. 범주가 늘어도 화면을 잠식하지 않게 막습니다 */
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
