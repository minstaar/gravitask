//! 구독한 캘린더에서 마감을 읽어 옵니다.
//!
//! 프런트가 아니라 여기서 가져오는 이유가 둘입니다. 첫째, 웹뷰의 CSP가
//! `default-src 'self'`라 바깥으로 요청을 못 보냅니다. 둘째, 비공개 캘린더
//! 주소는 사실상 비밀번호라 웹뷰에 두지 않는 편이 낫습니다.
//!
//! 반복 일정은 직접 풀지 않습니다. RRULE·EXDATE·UNTIL·COUNT에 타임존까지
//! 얽히면 직접 짠 코드가 조용히 틀리기 시작하는데, 조용히 틀린 마감 알림은
//! 없느니만 못합니다.

use std::collections::HashMap;

use chrono::{DateTime, Duration, NaiveDate, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use rrule::{RRuleSet, Tz as RruleTz};
use serde::Serialize;

/// 한 회차. 프런트의 Task 하나가 됩니다.
#[derive(Debug, Clone, Serialize)]
pub struct Occurrence {
    /// 반복 계열 전체를 가리키는 값. 회차 구분에는 쓸 수 없습니다.
    pub uid: String,
    /// 이 회차를 가리키는 값. 완료 표시를 여기에 겁니다.
    ///
    /// UID만으로 표시하면 이번 주 수업을 체크하는 순간 학기 전체가 완료
    /// 처리됩니다. UID와 회차 시작 시각을 함께 씁니다.
    pub occurrence_key: String,
    pub title: String,
    /// 마감 시각 (epoch ms)
    pub due: i64,
    pub all_day: bool,
}

/// 하루짜리 일정을 몇 시로 볼 것인가.
///
/// 그날의 끝으로 봅니다. 종일 일정은 대개 "그날까지"라는 뜻이지 "그날 아침"이
/// 아닙니다. 09:00으로 잡으면 아침에 이미 지난 것으로 표시됩니다.
const ALL_DAY_HOUR: u32 = 23;
const ALL_DAY_MIN: u32 = 59;

/// 반복 일정 하나가 앞으로 내놓을 수 있는 회차 수.
///
/// 일회성 마감은 넉 달 앞이라도 봐야 합니다 — 논문 마감이 그렇습니다. 그런데
/// 반복 일정에 같은 잣대를 대면 매주 있는 수업 하나가 열일곱 장이 됩니다.
/// 15주 뒤 수업은 지금 아무것도 바꾸지 않으므로 자리만 먹습니다.
///
/// 다음 것과 그다음 것까지만 둡니다. 하나만 두면 이번 것을 끝낸 순간 그 과목이
/// 화면에서 사라져 다음이 언제인지 알 수 없고, 둘이면 늘 하나는 남습니다.
const MAX_UPCOMING_PER_SERIES: usize = 2;

/// 캘린더 주소를 두는 곳.
///
/// 비공개 ICS 주소는 사실상 비밀번호입니다 — 그 주소를 아는 사람은 캘린더
/// 전체를 읽습니다. 앱 데이터 파일에 두면 백업이나 클라우드 동기화로 그 파일이
/// 나가는 순간 함께 샙니다. OS 자격 증명 저장소는 그러라고 있는 자리입니다.
///
/// 주소는 여기서만 꺼내 씁니다. 프런트로 돌려주지 않습니다 — 웹뷰에 두지 않는
/// 것이 애초에 Rust에서 가져오기로 한 이유의 절반이었습니다.
const KEYRING_SERVICE: &str = "gravitask-calendar";

fn entry(handle: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, handle).map_err(|e| format!("자격 증명 저장소를 열지 못했습니다: {e}"))
}

pub fn save_url(handle: &str, url: &str) -> Result<(), String> {
    entry(handle)?
        .set_password(url.trim())
        .map_err(|e| format!("주소를 저장하지 못했습니다: {e}"))
}

