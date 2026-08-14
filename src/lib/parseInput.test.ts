/**
 * 파서 명세. `npm run test:parse` 로 실행합니다.
 * (Node 24의 TypeScript 직접 실행을 씁니다 — 빌드 단계 없음)
 */
import { parseTaskInput } from './parseInput.ts';

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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
