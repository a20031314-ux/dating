/**
 * The little bit of durable state the API needs, over HTTP.
 *
 * API routes run as serverless functions. Anything kept in module scope lives
 * in one warm instance, is invisible to every other instance handling requests
 * at the same time, and disappears when that instance recycles — so a usage
 * counter held that way does not actually count. This talks to Vercel KV /
 * Upstash over their REST interface, which needs no driver and no connection
 * pool and so works from a cold start.
 *
 * Set either pair of variables (the Vercel KV integration provides the first,
 * Upstash directly the second):
 *
 *   KV_REST_API_URL / KV_REST_API_TOKEN
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 *
 * With neither, this falls back to an in-memory map so local development still
 * runs. That fallback has exactly the weakness described above, so it says so
 * once rather than pretending to be a store.
 */

type Credentials = { url: string; token: string };

function credentials(): Credentials | null {
  const url = (
    process.env.KV_REST_API_URL ??
    process.env.UPSTASH_REDIS_REST_URL ??
    ""
  ).trim();
  const token = (
    process.env.KV_REST_API_TOKEN ??
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    ""
  ).trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

export function kvConfigured(): boolean {
  return credentials() !== null;
}

const memoryStore = globalThis as typeof globalThis & {
  __kvMemory?: Map<string, { value: string; expiresAt: number | null }>;
  __kvMemoryWarned?: boolean;
};

function memory() {
  return (memoryStore.__kvMemory ??= new Map());
}

function warnOnce() {
  if (memoryStore.__kvMemoryWarned) return;
  memoryStore.__kvMemoryWarned = true;
  console.warn(
    "[kv] No KV credentials. Usage counters are in-memory and will reset when this instance recycles.",
  );
}

function memoryRead(key: string): string | null {
  const row = memory().get(key);
  if (!row) return null;
  if (row.expiresAt !== null && row.expiresAt <= Date.now()) {
    memory().delete(key);
    return null;
  }
  return row.value;
}

function memoryWrite(key: string, value: string, ttlSeconds?: number) {
  memory().set(key, {
    value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
  });
}

/**
 * A counter that cannot be reached is not a reason to fail the request it
 * belongs to. Every failure here degrades to "nothing recorded", which leaves
 * the caller permissive — the wrong answer for the counter, but far better than
 * a store outage taking chat and video preparation down with it. Counting usage
 * is a side concern of those requests, and a side concern must not be able to
 * end them.
 */
async function attempt<T>(
  what: string,
  run: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    console.error(`[kv] ${what} failed, continuing without it`, error);
    return fallback;
  }
}

/** Upstash takes a command as a JSON array and answers with `{ result }`. */
async function command(parts: (string | number)[]): Promise<unknown> {
  const creds = credentials();
  if (!creds) throw new Error("kv command without credentials");
  const response = await fetch(creds.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(parts),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`kv ${parts[0]} failed with ${response.status}`);
  }
  const body = (await response.json()) as { result?: unknown };
  return body.result ?? null;
}