pub fn read_url(handle: &str) -> Result<String, String> {
    entry(handle)?
        .get_password()
        .map_err(|_| "저장된 주소를 찾을 수 없습니다. 캘린더를 다시 등록해 주세요.".to_string())
}

pub fn forget_url(handle: &str) -> Result<(), String> {
    match entry(handle)?.delete_credential() {
        Ok(()) => Ok(()),
        // 이미 없으면 지운 것과 같습니다
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("주소를 지우지 못했습니다: {e}")),
    }
}

pub async fn fetch(url: &str) -> Result<String, String> {
    // webcal://은 https로 바꿔 씁니다. 애플이 공유 링크를 그 꼴로 줍니다.
    let normalized = url
        .trim()
        .replacen("webcal://", "https://", 1)
        .replacen("webcals://", "https://", 1);

    if !normalized.starts_with("http://") && !normalized.starts_with("https://") {
        return Err("주소는 https:// 또는 webcal:// 로 시작해야 합니다".to_string());
    }

    let response = reqwest::Client::new()
        .get(&normalized)
        .header("User-Agent", "Gravitask")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "시간이 초과됐습니다. 연결 상태를 확인해 주세요.".to_string()
            } else if e.is_connect() {
                "연결하지 못했습니다. 인터넷이 끊겨 있거나 주소의 호스트가 잘못됐습니다.".to_string()
            } else {
                format!("가져오지 못했습니다: {e}")
            }
        })?;

    // 무엇을 고쳐야 할지 답에 담습니다. 상태 코드만 적으면 사용자는 주소가
    // 틀린 건지 캘린더가 비공개인 건지 알 수 없고, 둘은 할 일이 전혀 다릅니다.
    let status = response.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            404 => "주소를 찾을 수 없습니다. 공개 주소를 넣으셨다면, 그 캘린더가 '일반에게 공개'로 설정돼 있어야 합니다. 아니라면 비공개 주소를 쓰세요."
                .to_string(),
            401 | 403 => "접근이 거부됐습니다. 비공개 주소를 재설정했다면 새 주소로 바꿔야 합니다."
                .to_string(),
            _ => format!("캘린더가 {status}로 답했습니다"),
        });
    }

    response
        .text()
        .await
        .map_err(|e| format!("읽지 못했습니다: {e}"))
}

/// 접힌 줄을 폅니다.
///
/// iCalendar는 75옥텟마다 줄을 접고 다음 줄을 공백으로 시작합니다. 펴지 않으면
/// 긴 제목이 중간에서 잘립니다.
fn unfold(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for line in text.split("\r\n").flat_map(|l| l.split('\n')) {
        if line.starts_with(' ') || line.starts_with('\t') {
            out.push_str(&line[1..]);
        } else {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(line);
        }
    }
    out
}

struct Prop {
    value: String,
    params: HashMap<String, String>,
}

fn parse_prop(line: &str) -> Option<(String, Prop)> {
    let (head, value) = line.split_once(':')?;
    let mut parts = head.split(';');
    let name = parts.next()?.to_uppercase();
    let mut params = HashMap::new();
    for p in parts {
        if let Some((k, v)) = p.split_once('=') {
            params.insert(k.to_uppercase(), v.trim_matches('"').to_string());
        }
    }
    Some((
        name,
        Prop {
            value: value.to_string(),
            params,
        },
    ))
}

/// DTSTART/DUE 한 줄을 시각으로 바꿉니다. 종일이면 true를 함께 돌려줍니다.
fn to_instant(prop: &Prop) -> Option<(DateTime<Utc>, bool)> {
    let raw = prop.value.trim();

    // 날짜만 있는 형태 — 종일 일정
    if prop.params.get("VALUE").map(|v| v.as_str()) == Some("DATE") || raw.len() == 8 {
        let date = NaiveDate::parse_from_str(raw, "%Y%m%d").ok()?;
        let naive = date.and_hms_opt(ALL_DAY_HOUR, ALL_DAY_MIN, 0)?;
        return Some((local_to_utc(naive, prop.params.get("TZID")), true));
    }

    // Z로 끝나면 이미 UTC
    if let Some(stripped) = raw.strip_suffix('Z') {
        let naive = NaiveDateTime::parse_from_str(stripped, "%Y%m%dT%H%M%S").ok()?;
        return Some((Utc.from_utc_datetime(&naive), false));
    }

    let naive = NaiveDateTime::parse_from_str(raw, "%Y%m%dT%H%M%S").ok()?;
    Some((local_to_utc(naive, prop.params.get("TZID")), false))
}

