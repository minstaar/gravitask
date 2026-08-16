/**
 * 핵심 도메인 타입.
 *
 * 설계 노트 — Task는 '점'(마감 시각 하나)입니다.
 * 캘린더 일정은 '구간'(시작~끝)이라 성질이 다르므로, v1.1에서 ICS를 붙일 때
 * Task에 end 필드를 억지로 얹지 말고 별도 타입(CalendarEvent)으로 분리하세요.
 * 그때 결정해야 할 것: 구간을 2구역 축에 어떻게 배치할지, 완료 개념이 있는지.
 */

export interface Task {
  id: string;
  title: string;
  /** 마감 시각 (epoch ms) */
  due: number;
  categoryId: string;
  /** 생성 시각 (epoch ms). 연소 막대 등 '전체 대비 남은 비율' 계산에 씀 */
  createdAt: number;
  /** 완료 시각 (epoch ms). null이면 미완료 */
  completedAt: number | null;
}

export type NewTask = Omit<Task, 'id' | 'createdAt' | 'completedAt'>;

/**
 * 완료 기록.
 *
 * 완료한 할 일은 버리지 않고 별도 파일로 옮깁니다. 살아 있는 목록에 계속
 * 쌓아두면 체크 한 번의 저장 비용이 지난 이력 전체에 비례하고, 그 쓰기가
 * 깨졌을 때 잃는 것도 이력 전체입니다.
 *
 * 주제 이름은 완료 시점의 값을 복사해 둡니다. 기록은 그때 무슨 일이 있었는지
 * 말해야 하는데, 주제를 지우거나 이름을 바꿨다고 지난 기록의 의미가 바뀌면
 * 기록이 아닙니다. 이름을 잡아둘 수 있는 순간은 완료하는 그때뿐입니다.
 */
export interface ArchivedTask extends Task {
  completedAt: number;
  categoryName: string;
}

/**
 * 주제에는 색이 없습니다.
 *
 * 한때 주제마다 hue를 배정했지만, 카드가 이미 긴급도 색(청록→황량→적색)을
 * 쓰고 있어서 화면에 색 체계가 둘이 되고 서로 부조화했습니다. 주제는 레인
 * 위치와 이름으로 충분히 구분되므로, 색은 긴급도에만 맡깁니다.
 */
export interface Category {
  id: string;
  name: string;
  order: number;
}

/**
 * 할 일을 공급하는 소스의 경계.
 *
 * v1은 LocalSource 하나뿐이지만, 이 인터페이스를 지금 그어 두면
 * v1.1의 ICS 소스가 UI 코드 수정 없는 '순수 추가'가 됩니다.
 * 읽기 전용 소스(ICS)는 writable=false로 두고 쓰기 메서드를 구현하지 않습니다.
 */
export interface TaskSource {
  readonly id: string;
  readonly kind: 'local' | 'ics';
  readonly label: string;
  /** false면 UI가 체크박스·편집·삭제를 숨깁니다 */
  readonly writable: boolean;

  list(): Promise<Task[]>;
  /** 소스 내용이 바뀌면 호출됨. 해제 함수를 반환 */
  subscribe(onChange: () => void): () => void;

  add?(input: NewTask): Promise<Task>;
  update?(id: string, patch: Partial<Omit<Task, 'id'>>): Promise<void>;
  remove?(id: string): Promise<void>;

  /**
   * 이미 신원이 있는 할 일을 도로 넣습니다.
   *
   * add와 다릅니다 — add는 새 id를 발급하지만 insert는 원래 id를 지킵니다.
   * 되돌리기가 id를 바꿔 버리면 되돌리기 스택이 가리키던 항목을 잃습니다.
   */
  insert?(task: Task): Promise<void>;
}
