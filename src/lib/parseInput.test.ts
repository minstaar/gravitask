/**
 * 파서 명세. `npm run test:parse` 로 실행합니다.
 * (Node 24의 TypeScript 직접 실행을 씁니다 — 빌드 단계 없음)
 */
import { parseTaskInput } from './parseInput.ts';
import { alignToRepeat, describeCycle } from './repeat.ts';

// 기준 시각을 고정합니다: 2026-08-14 (금) 10:00
const NOW = new Date(2026, 7, 14, 10, 0, 0, 0);

const fmt = (d: Date | null) =>
  d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate()
      ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(
        d.getMinutes()
      ).padStart(2, '0')}`
    : 'null';

const cases: [input: string, title: string, due: string][] = [
  ['확률론 과제 내일 오후 6시', '확률론 과제', '2026-08-15 18:00'],
  ['졸업요건 신청 모레', '졸업요건 신청', '2026-08-16 23:59'],
  ['논문 초안 제출 다음주 화요일', '논문 초안 제출', '2026-08-18 23:59'],
  ['학회 등록비 8월 30일', '학회 등록비', '2026-08-30 23:59'],
  ['스터디 자료 3일 뒤 저녁 8시', '스터디 자료', '2026-08-17 20:00'],
  ['보고서 오늘 23:59', '보고서', '2026-08-14 23:59'],
  ['장학금 신청 이번달 말', '장학금 신청', '2026-08-31 23:59'],
  ['수업 준비 9시', '수업 준비', '2026-08-15 09:00'],
  ['회의록 6시까지', '회의록', '2026-08-14 18:00'],
  ['면담 신청 9/2', '면담 신청', '2026-09-02 23:59'],
  ['제출 20일', '제출', '2026-08-20 23:59'],
  ['운동 일주일 뒤', '운동', '2026-08-21 23:59'],
  ['팀플 회의 이번주 일요일 오후 2시', '팀플 회의', '2026-08-16 14:00'],
  ['논문 읽기 2주 뒤', '논문 읽기', '2026-08-28 23:59'],
  ['정기 점검 금요일', '정기 점검', '2026-08-14 23:59'],
  ['그냥 할 일', '그냥 할 일', 'null'],
  // '마감'은 제목의 일부다. 접미사로 떼면 사용자가 쓴 제목이 잘린다.
  ['논문 마감 9월 3일', '논문 마감', '2026-09-03 23:59'],
  ['과제 마감', '과제 마감', 'null'],
  ['보고서 마감 내일', '보고서 마감', '2026-08-15 23:59'],
  ['알바 새벽 2시', '알바', '2026-08-15 02:00'],
  ['과제 내일 3시 반', '과제', '2026-08-15 15:30'],

  // 그 달의 n번째 X요일. 2026년 9월 1일은 화요일이다.
  ['학과 세미나 9월 첫 번째 주 금요일', '학과 세미나', '2026-09-04 23:59'],
  ['특강 9월 셋째 주 목요일 오후 3시', '특강', '2026-09-17 15:00'],
  ['중간고사 9월 마지막주 수요일', '중간고사', '2026-09-30 23:59'],
  // 달을 안 적었고 이번 달 것은 이미 지났으면 다음 달로 넘어간다.
  ['동아리 모임 첫째주 금요일', '동아리 모임', '2026-09-04 23:59'],
  // 9월에는 다섯째 주 금요일이 없다. 8월로 흘러가지 않고 9월 안에서 멈춘다.
  ['워크숍 9월 다섯째 주 금요일', '워크숍', '2026-09-25 23:59'],
  // '주'와 '일'이 붙어 있다고 요일로 읽으면 "1주일 뒤"가 첫째 주 일요일이 된다.
  ['스터디 1주일 뒤', '스터디', '2026-08-21 23:59'],
];

let pass = 0;
let fail = 0;
for (const [input, wantTitle, wantDue] of cases) {
  const r = parseTaskInput(input, NOW);
  const gotDue = fmt(r.due);
  if (r.title === wantTitle && gotDue === wantDue) {
    pass++;
    console.log(`  ok   ${input}`);
  } else {
    fail++;
    console.log(`  FAIL ${input}`);
    console.log(`         title: got "${r.title}"  want "${wantTitle}"`);
    console.log(`         due:   got ${gotDue}  want ${wantDue}`);
  }
}

/*
 * 반복.
 *
 * 파서가 정하는 것은 '얼마 간격인가'뿐입니다. '언제부터인가'는 표시를 뗀
 * 나머지 문장을 날짜 규칙이 그대로 읽어서 정합니다 — "매주 월요일"에서 '매주'만
 * 떼면 "월요일"이 남고, 그건 이미 알아듣던 문장입니다.
 */
const repeatCases: [input: string, title: string, due: string, cycle: string][] = [
  ['매주 월요일 알고리즘 과제', '알고리즘 과제', '2026-08-17 23:59', '매주 월'],
  ['매일 운동 오후 9시', '운동', '2026-08-14 21:00', '매일'],
  ['격주 금요일 연구미팅', '연구미팅', '2026-08-14 23:59', '격주 금'],
  ['매월 1일 월세', '월세', '2026-09-01 23:59', '매월 1일'],
  ['3일마다 화분 물 주기', '화분 물 주기', 'null', '3일마다'],
  ['2주마다 대청소 토요일', '대청소', '2026-08-15 23:59', '격주 토'],
  // 날짜를 안 적으면 첫 회차가 없습니다. 그래도 규칙은 살아서, 입력칸의
  // 마감 칩이 기본값(오늘 끝)을 들고 있으므로 거기서 시작합니다.
  ['매주 스터디', '스터디', 'null', '매주'],
];

for (const [input, wantTitle, wantDue, wantCycle] of repeatCases) {
  const r = parseTaskInput(input, NOW);
  // 요일·날짜는 첫 회차에서 따라오므로, 규칙을 읽을 때도 그 값을 넘겨 줍니다.
  // 첫 회차가 없으면 넘길 것도 없습니다 — 그때는 입력칸의 마감 칩이 들고 있는
  // 기본값이 그 자리를 채웁니다.
  const gotCycle = r.repeat ? describeCycle(r.repeat, r.due?.getTime()) : 'null';
  const gotDue = fmt(r.due);
  if (r.title === wantTitle && gotDue === wantDue && gotCycle === wantCycle) {
    pass++;
    console.log(`  ok   ${input.padEnd(24)} → ${gotCycle}`);
  } else {
    fail++;
    console.log(`  FAIL ${input}`);
    console.log(`         title:  got "${r.title}"  want "${wantTitle}"`);
    console.log(`         due:    got ${gotDue}  want ${wantDue}`);
    console.log(`         반복:   got ${gotCycle}  want ${wantCycle}`);
  }
}

// 반복이 아닌 문장에서 규칙이 튀어나오면 안 됩니다. "2주 뒤"는 한 번뿐인 일이고
// "1주일 뒤"도 마찬가지입니다 — 여기서 '마다'를 요구하는 이유입니다.
for (const input of ['논문 읽기 2주 뒤', '스터디 1주일 뒤', '제출 20일', '보고서 오늘 23:59']) {
  const r = parseTaskInput(input, NOW);
  if (r.repeat === null) {
    pass++;
    console.log(`  ok   반복 아님: ${input}`);
  } else {
    fail++;
    console.log(`  FAIL 반복이 아닌데 규칙을 만들었다: ${input} → ${describeCycle(r.repeat)}`);
  }
}

// "평일"을 금요일 10시에 적으면 첫 회차가 토요일로 잡힙니다. 규칙이 평일이라
// 말하는데 첫 카드가 주말인 것은 그 자리에서 틀린 값이라, 입력칸이 첫 회차를
// 규칙 위로 옮깁니다.
{
  const r = parseTaskInput('평일 스탠드업 오전 10시', NOW);
  const raw = r.due!.getTime();
  const aligned = alignToRepeat(raw, r.repeat!);
  const ok = fmt(new Date(raw)) === '2026-08-15 10:00' && fmt(new Date(aligned)) === '2026-08-17 10:00';
  if (ok) {
    pass++;
    console.log(`  ok   평일 첫 회차가 토요일에서 월요일로 옮겨진다`);
  } else {
    fail++;
    console.log(`  FAIL 평일 첫 회차`);
    console.log(`         맞추기 전: ${fmt(new Date(raw))}  (want 2026-08-15 10:00)`);
    console.log(`         맞춘 뒤:   ${fmt(new Date(aligned))}  (want 2026-08-17 10:00)`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
