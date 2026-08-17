/**
 * 한국어 한 줄 입력 파서.
 *
 * "확률론 과제 내일 오후 6시" → { title: "확률론 과제", due: <내일 18:00> }
 *
 * 날짜 선택기를 클릭하게 만드는 순간 사용자는 위젯을 안 씁니다.
 * 그래서 이 파서가 v1의 마찰을 결정합니다 — 실패하더라도 title은 항상
 * 살려서 돌려주고, due는 null로 두어 사용자가 보완하게 합니다.
 */

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export interface ParsedInput {
  title: string;
  /** 파싱 실패 시 null */
  due: Date | null;
  /** 입력에서 날짜로 해석된 조각 (UI 미리보기용) */
  dateText: string | null;
  /** 입력에서 시각으로 해석된 조각 */
  timeText: string | null;
}

interface Hit<T> {
  value: T;
  text: string;
  start: number;
  end: number;
}

/* ---------- 날짜 유틸 ---------- */

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** 이번 주 월요일 00:00 */
function mondayOf(d: Date): Date {
  const x = startOfDay(d);
  const shift = (x.getDay() + 6) % 7; // 월=0 … 일=6
  return addDays(x, -shift);
}

/** 오늘 포함 다음 해당 요일 */
function upcomingWeekday(base: Date, wd: number): Date {
  const today = startOfDay(base);
  const diff = (wd - today.getDay() + 7) % 7;
  return addDays(today, diff);
}

function lastDayOfMonth(d: Date): Date {
  const x = startOfDay(d);
  return new Date(x.getFullYear(), x.getMonth() + 1, 0);
}

/** 월/일만 주어졌을 때 — 이미 지났으면 내년으로 */
function resolveMonthDay(base: Date, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const today = startOfDay(base);
  let y = today.getFullYear();
  let d = new Date(y, month - 1, day);
  if (d.getMonth() !== month - 1) return null; // 2월 30일 같은 날짜
  if (d < today) d = new Date(++y, month - 1, day);
  return d;
}

/** 일만 주어졌을 때 — 이미 지났으면 다음 달로 */
function resolveDayOfMonth(base: Date, day: number): Date | null {
  if (day < 1 || day > 31) return null;
  const today = startOfDay(base);
  let d = new Date(today.getFullYear(), today.getMonth(), day);
  if (d.getDate() !== day) return null;
  if (d < today) {
    d = new Date(today.getFullYear(), today.getMonth() + 1, day);
    if (d.getDate() !== day) return null;
  }
  return d;
}

/**
 * 그 달의 n번째 X요일. nth가 -1이면 마지막 X요일입니다.
 *
 * "9월 첫째 주 금요일"에는 읽는 방법이 둘 있습니다 — (가) 9월의 첫 번째
 * 금요일, (나) 9월이 걸쳐 있는 첫 주(월~일)의 금요일. 대개 같은 날이지만
 * 달이 주 후반에 시작하면 갈립니다. 2026년 8월 1일은 토요일인데, (나)로
 * 읽으면 "8월 첫째 주 금요일"이 7월 31일이 됩니다. 8월 일을 적었는데 7월
 * 날짜가 나오는 것은 누가 봐도 틀린 답입니다.
 *
 * 그래서 (가)로 읽습니다. 캘린더의 반복 규칙(BYDAY=1FR)도 같은 뜻입니다.
 */
function nthWeekday(year: number, month: number, nth: number, wd: number): Date {
  const eom = new Date(year, month, 0); // 그 달의 마지막 날
  const lastOne = new Date(year, month, -((eom.getDay() - wd + 7) % 7));
  if (nth === -1) return lastOne;

  const first = new Date(year, month - 1, 1);
  const shift = (wd - first.getDay() + 7) % 7;
  const d = new Date(year, month - 1, 1 + shift + (nth - 1) * 7);

  /*
   * 다섯째 주가 없는 달이 있습니다. 그럴 때는 마지막 것으로 당깁니다.
   *
   * 규칙을 통째로 버리면 아래의 요일 규칙이 '금요일'만 떼어 가서, "9월
   * 다섯째 주 금요일"이 8월의 어느 금요일이 되고 제목에는 '9월 다섯째 주'가
   * 남습니다. 적은 달과 다른 달의 날짜를 내놓느니, 적은 달 안에서 가장
   * 가까운 날을 내놓는 편이 알아보고 고치기 쉽습니다.
   */
  return d.getMonth() === month - 1 ? d : lastOne;
}

