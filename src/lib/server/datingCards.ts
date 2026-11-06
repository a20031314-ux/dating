import { readAccounts, type AccountRecord } from "./accountStore.ts";
import { readDatingProfiles } from "./datingStore.ts";
import { readAdult } from "./randomStore.ts";
import { yearAge, type DatingCard, type DatingProfile } from "../dating/rules.ts";

/**
 * 계정(원본 accountStore) + 데이팅 프로필을 화면에 보낼 카드로 합친다.
 * 지운 계정·프로필 없는 사람은 빠진다. 아이디·이메일·출생 연도 원값은 내보내지 않는다.
 */
export async function cardsFor(ids: string[], now: number = Date.now()): Promise<DatingCard[]> {
  if (!ids.length) return [];
  const [accounts, profiles] = await Promise.all([readAccounts(ids), readDatingProfiles(ids)]);
  const out: DatingCard[] = [];
  ids.forEach((id, i) => {
    const card = toCard(accounts[i], profiles[i], now);
    if (card) out.push(card);
  });
  return out;
}

export function toCard(account: AccountRecord | null, profile: DatingProfile | null, now: number = Date.now()): DatingCard | null {
  if (!account || !profile) return null;
  return {
    id: account.id,
    nickname: account.profile.nickname || account.username || "",
    age: yearAge(profile.birthYear, now),
    region: profile.region,
    bio: account.profile.bio,
    photos: profile.photos,
  };
}

/**
 * 본인인증(성인)을 요구하는지 — Vercel `ADULT_VERIFY_REQUIRED=1`이면 인증한 사람끼리만 추천·좋아요·대화.
 * 포트원 본인인증 계약 전(개발·시험)에는 꺼 둔다. 출시 전에는 반드시 켠다(README "출시 전 확인").
 */
export function adultVerifyRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ADULT_VERIFY_REQUIRED?.trim() === "1";
}

/** 이 계정이 성인인증을 마쳤나(randomStore — 원본 랜덤 연결의 성인인증 기록을 그대로 씀). */
export async function isVerifiedAdult(id: string): Promise<boolean> {
  const record = await readAdult(id);
  return Boolean(record?.adult && !record.offBy);
}
