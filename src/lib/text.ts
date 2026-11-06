/** 공백을 하나로 줄이고 자른 글. 원본 `lib/rooms/protocol.ts`의 cleanText(방 프로토콜 전체는 가져오지 않음). */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}