export async function kvGetJson<T>(key: string): Promise<T | null> {
  let raw: string | null;
  if (!credentials()) {
    warnOnce();
    raw = memoryRead(key);
  } else {
    raw = await attempt(
      `GET ${key}`,
      async () => {
        const result = await command(["GET", key]);
        return typeof result === "string" ? result : null;
      },
      null,
    );
  }
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function kvSetJson(
  key: string,
  value: unknown,
  ttlSeconds?: number,
): Promise<void> {
  const raw = JSON.stringify(value);
  if (!credentials()) {
    warnOnce();
    memoryWrite(key, raw, ttlSeconds);
    return;
  }
  await attempt(
    `SET ${key}`,
    () =>
      command(
        ttlSeconds ? ["SET", key, raw, "EX", ttlSeconds] : ["SET", key, raw],
      ),
    null,
  );
}

/**
 * 비어 있을 때만 쓴다(SET NX). 썼으면 true. 아이디처럼 둘이 동시에 가지면 안 되는 이름에.
 * 저장소에 닿지 못하면 false — 쓰지 못한 것을 썼다고 하지 않는다.
 */
export async function kvSetJsonIfAbsent(key: string, value: unknown, ttlSeconds?: number): Promise<boolean> {
  const raw = JSON.stringify(value);
  if (!credentials()) {
    warnOnce();
    if (memoryRead(key) !== null) return false;
    memoryWrite(key, raw, ttlSeconds);
    return true;
  }
  const parts: (string | number)[] = ["SET", key, raw, "NX"];
  if (ttlSeconds) parts.push("EX", ttlSeconds);
  return attempt(`SETNX ${key}`, async () => (await command(parts)) === "OK", false);
}

/**
 * Adds to a counter and returns the new total. The expiry is refreshed on every
 * call, which is harmless because every counter key already names its own day
 * or month — the key stops being written to before the window is over.
 */
export async function kvIncrBy(
  key: string,
  amount: number,
  ttlSeconds?: number,
): Promise<number> {
  if (!credentials()) {
    warnOnce();
    const current = Number(memoryRead(key) ?? 0);
    const next = current + amount;
    memoryWrite(key, String(next), ttlSeconds);
    return next;
  }
  return attempt(
    `INCRBY ${key}`,
    async () => {
      const result = await command(["INCRBY", key, amount]);
      if (ttlSeconds) await command(["EXPIRE", key, ttlSeconds]);
      return Number(result ?? 0);
    },
    0,
  );
}

export async function kvGetNumber(key: string): Promise<number> {
  if (!credentials()) {
    warnOnce();
    return Number(memoryRead(key) ?? 0);
  }
  return attempt(
    `GET ${key}`,
    async () => {
      const result = await command(["GET", key]);
      return typeof result === "string" || typeof result === "number"
        ? Number(result)
        : 0;
    },
    0,
  );
}


/**
 * Every key matching a glob, read in pages.
 *
 * Never call this from a request path. It walks the keyspace, so what it costs
 * grows with the store rather than with the answer — the opposite of every
 * other function here. It exists so a person can ask, offline and afterwards,
 * what a fortnight of use actually looked like.
 *
 * It throws where the rest of this file shrugs. A counter that quietly returns
 * zero costs one data point; a report built from half a scan is a wrong number
 * wearing the clothes of a right one, and someone would put it in an
 * application.
 */
export async function kvScanKeys(match: string, pageSize = 500): Promise<string[]> {
  if (!credentials()) {
    warnOnce();
    const pattern = new RegExp(
      "^" + match.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$",
    );
    return [...memory().keys()].filter((key) => pattern.test(key));
  }
  const found: string[] = [];
  const seen = new Set<string>();
  let cursor = "0";
  do {
    const result = await command(["SCAN", cursor, "MATCH", match, "COUNT", pageSize]);
    if (!Array.isArray(result) || result.length < 2) break;
    cursor = String(result[0]);
    const page = result[1];
    // SCAN may return the same key twice across pages; the caller is counting
    // distinct things, so dedupe here rather than in every caller.
    if (Array.isArray(page)) {
      for (const key of page) {
        if (typeof key === "string" && !seen.has(key)) {
          seen.add(key);
          found.push(key);
        }
      }
    }
  } while (cursor !== "0");
  return found;
}

/**
 * Several counters at once, in the order asked for. Missing keys read as zero.
 *
 * Chunked because a scan of a busy week produces more keys than belong in one
 * URL or one request body, and a report should not fail for being thorough.
 */
export async function kvGetNumbers(keys: string[], chunk = 200): Promise<number[]> {
  if (keys.length === 0) return [];
  if (!credentials()) {
    warnOnce();
    return keys.map((key) => Number(memoryRead(key) ?? 0));
  }
  const values: number[] = [];
  for (let at = 0; at < keys.length; at += chunk) {
    const slice = keys.slice(at, at + chunk);
    const result = await command(["MGET", ...slice]);
    const row = Array.isArray(result) ? result : [];
    for (let i = 0; i < slice.length; i += 1) {
      const raw = row[i];
      values.push(typeof raw === "string" || typeof raw === "number" ? Number(raw) : 0);
    }
  }
  return values;
}

/**
 * Append to a list, and keep it from outliving its purpose.
 *
 * For records that are written once and read in bulk later — a month of one
 * person's turns, say — where a JSON document would be a read, a change and a
 * write that two requests can interleave. RPUSH is one command and cannot lose
 * a row to a race. The TTL is reset on every push, so a list lives for that
 * long after its last row, which for a month-keyed list is the month plus it.
 */
export async function kvListPush(
  key: string,
  values: string[],
  ttlSeconds: number,
): Promise<void> {
  if (values.length === 0) return;
  if (!credentials()) {
    warnOnce();
    const current = JSON.parse(memoryRead(key) ?? "[]") as string[];
    memoryWrite(key, JSON.stringify([...current, ...values]), ttlSeconds);
    return;
  }
  await attempt(
    `RPUSH ${key}`,
    async () => {
      await command(["RPUSH", key, ...values]);
      await command(["EXPIRE", key, ttlSeconds]);
    },
    undefined,
  );
}

/** A slice of a list, oldest first; -1 for "to the end", as Redis reads it. */
export async function kvListRange(key: string, start = 0, stop = -1): Promise<string[]> {
  if (!credentials()) {
    warnOnce();
    const all = JSON.parse(memoryRead(key) ?? "[]") as string[];
    return all.slice(start, stop === -1 ? undefined : stop + 1);
  }
  return attempt(
    `LRANGE ${key}`,
    async () => {
      const result = await command(["LRANGE", key, start, stop]);
      return Array.isArray(result) ? result.map(String) : [];
    },
    [],
  );
}

/** Keep only the last `keep` entries of a list. */
export async function kvListTrim(key: string, keep: number): Promise<void> {
  if (!credentials()) {
    warnOnce();
    const raw = memoryRead(key);
    if (raw === null) return;
    const all = JSON.parse(raw) as string[];
    const row = memory().get(key);
    memory().set(key, { value: JSON.stringify(all.slice(-keep)), expiresAt: row?.expiresAt ?? null });
    return;
  }
  await attempt(`LTRIM ${key}`, async () => void (await command(["LTRIM", key, -keep, -1])), undefined);
}

/**
 * Remove every row equal to `value` from a list (LREM) — one command, so a row
 * pushed meanwhile is not lost the way a read-filter-rewrite would lose it.
 */
export async function kvListRemove(key: string, value: string): Promise<void> {
  if (!credentials()) {
    warnOnce();
    const raw = memoryRead(key);
    if (raw === null) return;
    const all = JSON.parse(raw) as string[];
    const row = memory().get(key);
    memory().set(key, { value: JSON.stringify(all.filter((item) => item !== value)), expiresAt: row?.expiresAt ?? null });
    return;
  }
  await attempt(`LREM ${key}`, async () => void (await command(["LREM", key, 0, value])), undefined);
}

/**
 * Read a list and remove exactly what was read — a mailbox.
 *
 * LRANGE then DEL would lose a row pushed between the two. Trimming off only
 * the count that was read leaves anything that arrived meanwhile for next time.
 */
export async function kvListTake(key: string): Promise<string[]> {
  if (!credentials()) {
    warnOnce();
    const raw = memoryRead(key);
    if (raw === null) return [];
    memory().delete(key);
    return JSON.parse(raw) as string[];
  }
  return attempt(
    `TAKE ${key}`,
    async () => {
      const result = await command(["LRANGE", key, 0, -1]);
      const rows = Array.isArray(result) ? result.map(String) : [];
      if (rows.length > 0) await command(["LTRIM", key, rows.length, -1]);
      return rows;
    },
    [],
  );
}

/** Remove keys outright — for a deletion request, not for routine expiry. */
export async function kvDelete(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  if (!credentials()) {
    warnOnce();
    for (const key of keys) memory().delete(key);
    return;
  }
  await attempt(`DEL ${keys.length} keys`, async () => void (await command(["DEL", ...keys])), undefined);
}

/* ---- 정렬된 모음(ZSET): 최근 활동 순 목록처럼 점수로 줄 세우는 것 ---- */

function memoryZset(key: string): Record<string, number> {
  return JSON.parse(memoryRead(key) ?? "{}") as Record<string, number>;
}

/** 점수와 함께 넣는다(있으면 점수만 바꿈). */
export async function kvZAdd(key: string, score: number, member: string): Promise<void> {
  if (!credentials()) {
    warnOnce();
    memoryWrite(key, JSON.stringify({ ...memoryZset(key), [member]: score }));
    return;
  }
  await attempt(`ZADD ${key}`, async () => void (await command(["ZADD", key, score, member])), undefined);
}

export async function kvZRem(key: string, member: string): Promise<void> {
  if (!credentials()) {
    warnOnce();
    const set = memoryZset(key);
    delete set[member];
    memoryWrite(key, JSON.stringify(set));
    return;
  }
  await attempt(`ZREM ${key}`, async () => void (await command(["ZREM", key, member])), undefined);
}

/** 점수 큰 것부터 [start, stop] 범위, 점수와 함께. */
export async function kvZRevRange(key: string, start: number, stop: number): Promise<{ member: string; score: number }[]> {
  if (!credentials()) {
    warnOnce();
    return Object.entries(memoryZset(key))
      .sort((a, b) => b[1] - a[1])
      .slice(start, stop < 0 ? undefined : stop + 1)
      .map(([member, score]) => ({ member, score }));
  }
  return attempt(
    `ZREVRANGE ${key}`,
    async () => {
      const result = await command(["ZREVRANGE", key, start, stop, "WITHSCORES"]);
      const flat = Array.isArray(result) ? result.map(String) : [];
      const rows: { member: string; score: number }[] = [];
      for (let i = 0; i + 1 < flat.length; i += 2) rows.push({ member: flat.at(i)!, score: Number(flat.at(i + 1)) });
      return rows;
    },
    [],
  );
}

/** 여러 JSON 값을 한 번에(MGET). 없는 키는 null. */
export async function kvGetJsonMany<T>(keys: string[]): Promise<(T | null)[]> {
  if (keys.length === 0) return [];
  const parse = (raw: unknown): T | null => {
    if (typeof raw !== "string") return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  };
  if (!credentials()) {
    warnOnce();
    return keys.map((key) => parse(memoryRead(key)));
  }
  return attempt(
    `MGET ${keys.length} keys`,
    async () => {
      const result = await command(["MGET", ...keys]);
      return Array.isArray(result) ? result.map(parse) : keys.map(() => null);
    },
    keys.map(() => null),
  );
}


/** 해시 칸 여러 개를 한 번에 더한다(HINCRBY를 Upstash pipeline 한 번으로). 실패하면 아무것도 안 남김. */
export async function kvHashIncrMany(key: string, amounts: Record<string, number>, ttlSeconds?: number): Promise<void> {
  const fields = Object.entries(amounts).filter(([, amount]) => amount);
  if (!fields.length) return;
  const creds = credentials();
  if (!creds) {
    warnOnce();
    const current = JSON.parse(memoryRead(key) ?? "{}") as Record<string, number>;
    for (const [field, amount] of fields) current[field] = (current[field] ?? 0) + amount;
    memoryWrite(key, JSON.stringify(current), ttlSeconds);
    return;
  }
  await attempt(
    `HINCRBY ${key} x${fields.length}`,
    async () => {
      const commands: (string | number)[][] = fields.map(([field, amount]) => ["HINCRBY", key, field, amount]);
      if (ttlSeconds) commands.push(["EXPIRE", key, ttlSeconds]);
      const response = await fetch(`${creds.url}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(commands),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`kv pipeline failed with ${response.status}`);
    },
    undefined,
  );
}

/** 해시 전체(HGETALL) — 칸 → 수. */
export async function kvHashGetAll(key: string): Promise<Record<string, number>> {
  if (!credentials()) {
    warnOnce();
    return JSON.parse(memoryRead(key) ?? "{}") as Record<string, number>;
  }
  return attempt(
    `HGETALL ${key}`,
    async () => {
      const result = await command(["HGETALL", key]);
      const out: Record<string, number> = {};
      if (Array.isArray(result)) for (let i = 0; i + 1 < result.length; i += 2) out[String(result[i])] = Number(result[i + 1]) || 0;
      else if (result && typeof result === "object") for (const [field, value] of Object.entries(result)) out[field] = Number(value) || 0;
      return out;
    },
    {},
  );
}