/// TZID가 있으면 그 시간대로, 없으면 기기 시간대로 봅니다.
fn local_to_utc(naive: NaiveDateTime, tzid: Option<&String>) -> DateTime<Utc> {
    if let Some(tz) = tzid.and_then(|t| t.parse::<Tz>().ok()) {
        if let Some(dt) = tz.from_local_datetime(&naive).single() {
            return dt.with_timezone(&Utc);
        }
    }
    chrono::Local
        .from_local_datetime(&naive)
        .single()
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|| Utc.from_utc_datetime(&naive))
}

/// VEVENT 하나를 모은 것
#[derive(Default)]
struct Event {
    uid: Option<String>,
    summary: Option<String>,
    start: Option<(DateTime<Utc>, bool)>,
    due: Option<(DateTime<Utc>, bool)>,
    rrule_lines: Vec<String>,
    cancelled: bool,
}

/// 텍스트를 회차 목록으로 폅니다.
///
/// `from`~`to` 바깥은 버립니다. 지난 것을 얼마나 남길지는 부르는 쪽이 정합니다 —
/// 무한정 펴면 매주 있는 수업이 학기 내내 쌓입니다.
pub fn expand(text: &str, from: DateTime<Utc>, to: DateTime<Utc>) -> Vec<Occurrence> {
    expand_at(text, from, to, Utc::now())
}

