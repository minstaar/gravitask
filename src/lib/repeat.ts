// 확장자를 붙입니다 — 테스트를 번들러 없이 node로 바로 돌립니다 (layout.ts와 같은 이유)

/**
 * 반복 일정.
 *
 * 카드는 언제나 '다음 회차' 한 장입니다.
 *
 * 회차를 미리 다 만드는 방법도 있었습니다. 그러면 회차마다 따로 고치고 지울
 * 수 있지만, 매주 수업 다섯 과목에 한 학기를 걸면 대기 구역에 카드 75장이
 * 쌓입니다. 이 위젯은 흘끗 보고 아는 물건이라, 그 순간 목록 앱이 되고 본업을
 * 잃습니다. 그리고 끝을 정하지 않는 반복('계속')은 아예 표현할 수 없습니다 —
 * 무한한 카드를 만들 수는 없으니까요.
 *
 * 그래서 규칙만 카드에 붙여 두고, 완료할 때 그 카드를 다음 날짜로 굴립니다.
 * 레인에는 언제나 한 장이고, 끝을 안 정해도 됩니다.
 *
 * 대신 잃는 것도 있습니다 — 이번 주 회차만 따로 미루거나 지울 수 없습니다.
 * 그건 캘린더가 하는 일이고, 이 위젯이 답하는 질문("지금 뭐가 급한가")에는
 * 다음 회차 하나면 충분합니다.
 */

export type RepeatUnit = 'day' | 'week' | 'month';

