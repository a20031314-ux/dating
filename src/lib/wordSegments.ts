/**
 * Words of a line in a language that does not put spaces between them.
 *
 * Splitting on whitespace is the right first cut for most of the app's
 * languages and the wrong one for Japanese, Chinese and Thai, where a whole
 * sentence comes back as one "word". Anything that lines words up — an attempt
 * against its target, an expression against a transcript — then has nothing to
 * line up: a Japanese sentence said with one wrong word was all wrong, and a
 * phrase inside a Japanese line could never be found in it.
 *
 * So a chunk written in one of those scripts is cut by the platform's own word
 * segmenter (Intl.Segmenter, in Node and every WebView the app runs in). Where
 * it is missing, the chunk stays whole, which is what happened before.
 *
 * Plain module, no imports: the server, the screen and the tests share it.
 */

const SPACELESS =
  /[぀-ヿㇰ-ㇿ㐀-䶿一-鿿豈-﫿฀-๿຀-໿က-႟]/;

export function isSpaceless(text: string): boolean {
  return SPACELESS.test(text);
}

const segmenters = new Map<string, Intl.Segmenter>();

function segmenterFor(language?: string): Intl.Segmenter | null {
  if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") return null;
  const key = language || "";
  let segmenter = segmenters.get(key);
  if (!segmenter) {
    segmenter = new Intl.Segmenter(language || undefined, { granularity: "word" });
    segmenters.set(key, segmenter);
  }
  return segmenter;
}

/**
 * Whole words the platform segmenter cuts in the middle (ICU's Japanese
 * dictionary gives くだ/さい, ご/ざ/い/ます) — glued back, longest first, so an
 * order quiz never shows half a word as a tile and matching sees one word.
 * Kana only: a word written with kanji stays as the segmenter cut it.
 */
const JA_WHOLE = [
  "いらっしゃいませ",
  "かしこまりました",
  "ございました",
  "ございます",
  "ください",
  "下さい",
  "なさい",
  "ござい",
].sort((a, b) => b.length - a.length);

function rejoin(words: string[], language?: string): string[] {
  if (language && language !== "ja") return words;
  if (!words.some((word) => /[\u3040-\u30ff]/u.test(word))) return words;
  const out: string[] = [];
  for (let i = 0; i < words.length; ) {
    let taken = 0;
    for (const whole of JA_WHOLE) {
      let joined = "";
      let n = 0;
      while (i + n < words.length && joined.length < whole.length) joined += words[i + n++];
      if (n > 1 && joined === whole) {
        out.push(whole);
        taken = n;
        break;
      }
    }
    if (taken) i += taken;
    else out.push(words[i++]!);
  }
  return out;
}

/** One chunk without spaces, cut into words when its script needs it. */
export function segmentChunk(chunk: string, language?: string): string[] {
  if (!isSpaceless(chunk)) return [chunk];
  const segmenter = segmenterFor(language);
  if (!segmenter) return [chunk];
  const words = [...segmenter.segment(chunk)]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment);
  return words.length ? rejoin(words, language) : [chunk];
}

/** A line's words: whitespace first, then each chunk cut if its script needs it. */
export function segmentWords(text: string, language?: string): string[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((chunk) => segmentChunk(chunk, language));
}
