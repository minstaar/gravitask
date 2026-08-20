/**
 * 긴급도의 단일 진실 공급원.
 *
 * 원칙: 남은 시간 → 0~1 긴급도 값 하나를 만들고, 모든 시각 속성(색·반경·굵기·
 * 고도·모션)을 그 값에서 파생시킵니다. 컴포넌트가 자기 마음대로 "3일 이하면
 * 빨강" 같은 판단을 하기 시작하면 일관성이 무너집니다.
 */

// 확장자를 붙입니다. 테스트를 번들러 없이 node로 바로 돌리기 때문에
// (package.json의 test:format) 해석 규칙이 ESM 그대로여야 합니다.
import { theme, type RampStep, type Theme } from './theme.ts';

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
 * `2d 12h`, `3h 25m` 꼴로 줄입니다.
 *
 * 버림으로 통일합니다. 반올림을 섞으면 틱마다 경계에서 숫자가 오르내리고,
 * 주변시에 걸리는 움직임은 이 위젯이 가장 아껴 써야 하는 자원입니다.
 *
 * 눈금은 남은 시간에 따라 갈립니다. 하루 안쪽은 분까지 적습니다 — 오늘 안에
 * 끝내야 하는 일에서 `6h`와 `6h 55m`은 저녁 계획이 달라지는 차이입니다.
 * 하루 밖은 시간까지, 일주일 밖은 날까지만 적습니다. 12일 뒤 일의 7시간을
 * 행동에 쓰는 사람은 없으므로 그 자리는 정보가 아니라 잡음입니다.
 *
 * 0인 단위는 적지 않습니다 — `1d 0h`가 아니라 `1d`, `6h 0m`이 아니라 `6h`.
 */
const DAY_ONLY_FROM = 7;

/** 하루 밖 — 날과 시간 */
function compactDays(hours: number): string {
  const total = Math.max(0, Math.floor(hours));
  const d = Math.floor(total / 24);
  const h = total % 24;
  if (d >= DAY_ONLY_FROM || h === 0) return `${d}d`;
  return `${d}d ${h}h`;
}

/** 하루 안쪽 — 시간과 분 */
function compactMinutes(hours: number): string {
  const total = Math.max(0, Math.floor(hours * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function compact(hours: number): string {
  return hours < 24 ? compactMinutes(hours) : compactDays(hours);
}

/**
 * 급할수록 정확한 정보를 줍니다.
 *
 * 고정폭 라틴 문자는 이 위젯에서 시간 축의 언어입니다 — 눈금이 12h, 경계선이
 * 24h, 마감선이 DUE입니다. 남은 시간도 같은 채널에 둡니다. `2.5일`은 0.5일을
 * 12시간으로 환산해야 읽히지만 `2d 12h`는 그대로 읽힙니다.
 *
 * 남음에는 접미사를 붙이지 않습니다. 남은 시간이 이 위젯의 기본 관심사라
 * 카드마다 같은 두 글자가 반복될 뿐이고, 그 폭은 좁은 레인에서 제목이 써야
 * 할 자리입니다. 지남은 예외라서 글로도 적습니다 — 색과 사선 패턴에만
 * 맡기면 색으로 상태를 나르는 셈이 됩니다.
 */
export function formatRemaining(due: number, now: number, zone: Zone): string {
  const h = hoursUntil(due, now);

  if (zone === 'overdue') {
    const past = -h;
    if (past < 1 / 60) return '방금 지남';
    return `${compact(past)} 지남`;
  }

  return compact(h);
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * 마감 시각 그 자체. 카드에 손을 올렸을 때만 보입니다.
 *
 * 남은 시간과 마감 시각은 같은 것을 다르게 묻습니다 — "얼마나 급한가"와
 * "언제까지인가"입니다. 앞의 것이 이 위젯의 기본 관심사라 늘 보이는 자리를
 * 차지하고, 뒤의 것은 계획을 세울 때 필요하니 물어볼 때만 나옵니다. 한 칸에
 * 번갈아 넣으면 둘 다 흐려집니다.
 *
 * 오늘·내일·어제는 날짜 대신 그렇게 적습니다. 하루 안쪽에서 급한 사람에게
 * `8/18(화)`는 한 번 더 계산해야 하는 정보입니다.
 */
export function formatDeadline(due: number, now: number): string {
  const d = new Date(due);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const n = new Date(now);
  const days = Math.round((midnight(d) - midnight(n)) / 86_400_000);

  if (days === 0) return `오늘 ${time}`;
  if (days === 1) return `내일 ${time}`;
  if (days === -1) return `어제 ${time}`;

  const md = `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
  if (d.getFullYear() === n.getFullYear()) return `${md} ${time}`;
  return `${d.getFullYear()}/${md} ${time}`;
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