export interface Repeat {
  unit: RepeatUnit;
  /** 간격. 격주면 unit='week', every=2 */
  every: number;
  /**
   * 주간 반복이 찾아오는 요일들 (0=일 … 6=토).
   *
   * 없으면 '마감일의 요일을 따라간다'는 뜻입니다. 값을 비워 둘 수 있게 한
   * 것은, 사용자가 요일을 직접 고르지 않았는데 날짜를 바꿨을 때 반복이
   * 옛 요일에 묶여 있으면 안 되기 때문입니다. 고른 적이 없으면 따라가고,
   * 한 번이라도 고르면 그 선택이 이깁니다.
   */
  weekdays?: number[];
  /**
   * 월간 반복이 찾아오는 날짜(1~31).
   *
   * 굴릴 때마다 현재 마감일에서 다시 세면 31일이 2월에 28일로 당겨진 뒤
   * 그대로 28일에 눌러앉습니다. 원래 날짜를 붙들고 있어야 3월에 다시 31일로
   * 돌아옵니다. 짧은 달에서만 그 달 마지막 날로 당깁니다.
   */
  monthDay?: number;
  /**
   * 앞으로 남은 회차 수. 지금 화면에 있는 카드가 그중 하나입니다.
   * null이면 끝을 정하지 않은 것입니다.
   */
  left: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

/** 월~금 */
export const WEEKDAYS_ONLY = [1, 2, 3, 4, 5];

function addDays(t: number, n: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** 오름차순, 중복 없이. 비면 null */
function cleanWeekdays(list: number[] | undefined): number[] | null {
  if (!list) return null;
  const set = [...new Set(list.filter((w) => Number.isInteger(w) && w >= 0 && w <= 6))];
  return set.length > 0 ? set.sort((a, b) => a - b) : null;
}

/**
 * 비어 있는 자리를 마감일에서 채웁니다.
 *
 * 규칙만 봐서는 "매주"가 무슨 요일인지, "매월"이 며칠인지 알 수 없습니다.
 * 그 답은 첫 회차가 쥐고 있습니다. 저장하기 직전에 한 번 채워 두면, 그 뒤로는
 * 마감일이 굴러가도 규칙이 흔들리지 않습니다.
 */
export function normalizeRepeat(r: Repeat, due: number): Repeat {
  const every = Math.max(1, Math.round(r.every));
  const left = r.left === null ? null : Math.max(1, Math.round(r.left));
  const d = new Date(due);

  if (r.unit === 'week') {
    return { unit: 'week', every, left, weekdays: cleanWeekdays(r.weekdays) ?? [d.getDay()] };
  }
  if (r.unit === 'month') {
    return { unit: 'month', every, left, monthDay: r.monthDay ?? d.getDate() };
  }
  return { unit: 'day', every, left };
}

/**
 * 바로 다음 회차.
 *
 * 시각은 그대로 옮겨 갑니다. 매주 월요일 23:59이던 것이 다음 주에 00:00이
 * 되면 그건 다른 마감입니다.
 */
export function nextOccurrence(due: number, r: Repeat): number {
  const rule = normalizeRepeat(r, due);
  const d = new Date(due);

  if (rule.unit === 'day') return addDays(due, rule.every);

  if (rule.unit === 'week') {
    const wds = rule.weekdays!;
    const cur = d.getDay();
    const later = wds.find((w) => w > cur);
    // 이번 주에 남은 요일이 있으면 거기로, 없으면 every주 뒤 그 주의 첫 요일로.
    if (later !== undefined) return addDays(due, later - cur);
    return addDays(due, 7 - cur + (rule.every - 1) * 7 + wds[0]);
  }

  // 달을 넘길 때는 날짜가 있는 달로만 갑니다. 2월 31일은 없으므로 28(29)일로
  // 당기되, monthDay가 31을 기억하고 있어서 3월에는 다시 31일로 돌아옵니다.
  const day = rule.monthDay!;
  const y = d.getFullYear();
  const m = d.getMonth() + rule.every;
  const lastOfMonth = new Date(y, m + 1, 0).getDate();
  const at = new Date(y, m, Math.min(day, lastOfMonth));
  at.setHours(d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  return at.getTime();
}

/**
 * 첫 회차를 규칙 위로 옮깁니다.
 *
 * "평일 스탠드업"을 토요일에 적으면 첫 회차가 일요일이 됩니다 — 규칙이
 * 평일이라고 말하는데 첫 카드가 주말인 것은 그 자리에서 틀린 값입니다.
 * 요일을 직접 고른 경우에만 움직입니다. 고르지 않았으면 마감일이 곧 규칙이라
 * 옮길 이유가 없습니다.
 */
export function alignToRepeat(due: number, r: Repeat): number {
  if (r.unit !== 'week') return due;
  const wds = cleanWeekdays(r.weekdays);
  if (!wds) return due;
  const cur = new Date(due).getDay();
  if (wds.includes(cur)) return due;
  // 최대 6일이면 반드시 만납니다
  const ahead = wds.find((w) => w > cur);
  return addDays(due, ahead !== undefined ? ahead - cur : 7 - cur + wds[0]);
}

export interface Rolled {
  due: number;
  repeat: Repeat;
}

/**
 * 한 회차를 끝내고 다음으로 굴립니다. 시리즈가 끝났으면 null.
 *
 * 지나간 회차는 건너뜁니다. 3주를 놓친 주간 과제를 오늘 체크했을 때 다음
 * 카드가 2주 전으로 나오면, 굴리자마자 이미 지난 카드를 다시 보게 됩니다.
 *
 * 건너뛴 회차도 남은 횟수에서 깎습니다. 열다섯 번 있는 수업은 안 갔어도
 * 열다섯 번입니다 — 빠뜨린 만큼 학기가 길어지지는 않습니다.
 */
export function rollRepeat(due: number, r: Repeat, now: number): Rolled | null {
  const rule = normalizeRepeat(r, due);
  let left = rule.left;
  let cur = due;

  // 마감이 아주 오래 지난 항목에서 무한정 돌지 않게 막습니다. 매일 반복이면
  // 500회는 1년 4개월치라, 여기 걸릴 만큼 방치된 반복은 끝난 것으로 봅니다.
  for (let step = 0; step < 500; step++) {
    if (left !== null && left <= 1) return null; // 방금 끝낸 것이 마지막 회차
    const next = nextOccurrence(cur, rule);
    if (next <= cur) return null; // 규칙이 앞으로 가지 않으면 더 굴릴 수 없습니다
    cur = next;
    if (left !== null) left -= 1;
    if (cur > now) return { due: cur, repeat: { ...rule, left } };
  }
  return null;
}

/* ---------- 사람이 읽는 말 ---------- */

/** "매주 월·수", "격주 금", "평일", "매일", "매월 15일" */
export function describeCycle(r: Repeat, due?: number): string {
  const rule = due === undefined ? r : normalizeRepeat(r, due);

  if (rule.unit === 'day') return rule.every === 1 ? '매일' : `${rule.every}일마다`;

  if (rule.unit === 'month') {
    const day = rule.monthDay;
    const head = rule.every === 1 ? '매월' : `${rule.every}개월마다`;
    return day ? `${head} ${day}일` : head;
  }

  const wds = cleanWeekdays(rule.weekdays);
  const head = rule.every === 1 ? '매주' : rule.every === 2 ? '격주' : `${rule.every}주마다`;
  if (!wds) return head;
  // 월~금이 전부 켜져 있으면 요일을 다섯 개 늘어놓는 것보다 이름 하나가 짧고
  // 뜻도 분명합니다.
  if (rule.every === 1 && wds.length === 5 && WEEKDAYS_ONLY.every((w) => wds.includes(w))) {
    return '평일';
  }
  return `${head} ${wds.map((w) => WEEKDAY_NAMES[w]).join('·')}`;
}

/** "계속", "15회 남음" */
export function describeCount(left: number | null): string {
  return left === null ? '계속' : `${left}회 남음`;
}

/** 칩과 카드에 붙는 한 줄 */
export function describeRepeat(r: Repeat, due?: number): string {
  return `${describeCycle(r, due)} · ${describeCount(r.left)}`;
}

/* ---------- 화면에 늘어놓는 선택지 ---------- */

export interface CyclePreset {
  id: string;
  label: string;
  /** 이 주기를 고르면 만들어지는 규칙 (left는 따로 고릅니다) */
  make: (due: number) => Omit<Repeat, 'left'>;
  /** 요일을 직접 고를 수 있는 주기인가 */
  weekly: boolean;
}

/**
 * 주기 선택지.
 *
 * '평일'을 따로 둡니다. 매주 반복에서 월~금을 다섯 번 눌러도 같은 값이지만,
 * 학기 중에 매일 하는 일은 대개 주말을 빼기 때문에 그 다섯 번이 자주
 * 반복됩니다. 자주 하는 일에는 이름이 있어야 합니다.
 */
export const CYCLE_PRESETS: CyclePreset[] = [
  { id: 'day', label: '매일', make: () => ({ unit: 'day', every: 1 }), weekly: false },
  {
    id: 'weekday',
    label: '평일',
    make: () => ({ unit: 'week', every: 1, weekdays: [...WEEKDAYS_ONLY] }),
    weekly: true,
  },
  {
    id: 'week',
    label: '매주',
    make: (due) => ({ unit: 'week', every: 1, weekdays: [new Date(due).getDay()] }),
    weekly: true,
  },
  {
    id: 'biweek',
    label: '격주',
    make: (due) => ({ unit: 'week', every: 2, weekdays: [new Date(due).getDay()] }),
    weekly: true,
  },
  {
    id: 'month',
    label: '매월',
    make: (due) => ({ unit: 'month', every: 1, monthDay: new Date(due).getDate() }),
    weekly: false,
  },
];

/** 지금 규칙이 어느 선택지에 해당하는가. 어디에도 안 맞으면 null */
export function cycleIdOf(r: Repeat | null): string | null {
  if (!r) return null;
  if (r.unit === 'day' && r.every === 1) return 'day';
  if (r.unit === 'month' && r.every === 1) return 'month';
  if (r.unit === 'week') {
    const wds = cleanWeekdays(r.weekdays);
    if (r.every === 1 && wds && wds.length === 5 && WEEKDAYS_ONLY.every((w) => wds.includes(w))) {
      return 'weekday';
    }
    if (r.every === 1) return 'week';
    if (r.every === 2) return 'biweek';
  }
  return null;
}

/**
 * 횟수 선택지.
 *
 * '계속'이 기본입니다 — 반복을 거는 시점에 몇 번인지 아는 경우가 오히려
 * 드물고, 모르면서 숫자를 고르게 하면 아무 숫자나 찍게 됩니다. 끝은 나중에
 * 카드를 우클릭해 '반복 끝내기'로 정할 수 있습니다.
 *
 * 15는 한 학기 수업 횟수, 30은 한 달치 매일입니다. 5와 10은 몇 주짜리 단기
 * 과제 몫입니다. 여기 없는 숫자는 직접 적습니다.
 */
export const COUNT_PRESETS: (number | null)[] = [null, 5, 10, 15, 30];

/** 직접 입력의 상한. 이보다 길면 '계속'과 다를 바 없습니다 */
export const MAX_COUNT = 99;

export function clampCount(n: number): number {
  return Math.max(1, Math.min(MAX_COUNT, Math.round(n)));
}

/** 하루를 밀리초로 — 테스트에서 씁니다 */
export const REPEAT_DAY_MS = DAY_MS;
