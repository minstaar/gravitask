/**
 * 긴급도의 단일 진실 공급원.
 *
 * 원칙: 남은 시간 → 0~1 긴급도 값 하나를 만들고, 모든 시각 속성(색·반경·굵기·
 * 고도·모션)을 그 값에서 파생시킵니다. 컴포넌트가 자기 마음대로 "3일 이하면
 * 빨강" 같은 판단을 하기 시작하면 일관성이 무너집니다.
 */

import { theme, type RampStep, type Theme } from './theme';

export const MS_HOUR = 3_600_000;

export type Zone = 'queue' | 'runway' | 'overdue';

export interface Visual {
  /** 0(여유) ~ 1(마감 직전). 지난 항목은 1 */
  urgency: number;
  zone: Zone;
  step: RampStep | { id: 'overdue'; color: string; label: string };
  color: string;
  radius: number;
  stripe: number;
  fillAlpha: number;
  lift: number;
  /** 호흡 모션을 켤지. 야간 억제와 reduced-motion이 여기서 반영됨 */
  breathe: boolean;
}

export function hoursUntil(due: number, now: number): number {
  return (due - now) / MS_HOUR;
}

/**
 * 비선형 긴급도. 선형으로 매핑하면 마지막 하루가 밋밋해서,
 * curve(<1)로 압축해 막판에 급격히 치솟게 합니다.
 */
export function urgencyOf(hoursLeft: number, t: Theme = theme): number {
  if (hoursLeft <= 0) return 1;
  const { horizonHours, curve } = t.urgency;
  const frac = Math.min(1, hoursLeft / horizonHours);
  return 1 - Math.pow(frac, curve);
}

export function rampFor(hoursLeft: number, t: Theme = theme) {
  if (hoursLeft <= 0) return { id: 'overdue' as const, ...t.urgency.overdue };
  for (const step of t.urgency.ramp) {
    if (step.withinHours === null || hoursLeft <= step.withinHours) return step;
  }
  return t.urgency.ramp[t.urgency.ramp.length - 1];
}

export function zoneOf(hoursLeft: number, t: Theme = theme): Zone {
  if (hoursLeft <= 0) return 'overdue';
  return hoursLeft <= t.layout.runwayHours ? 'runway' : 'queue';
}

/** 야간이면 채도를 낮추고 모션을 끕니다. 밤에 빨간 게 깜빡이면 위젯을 끄게 됩니다. */
export function isNight(now: Date, t: Theme = theme): boolean {
  if (!t.night.enabled) return false;
  const h = now.getHours();
  const { startHour, endHour } = t.night;
  return startHour > endHour ? h >= startHour || h < endHour : h >= startHour && h < endHour;
}

export function visualFor(
  hoursLeft: number,
  now: Date,
  opts: { reducedMotion?: boolean; t?: Theme } = {}
): Visual {
  const t = opts.t ?? theme;
  const u = urgencyOf(hoursLeft, t);
  const zone = zoneOf(hoursLeft, t);
  const step = rampFor(hoursLeft, t);
  const night = isNight(now, t);
  const c = t.card;

  const color = night ? desaturate(step.color, t.night.saturationScale) : step.color;
  const motionOk =
    t.motion.enabled && !opts.reducedMotion && (!night || t.night.motionScale > 0);

  return {
    urgency: u,
    zone,
    step,
    color,
    radius: lerp(c.radiusCalm, c.radiusUrgent, u),
    stripe: lerp(c.stripeCalm, c.stripeUrgent, u),
    fillAlpha: lerp(c.fillAlphaCalm, c.fillAlphaUrgent, u),
    lift: lerp(0, c.liftUrgent, u),
    breathe: motionOk && zone !== 'queue',
  };
}

/* ---------- 표기법 ---------- */

/**
 * 급할수록 정확한 정보를 줍니다. 대기 구역은 상대 표기로 충분하지만
 * 활주로는 시간 단위, 1시간 이내면 절대 시각을 보여줍니다.
 */
export function formatRemaining(due: number, now: number, zone: Zone): string {
  const h = hoursUntil(due, now);

  if (zone === 'overdue') {
    const past = -h;
    if (past < 1) return `${Math.round(past * 60)}분 지남`;
    if (past < 24) return `${Math.floor(past)}시간 지남`;
    return `${Math.floor(past / 24)}일 지남`;
  }

  if (zone === 'runway') {
    if (h < 1) {
      const d = new Date(due);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}까지`;
    }
    return `${Math.floor(h)}시간 남음`;
  }

  const days = h / 24;
  if (days < 10) return `${days.toFixed(1)}일 남음`;
  return `${Math.round(days)}일 남음`;
}

/* ---------- 색 유틸 ---------- */

export function withAlpha(hex: string, a: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** 지난 항목은 색만으로 구분하지 않고 사선 패턴을 함께 씁니다 */
export function stripePattern(hex: string): string {
  return `repeating-linear-gradient(45deg, ${withAlpha(hex, 0.32)} 0 6px, ${withAlpha(hex, 0.14)} 6px 12px)`;
}

function hexToRgb(hex: string) {
  const s = hex.replace('#', '');
  const n = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return {
    r: parseInt(n.slice(0, 2), 16),
    g: parseInt(n.slice(2, 4), 16),
    b: parseInt(n.slice(4, 6), 16),
  };
}

function desaturate(hex: string, scale: number): string {
  const { r, g, b } = hexToRgb(hex);
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  const mix = (v: number) => Math.round(gray + (v - gray) * scale);
  const hx = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  return `#${hx(mix(r))}${hx(mix(g))}${hx(mix(b))}`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}