/// `now`를 받는 판. 테스트가 시계에 기대지 않게 합니다.
pub fn expand_at(
    text: &str,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Vec<Occurrence> {
    let unfolded = unfold(text);
    let mut out = Vec::new();
    let mut current: Option<Event> = None;

    for line in unfolded.lines() {
        let line = line.trim_end();
        if line.eq_ignore_ascii_case("BEGIN:VEVENT") {
            current = Some(Event::default());
            continue;
        }
        if line.eq_ignore_ascii_case("END:VEVENT") {
            if let Some(event) = current.take() {
                collect(event, from, to, now, &mut out);
            }
            continue;
        }

        let Some(event) = current.as_mut() else { continue };
        let Some((name, prop)) = parse_prop(line) else { continue };

        match name.as_str() {
            "UID" => event.uid = Some(prop.value.clone()),
            "SUMMARY" => event.summary = Some(unescape(&prop.value)),
            "DTSTART" => event.start = to_instant(&prop),
            "DUE" => event.due = to_instant(&prop),
            "STATUS" => event.cancelled = prop.value.eq_ignore_ascii_case("CANCELLED"),
            "RRULE" | "EXDATE" | "RDATE" => {
                event.rrule_lines.push(line.to_string());
            }
            _ => {}
        }
    }

    out.sort_by_key(|o| o.due);
    out
}

/// `\,` `\n` 같은 이스케이프를 되돌립니다
fn unescape(value: &str) -> String {
    value
        .replace("\\n", " ")
        .replace("\\N", " ")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
        .trim()
        .to_string()
}

fn collect(
    event: Event,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    now: DateTime<Utc>,
    out: &mut Vec<Occurrence>,
) {
    if event.cancelled {
        return;
    }
    let Some(uid) = event.uid else { return };
    // DUE(VTODO)가 있으면 그쪽이 마감입니다. 없으면 시작 시각을 마감으로 봅니다 —
    // 수업이나 미팅은 시작이 곧 마감입니다.
    let Some((anchor, all_day)) = event.due.or(event.start) else {
        return;
    };
    let title = event.summary.unwrap_or_else(|| "(제목 없음)".to_string());

    let repeating = !event.rrule_lines.is_empty();
    let mut starts = if repeating {
        expand_rrule(&event.rrule_lines, anchor, to)
    } else {
        vec![anchor]
    };
    starts.sort();

    // 반복 일정은 앞으로 올 것 중 몇 개만 남깁니다. 지난 회차는 그대로 두는데,
    // 놓친 수업은 개수가 아니라 창(from)이 이미 제한하고 있습니다.
    if repeating {
        let mut upcoming = 0;
        starts.retain(|start| {
            if *start < now {
                return true;
            }
            upcoming += 1;
            upcoming <= MAX_UPCOMING_PER_SERIES
        });
    }

    for start in starts {
        if start < from || start > to {
            continue;
        }
        out.push(Occurrence {
            uid: uid.clone(),
            occurrence_key: format!("{uid}@{}", start.timestamp_millis()),
            title: title.clone(),
            due: start.timestamp_millis(),
            all_day,
        });
    }
}

/// 반복을 펴는 일은 rrule 크레이트에 맡깁니다.
fn expand_rrule(lines: &[String], anchor: DateTime<Utc>, to: DateTime<Utc>) -> Vec<DateTime<Utc>> {
    let dtstart = format!("DTSTART:{}", anchor.format("%Y%m%dT%H%M%SZ"));
    let source = std::iter::once(dtstart)
        .chain(lines.iter().cloned())
        .collect::<Vec<_>>()
        .join("\n");

    match source.parse::<RRuleSet>() {
        Ok(set) => {
            // rrule은 제 시간대 타입을 씁니다. 둘 다 UTC라 값은 그대로입니다.
            let lo = (anchor - Duration::days(1)).with_timezone(&RruleTz::UTC);
            let hi = to.with_timezone(&RruleTz::UTC);
            // 상한을 둡니다. UNTIL도 COUNT도 없는 규칙은 무한히 펴집니다.
            let result = set.after(lo).before(hi).all(500);
            result
                .dates
                .into_iter()
                .map(|d| d.with_timezone(&Utc))
                .collect()
        }
        Err(err) => {
            log::warn!("반복 규칙을 읽지 못해 첫 회차만 씁니다: {err}");
            vec![anchor]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    const SAMPLE: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n\
BEGIN:VEVENT\r\nUID:one\r\nSUMMARY:확률론 과제 3\r\nDTSTART:20260820T090000Z\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:allday\r\nSUMMARY:졸업요건 신청\r\nDTSTART;VALUE=DATE:20260821\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:weekly\r\nSUMMARY:자료구조 수업\r\nDTSTART:20260817T010000Z\r\nRRULE:FREQ=WEEKLY;COUNT=4\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:gone\r\nSUMMARY:취소된 것\r\nDTSTART:20260820T100000Z\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\n\
END:VCALENDAR\r\n";

    #[test]
    fn 취소된_일정은_빼고_읽는다() {
        let all = expand(SAMPLE, at("2026-08-01T00:00:00Z"), at("2026-10-01T00:00:00Z"));
        assert!(all.iter().all(|o| o.uid != "gone"), "취소된 일정이 들어왔습니다");
    }

    /// 주간 수업이 넉 달치로 펴지지 않아야 합니다.
    ///
    /// 일회성 마감은 넉 달 앞도 봐야 하지만, 매주 있는 수업까지 그렇게 펴면
    /// 과목 하나가 열일곱 장이 됩니다. 15주 뒤 수업은 지금 아무것도 바꾸지
    /// 않으므로 자리만 먹습니다.
    #[test]
    fn 반복_일정은_다가오는_몇_회차만_내놓는다() {
        // 8/17부터 매주, 종료 없음 — 그냥 두면 넉 달치가 나옵니다
        let endless = "BEGIN:VCALENDAR\r\n\r\nBEGIN:VEVENT\r\n\r\nUID:class\r\n\r\nSUMMARY:자료구조\r\n\r\nDTSTART:20260817T010000Z\r\n\r\nRRULE:FREQ=WEEKLY\r\n\r\nEND:VEVENT\r\n\r\nEND:VCALENDAR\r\n\r\n";

        let now = at("2026-08-18T00:00:00Z");
        let all = expand_at(
            endless,
            now - Duration::days(7),
            now + Duration::days(120),
            now,
        );

        let upcoming = all.iter().filter(|o| o.due > now.timestamp_millis()).count();
        assert_eq!(
            upcoming, MAX_UPCOMING_PER_SERIES,
            "반복 일정이 {upcoming}회차나 나왔습니다"
        );
    }

    /// 반복이 아닌 마감은 멀어도 그대로 둡니다 — 논문 마감이 그렇습니다.
    #[test]
    fn 일회성_마감은_멀어도_남는다() {
        let far = "BEGIN:VCALENDAR\r\n\r\nBEGIN:VEVENT\r\n\r\nUID:thesis\r\n\r\nSUMMARY:논문 마감\r\n\r\nDTSTART:20261201T000000Z\r\n\r\nEND:VEVENT\r\n\r\nEND:VCALENDAR\r\n\r\n";
        let now = at("2026-08-18T00:00:00Z");
        let all = expand_at(far, now - Duration::days(7), now + Duration::days(120), now);
        assert_eq!(all.len(), 1, "먼 일회성 마감이 사라졌습니다");
    }

    #[test]
    fn 반복_일정은_회차마다_다른_키를_가진다() {
        let now = at("2026-08-01T00:00:00Z");
        let all = expand_at(SAMPLE, now, at("2026-10-01T00:00:00Z"), now);
        let weekly: Vec<_> = all.iter().filter(|o| o.uid == "weekly").collect();
        assert!(!weekly.is_empty(), "반복 일정이 하나도 안 나왔습니다");

        // 개수가 아니라 겹치지 않는다는 것을 잽니다. 개수는 상한이 정하지만,
        // 키가 겹치면 한 번 체크에 학기 전체가 완료 처리됩니다.
        let keys: std::collections::HashSet<_> =
            weekly.iter().map(|o| o.occurrence_key.clone()).collect();
        assert_eq!(keys.len(), weekly.len(), "회차 키가 겹칩니다");
    }

    #[test]
    fn 종일_일정은_그날_끝으로_본다() {
        let all = expand(SAMPLE, at("2026-08-01T00:00:00Z"), at("2026-10-01T00:00:00Z"));
        let day = all.iter().find(|o| o.uid == "allday").expect("종일 일정이 없습니다");
        assert!(day.all_day);

        let local = chrono::Local.timestamp_millis_opt(day.due).unwrap();
        assert_eq!(local.format("%H:%M").to_string(), "23:59");
    }

    #[test]
    fn 창_바깥은_버린다() {
        // 8월 18일 이후만 봅니다 — 첫 수업(8/17)은 빠져야 합니다
        let from = at("2026-08-18T00:00:00Z");
        let all = expand_at(SAMPLE, from, at("2026-10-01T00:00:00Z"), from);
        assert!(
            all.iter().all(|o| o.due >= from.timestamp_millis()),
            "창 밖 회차가 남아 있습니다"
        );
        assert!(
            all.iter().any(|o| o.uid == "weekly"),
            "창 안의 회차까지 사라졌습니다"
        );
    }

    #[test]
    fn 접힌_줄을_편다() {
        let folded = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nSUMMARY:아주 긴 제\r\n 목입니다\r\nDTSTART:20260820T090000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let all = expand(folded, at("2026-08-01T00:00:00Z"), at("2026-10-01T00:00:00Z"));
        assert_eq!(all[0].title, "아주 긴 제목입니다");
    }
}
