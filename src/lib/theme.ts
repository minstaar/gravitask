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
    /** 활주로 구역의 높이. 오늘 마감이 여러 건 몰리는 일은 드물어서
     *  기둥의 큰 비중을 줄 이유가 없습니다 */
    runwayHeight: number;
    cardHeight: number;
    queueGap: number;
    overdueGap: number;
    minQueueHeight: number;
    floor: number;
    maxQueueVisible: number;
    columnWidth: number;
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
    /** 조작 중일 때. 배경이 비치면 글자를 읽기 어려우므로 불투명에 가깝게 */
    backgroundActive: string;
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
