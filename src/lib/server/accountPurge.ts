import { kvDelete, kvListPush, kvListRange, kvListTake, kvScanKeys } from "./kv.ts";
import { PURGE_QUEUE_KEY } from "./accountStore.ts";

/**
 * 지운 계정의 학습 기록 지우기 — 계정 삭제가 목록(account:v1:purge)에 넣은 id마다
 * 그 id가 들어간 키를 모두 지운다.
 *
 * 키 공간을 훑으므로 사용자 요청 안에서는 부르지 않는다(kv.ts kvScanKeys).
 * 부르는 곳: 매주 Vercel 크론(/api/account/purge)과 scripts/account-purge.mjs.
 * 개인정보 처리방침이 "30일 안에"라고 약속한 것이 이것.
 */

/** 이 id가 키 안에서 하나의 조각으로 들어 있는지 (rc:abc가 rc:abcd에 걸리지 않게). */
export function keyBelongsTo(key: string, userId: string): boolean {
  let from = 0;
  while (true) {
    const at = key.indexOf(userId, from);
    if (at === -1) return false;
    const before = at === 0 ? ":" : key[at - 1];
    const after = key[at + userId.length] ?? ":";
    if (before === ":" && after === ":") return true;
    from = at + 1;
  }
}

export type PurgeReport = { ids: number; keys: number; requeued: number; preview: boolean };

export async function purgeDeletedAccounts(options: {
  apply: boolean;
  /** 이 시각(ms)이 지나면 남은 id는 다음 번으로 돌린다. */
  deadline?: number;
  log?: (line: string) => void;
}): Promise<PurgeReport> {
  const log = options.log ?? (() => {});
  const ids = options.apply ? await kvListTake(PURGE_QUEUE_KEY) : await kvListRange(PURGE_QUEUE_KEY);
  const unique = [...new Set(ids)];
  let keys = 0;
  const later: string[] = [];
  for (const userId of unique) {
    if (!/^(rc:|acct:)/.test(userId)) {
      log(`건너뜀(모르는 모양): ${userId}`);
      continue;
    }
    if (options.deadline && Date.now() > options.deadline) {
      later.push(userId);
      continue;
    }
    try {
      const found = (await kvScanKeys(`*${userId}*`)).filter((key) => keyBelongsTo(key, userId));
      keys += found.length;
      log(`${userId}: 키 ${found.length}개${options.apply ? " 지움" : ""}`);
      if (options.apply) {
        for (let i = 0; i < found.length; i += 200) await kvDelete(found.slice(i, i + 200));
      }
    } catch (error) {
      log(`${userId}: 실패, 다음에 다시 (${String(error)})`);
      later.push(userId);
    }
  }
  if (options.apply && later.length > 0) await kvListPush(PURGE_QUEUE_KEY, later, 400 * 24 * 60 * 60);
  return { ids: unique.length, keys, requeued: options.apply ? later.length : 0, preview: !options.apply };
}
