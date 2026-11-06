/**
 * 번호(seq)를 받고 목록에 넣는 사이가 한 동작이 아니라서(INCR → RPUSH), 둘이 거의 동시에 보내면
 * 목록에 7번이 6번보다 먼저 들어갈 수 있다. 그 사이에 "7번 다음부터" 물은 사람은 6번을 영영 못 받는다
 * (다시 열어야 보임) — 가상 사용자 단체방 겹침 점검에서 23번 중 9번 겪음(2026-10-19).
 *
 * 그래서 이어 받기(poll)는 받은 번호보다 조금 앞(LATE_WINDOW)부터 다시 주고, 번호 순으로 정렬해 준다.
 * 단체방·1:1·말하는 방 앱은 모두 번호로 중복을 거르므로(이미 나간 빌드 포함) 다시 줘도 두 번 보이지 않는다.
 */
export const LATE_WINDOW = 20;

/** since 다음 줄들, 번호 순(목록 순서와 번호가 어긋나 있어도). */
export function rowsAfter<T extends { seq: number }>(rows: T[], since: number): T[] {
  return rows.filter((row) => row.seq > since).sort((a, b) => a.seq - b.seq);
}

/** 이어 받기(poll)에서 실제로 물을 자리: 앱이 받은 번호보다 LATE_WINDOW 앞. 처음 열기(0)는 그대로. */
export function pollFrom(since: number): number {
  return since > 0 ? Math.max(0, since - LATE_WINDOW) : 0;
}
