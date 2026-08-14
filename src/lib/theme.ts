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
    columnHeight: number;
    cardHeight: number;
    queueGap: number;
    /** 컬럼 높이 중 활주로가 차지하는 비율 */
    runwayRatio: number;
    floor: number;
    maxQueueVisible: number;
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

/** 활주로 경계선의 바닥 기준 높이(px) */
export function boundaryY(t: Theme = theme): number {
  return Math.round(t.layout.columnHeight * t.layout.runwayRatio);
}

/** 활주로 안에서 카드가 움직일 수 있는 세로 범위(px) */
export function runwayTravel(t: Theme = theme): number {
  return boundaryY(t) - t.layout.floor - t.layout.cardHeight - 8;
}
