/**
 * 남의 말을 집어 "이거 무슨 뜻이에요?" 묻기(말하는 방·1:1 메시지 공통).
 *
 * 앱은 집은 줄의 번호(seq)만 보내고, 서버가 그 줄을 찾아 인용을 채운다 — 남이 하지 않은
 * 말을 인용으로 꾸며 넣지 못하게. 질문 문장은 묻는 사람의 학습 언어로 미리 써 둔 고정 문구라
 * 모델을 부르지 않는다(묻는 것 자체가 학습 언어로 말해 보는 연습).
 */

/** 원본은 학습 언어 목록(learningLanguages.ts)의 코드 — 여기서는 언어 코드 문자열. */
type LearningLanguageCode = string;
import { segmentWords } from "../wordSegments.ts";

/** 인용으로 남기는 글자 수(글자 단위, 태국어·힌디어 모음 기호는 자르지 않음). */
export const QUOTE_MAX_CHARS = 140;

export type LineQuote = {
  /** 방: 자막 줄 번호, 메시지: 메시지 번호. */
  seq: number;
  /** 메시지의 통화 기록 안 몇 번째 줄인지(통화 기록을 집었을 때만). */
  index?: number;
  nickname: string;
  text: string;
  /** 방에서 말한 사람의 이름표 — 내 말을 누가 물었는지 알아보는 데. */
  peerId?: string;
  /** 말한 사람의 계정(메시지·방 모두, 없을 수 있음). */
  accountId?: string | null;
  /** 쪽지: 말하는 방의 줄을 집어 1:1 메시지로 물었을 때 그 방(seq는 방 자막 줄 번호). */
  roomId?: string;
  /** 줄 안에서 고른 부분(단어·구절) — 그 부분만 물을 때. 늘 text 안에 있는 글. */
  focus?: string;
};

/** 고른 부분으로 남기는 글자 수. */
export const FOCUS_MAX_CHARS = 60;

const ASK_PHRASES: Record<LearningLanguageCode, string> = {
  en: "What does this mean?",
  ko: "이거 무슨 뜻이에요?",
  ja: "これ、どういう意味ですか？",
  zh: "这是什么意思？",
  es: "¿Qué significa esto?",
  fr: "Ça veut dire quoi ?",
  it: "Che cosa significa?",
  pt: "O que significa isto?",
  ru: "Что это значит?",
  ar: "ماذا يعني هذا؟",
  id: "Ini artinya apa?",
  vi: "Câu này nghĩa là gì?",
  th: "อันนี้แปลว่าอะไร",
  hi: "इसका मतलब क्या है?",
};

/** 고른 부분을 넣은 질문({x} 자리). 묻는 사람의 학습 언어, 모델 안 부름. */
const ASK_ABOUT_PHRASES: Record<LearningLanguageCode, string> = {
  en: "What does \"{x}\" mean?",
  ko: "\"{x}\" 무슨 뜻이에요?",
  ja: "「{x}」ってどういう意味ですか？",
  zh: "“{x}”是什么意思？",
  es: "¿Qué significa «{x}»?",
  fr: "« {x} », ça veut dire quoi ?",
  it: "Che cosa significa \"{x}\"?",
  pt: "O que significa \"{x}\"?",
  ru: "Что значит «{x}»?",
  ar: "ماذا يعني \"{x}\"؟",
  id: "\"{x}\" artinya apa?",
  vi: "\"{x}\" nghĩa là gì?",
  th: "\"{x}\" แปลว่าอะไร",
  hi: "\"{x}\" का मतलब क्या है?",
};

/** 고른 부분이 있으면 그 부분을 넣은 질문, 없으면 줄 전체 질문. */
export function askPhraseAbout(language: string, focus?: string | null): string {
  if (!focus) return askPhrase(language);
  const template = ASK_ABOUT_PHRASES[language as LearningLanguageCode] ?? ASK_ABOUT_PHRASES.en;
  return template.replace("{x}", focus);
}

/** 고를 수 있는 낱말(앞뒤 문장부호·기호 뺀 것)과 줄 안 위치. 띄어쓰기 없는 언어도 낱말로(wordSegments). */
export type PickToken = { word: string; start: number; end: number };

const EDGE = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

export function pickTokens(text: string, language?: string, max = 40): PickToken[] {
  const tokens: PickToken[] = [];
  let cursor = 0;
  for (const segment of segmentWords(text, language)) {
    const at = text.indexOf(segment, cursor);
    if (at < 0) continue;
    cursor = at + segment.length;
    const lead = segment.length - segment.replace(/^[\p{P}\p{S}]+/u, "").length;
    const word = segment.replace(EDGE, "");
    if (!word) continue;
    tokens.push({ word, start: at + lead, end: at + lead + word.length });
    if (tokens.length >= max) break;
  }
  return tokens;
}

/** from~to 번째 낱말을 줄의 원래 글 그대로(사이 띄어쓰기 포함) 잘라 낸다. */
export function focusOf(text: string, tokens: PickToken[], from: number, to: number): string {
  const a = tokens[Math.min(from, to)];
  const b = tokens[Math.max(from, to)];
  if (!a || !b) return "";
  return text.slice(a.start, b.end);
}

/** 서버: 보낸 고른 부분이 인용 글 안에 그대로 있을 때만 남긴다(남이 하지 않은 말을 꾸미지 못하게). */
export function cleanFocus(quoteText: string, focus: unknown): string | undefined {
  if (typeof focus !== "string") return undefined;
  const clean = focus.replace(/\s+/g, " ").trim();
  if (!clean || Array.from(clean).length > FOCUS_MAX_CHARS) return undefined;
  if (clean === quoteText.replace(/\s+/g, " ").trim()) return undefined;
  return quoteText.replace(/\s+/g, " ").includes(clean) ? clean : undefined;
}

/** 묻는 사람의 학습 언어로 된 질문 문장. 모르는 언어면 영어. */
export function askPhrase(language: string): string {
  return ASK_PHRASES[language as LearningLanguageCode] ?? ASK_PHRASES.en;
}

export function allAskPhrases(): string[] {
  return Object.values(ASK_PHRASES);
}

/** 글자(자소 묶음) 단위로 자른다 — 코드 단위로 자르면 결합 문자가 떨어져 나간다. */
export function clipQuote(text: string, max = QUOTE_MAX_CHARS): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  const parts = Segmenter
    ? Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(clean), (part) => part.segment)
    : Array.from(clean);
  return parts.length > max ? `${parts.slice(0, max).join("")}…` : clean;
}

/** 이 줄을 집어 물은 질문 수(줄 옆 "❓ n" 표시). */
export function questionCount<T extends { quote?: LineQuote; ask?: boolean }>(rows: T[], seq: number, index?: number): number {
  // 쪽지(roomId)의 seq는 방 자막 번호라 여기 줄 번호와 섞지 않는다.
  return rows.filter((row) => row.ask && !row.quote?.roomId && row.quote?.seq === seq && (row.quote.index ?? -1) === (index ?? -1)).length;
}