/** 달을 안 적었으면 이번 달, 이미 지났으면 다음 달(적었으면 내년)로 */
function resolveNthWeekday(
  base: Date,
  month: number | null,
  nth: number,
  wd: number
): Date | null {
  const today = startOfDay(base);

  if (month !== null) {
    if (month < 1 || month > 12) return null;
    const d = nthWeekday(today.getFullYear(), month, nth, wd);
    if (d >= today) return d;
    return nthWeekday(today.getFullYear() + 1, month, nth, wd);
  }

  const d = nthWeekday(today.getFullYear(), today.getMonth() + 1, nth, wd);
  if (d >= today) return d;

  const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return nthWeekday(next.getFullYear(), next.getMonth() + 1, nth, wd);
}

const NTH_WORDS: Record<string, number> = {
  마지막: -1,
  막: -1,
  첫째: 1, 첫: 1, 한: 1, '1': 1,
  둘째: 2, 둘: 2, 두: 2, '2': 2,
  셋째: 3, 셋: 3, 세: 3, '3': 3,
  넷째: 4, 넷: 4, 네: 4, '4': 4,
  다섯째: 5, 다섯: 5, '5': 5,
};

/* ---------- 날짜 매칭 ---------- */

type DateRule = { re: RegExp; make: (m: RegExpMatchArray, now: Date) => Date | null };

// 구체적인 패턴이 먼저 와야 합니다. "3일 뒤"가 "3일"보다 앞서야 하는 식.
const DATE_RULES: DateRule[] = [
  /**
   * "9월 첫 번째 주 금요일", "마지막주 수요일".
   *
   * 가장 먼저 봅니다. 아래의 요일 규칙이 "금요일"만 떼어 가면 '9월 첫 주'가
   * 통째로 제목에 남습니다.
   *
   * '요일'을 반드시 적게 한 것은 "1주일 뒤" 때문입니다. 요일을 한 글자만
   * 받으면 그 '일'을 일요일로 읽어 "첫째 주 일요일"이 되어 버립니다.
   */
  {
    re: /(?:(\d{1,2})\s*월\s*)?(마지막|막|다섯째|다섯|첫째|첫|둘째|둘|두|셋째|셋|세|넷째|넷|네|[1-5])\s*(?:번째|째)?\s*주\s*차?\s*(?:의\s*)?([일월화수목금토])요일/,
    make: (m, n) =>
      resolveNthWeekday(n, m[1] ? +m[1] : null, NTH_WORDS[m[2]], WEEKDAYS.indexOf(m[3])),
  },
  { re: /(\d{1,2})\s*월\s*(\d{1,2})\s*일/, make: (m, n) => resolveMonthDay(n, +m[1], +m[2]) },
  {
    re: /(?<![\d:])(\d{1,2})\s*[/.\-]\s*(\d{1,2})(?![\d:])/,
    make: (m, n) => resolveMonthDay(n, +m[1], +m[2]),
  },
  {
    re: /(?:다음|담)\s*주\s*([일월화수목금토])(?:요일)?/,
    make: (m, n) => {
      const wd = WEEKDAYS.indexOf(m[1]);
      return addDays(mondayOf(n), 7 + ((wd + 6) % 7));
    },
  },
  {
    re: /이번\s*주\s*([일월화수목금토])(?:요일)?/,
    make: (m, n) => addDays(mondayOf(n), (WEEKDAYS.indexOf(m[1]) + 6) % 7),
  },
  { re: /(?:다음|담)\s*주/, make: (_m, n) => addDays(mondayOf(n), 7) },
  { re: /(?:이번\s*달|이달|금월)\s*말|월말/, make: (_m, n) => lastDayOfMonth(n) },
  { re: /(?:다음|담)\s*달/, make: (_m, n) => addDays(lastDayOfMonth(n), 1) },
  { re: /(\d+)\s*주\s*(?:뒤|후|있다가)/, make: (m, n) => addDays(startOfDay(n), +m[1] * 7) },
  // "2주 뒤"는 위에서 받지만 "2주일 뒤"는 '주' 뒤에 '일'이 붙어 걸리지 않습니다.
  // 다른 자리는 모두 숫자를 받는데 여기만 한글 '일주일'만 받고 있었습니다.
  { re: /(\d+)\s*주일\s*(?:뒤|후|있다가)/, make: (m, n) => addDays(startOfDay(n), +m[1] * 7) },
  { re: /일\s*주일\s*(?:뒤|후)|일주일\s*(?:뒤|후)/, make: (_m, n) => addDays(startOfDay(n), 7) },
  { re: /(\d+)\s*일\s*(?:뒤|후|있다가)/, make: (m, n) => addDays(startOfDay(n), +m[1]) },
  { re: /내일\s*모레|모레/, make: (_m, n) => addDays(startOfDay(n), 2) },
  { re: /글피/, make: (_m, n) => addDays(startOfDay(n), 3) },
  { re: /내일|낼/, make: (_m, n) => addDays(startOfDay(n), 1) },
  { re: /오늘|금일/, make: (_m, n) => startOfDay(n) },
  {
    re: /([일월화수목금토])요일/,
    make: (m, n) => upcomingWeekday(n, WEEKDAYS.indexOf(m[1])),
  },
  { re: /(?<![\d:/.\-])(\d{1,2})\s*일(?!\s*(?:뒤|후|있다가))/, make: (m, n) => resolveDayOfMonth(n, +m[1]) },
];

function matchDate(input: string, now: Date): Hit<Date> | null {
  for (const rule of DATE_RULES) {
    const m = input.match(rule.re);
    if (!m || m.index === undefined) continue;
    const value = rule.make(m, now);
    if (!value) continue; // 유효하지 않은 날짜면 이 규칙은 없던 걸로
    return { value, text: m[0], start: m.index, end: m.index + m[0].length };
  }
  return null;
}

/* ---------- 시각 매칭 ---------- */

interface TimeOfDay {
  h: number;
  m: number;
}

/**
 * 오전/오후가 없는 맨 숫자 시각의 해석.
 * "6시 마감"은 거의 항상 오후 6시, "9시 수업"은 오전 9시입니다.
 * 완벽하진 않지만 실사용 분포에 맞고, 필요하면 여기만 고치면 됩니다.
 */
function disambiguateHour(h: number): number {
  if (h >= 1 && h <= 7) return h + 12;
  return h;
}

function matchTime(input: string): Hit<TimeOfDay> | null {
  const noon = input.match(/자정|정오/);
  if (noon && noon.index !== undefined) {
    const value = noon[0] === '자정' ? { h: 0, m: 0 } : { h: 12, m: 0 };
    return { value, text: noon[0], start: noon.index, end: noon.index + noon[0].length };
  }

  const colon = input.match(/(?<!\d)(\d{1,2}):(\d{2})(?!\d)/);
  if (colon && colon.index !== undefined) {
    const h = +colon[1];
    const m = +colon[2];
    if (h < 24 && m < 60) {
      return { value: { h, m }, text: colon[0], start: colon.index, end: colon.index + colon[0].length };
    }
  }

  const kr = input.match(
    /(오전|오후|아침|저녁|밤|새벽)?\s*(\d{1,2})\s*시\s*(?:(반)|(\d{1,2})\s*분)?/
  );
  if (kr && kr.index !== undefined) {
    const meridiem = kr[1];
    let h = +kr[2];
    const m = kr[3] ? 30 : kr[4] ? +kr[4] : 0;
    if (h > 24 || m > 59) return null;

    if (meridiem === '오후' || meridiem === '저녁' || meridiem === '밤') {
      if (h < 12) h += 12;
    } else if (meridiem === '오전' || meridiem === '아침' || meridiem === '새벽') {
      if (h === 12) h = 0;
    } else {
      h = disambiguateHour(h);
    }
    if (h >= 24) h -= 24;
    return { value: { h, m }, text: kr[0], start: kr.index, end: kr.index + kr[0].length };
  }

  return null;
}

/* ---------- 조립 ---------- */

function cut(input: string, hit: Hit<unknown> | null): string {
  if (!hit) return input;
  return input.slice(0, hit.start) + ' ' + input.slice(hit.end);
}

/**
 * 시각을 떼고 남은 조사만 정리합니다.
 *
 * '마감'은 떼지 않습니다. "6시까지"의 '까지'는 시각에 붙은 조사라 남으면
 * 어색하지만, '마감'은 "논문 마감", "과제 마감"처럼 제목의 일부인 경우가
 * 훨씬 흔합니다. 접미사로 취급하면 사용자가 쓴 제목을 말없이 잘라냅니다.
 */
function cleanTitle(s: string): string {
  return s
    .replace(/\s*(까지|까지야|까지임)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseTaskInput(input: string, now: Date = new Date()): ParsedInput {
  const dateHit = matchDate(input, now);
  const afterDate = cut(input, dateHit);
  const timeHit = matchTime(afterDate);
  const rest = cut(afterDate, timeHit);

  let due: Date | null = null;

  if (dateHit) {
    due = new Date(dateHit.value);
    if (timeHit) due.setHours(timeHit.value.h, timeHit.value.m, 0, 0);
    else due.setHours(23, 59, 0, 0); // 날짜만 주면 그날 끝이 마감
  } else if (timeHit) {
    due = startOfDay(now);
    due.setHours(timeHit.value.h, timeHit.value.m, 0, 0);
    if (due <= now) due = addDays(due, 1); // 이미 지난 시각이면 내일
  }

  return {
    title: cleanTitle(rest),
    due,
    dateText: dateHit?.text.trim() ?? null,
    timeText: timeHit?.text.trim() ?? null,
  };
}
