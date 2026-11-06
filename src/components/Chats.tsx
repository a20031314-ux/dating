"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { datingApi, dmApi, photoUrl, socialApi } from "@/lib/dating/client";
import { lastSeenMine, type DmMessage, type DmSummary } from "@/lib/rooms/dm";
import type { DatingCard, MatchRow } from "@/lib/dating/rules";
import { Button, ErrorLine, Icon, Sheet, inputClass } from "./ui";

/** 매칭 목록 — 새 매칭은 위 줄(사진만), 대화가 시작된 사람은 아래 줄(마지막 말·안 읽은 수). */
export function ChatList({ onOpen, refreshKey }: { onOpen: (card: DatingCard) => void; refreshKey: number }) {
  const [matches, setMatches] = useState<MatchRow[] | null>(null);
  const [inbox, setInbox] = useState<Map<string, DmSummary>>(new Map());
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [m, box] = await Promise.all([datingApi.matches(), dmApi.inbox()]);
        if (!alive) return;
        setMatches(m.matches);
        setInbox(new Map(box.threads.map((row) => [row.thread.id, row])));
      } catch (caught) {
        if (alive) setError(caught);
      }
    })();
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  if (!matches) return <div className="flex flex-1 items-center justify-center text-muted">{error ? <ErrorLine error={error} /> : "…"}</div>;

  const talking = matches
    .filter((row) => inbox.get(row.threadId)?.thread.lastSeq)
    .sort((a, b) => (inbox.get(b.threadId)?.thread.lastAt ?? 0) - (inbox.get(a.threadId)?.thread.lastAt ?? 0));
  const fresh = matches.filter((row) => !inbox.get(row.threadId)?.thread.lastSeq);

  if (matches.length === 0) {
    return (
      <div className="flex flex-1 items-center px-6">
        <p className="font-serif text-[26px] leading-snug">서로 좋아요를 누르면 여기서 대화가 열려요</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-6">
      {fresh.length > 0 && (
        <section aria-label="새 매칭" className="mb-6">
          <div className="flex gap-3 overflow-x-auto pb-1">
            {fresh.map((row) => (
              <button key={row.card.id} onClick={() => onOpen(row.card)} className="flex w-20 shrink-0 flex-col items-center gap-1.5">
                <Avatar card={row.card} size="h-20 w-20" ring />
                <span className="w-full truncate text-center text-[13px]">{row.card.nickname}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <ul className="divide-y divide-line">
        {talking.map((row) => {
          const summary = inbox.get(row.threadId)!;
          return (
            <li key={row.card.id}>
              <button onClick={() => onOpen(row.card)} className="flex w-full items-center gap-3 py-3 text-left">
                <Avatar card={row.card} size="h-14 w-14" />
                <span className="min-w-0 flex-1">
                  <span className="block font-serif text-[18px]">{row.card.nickname}</span>
                  <span className="block truncate text-[14px] text-muted">{summary.thread.lastText}</span>
                </span>
                {summary.unread > 0 && (
                  <span className="min-w-6 rounded-full bg-rose px-1.5 py-0.5 text-center text-[12px] font-semibold">{summary.unread}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Avatar({ card, size, ring }: { card: DatingCard; size: string; ring?: boolean }) {
  const version = card.photos[0];
  return (
    <span className={`${size} shrink-0 overflow-hidden rounded-full bg-surface ${ring ? "ring-2 ring-rose ring-offset-2 ring-offset-night" : ""}`}>
      {version && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl(card.id, version)} alt="" className="h-full w-full object-cover" />
      )}
    </span>
  );
}

const REPORT_REASONS = ["사진이 본인이 아니에요", "불쾌한 말을 했어요", "돈·투자·다른 앱을 권해요", "미성년자 같아요", "그 밖의 이유"];

/** 한 사람과의 대화 — 3초마다 새 줄을 받는다(원본 1:1 메시지와 같은 방식). */
export function ChatRoom({ me, card, onClose }: { me: string; card: DatingCard; onClose: (changed: boolean) => void }) {
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [peerRead, setPeerRead] = useState(0);
  const [matched, setMatched] = useState(true);
  const [text, setText] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [menu, setMenu] = useState<"closed" | "menu" | "report">("closed");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastSeq = messages.length ? messages[messages.length - 1].seq : 0;

  const merge = useCallback((rows: DmMessage[], gone: number[]) => {
    setMessages((prev) => {
      const bySeq = new Map(prev.map((row) => [row.seq, row]));
      for (const row of rows) bySeq.set(row.seq, row);
      for (const seq of gone) bySeq.delete(seq);
      return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
    });
  }, []);

  useEffect(() => {
    void dmApi
      .open(card.id)
      .then((result) => {
        setThreadId(result.thread?.id ?? null);
        setPeerRead(result.peerRead);
        setMatched(result.matched && !result.blocked);
        merge(result.messages, result.gone);
      })
      .catch(setError);
  }, [card.id, merge]);

  useEffect(() => {
    if (!threadId) return;
    const timer = setInterval(() => {
      void dmApi
        .poll(threadId, lastSeq)
        .then((result) => {
          setPeerRead(result.peerRead);
          merge(result.messages, result.gone);
        })
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [threadId, lastSeq, merge]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setText("");
    setError(null);
    try {
      const result = await dmApi.send(card.id, body);
      setThreadId(result.thread.id);
      merge([result.message], []);
    } catch (caught) {
      setText(body);
      setError(caught);
    }
  }

  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    try {
      await work();
      onClose(true);
    } catch (caught) {
      setError(caught);
      setMenu("closed");
    } finally {
      setBusy(false);
    }
  }

  const seen = lastSeenMine(messages, me, peerRead);

  return (
    <div className="fixed inset-0 z-40 mx-auto flex max-w-md flex-col bg-night">
      <header className="flex items-center gap-2 border-b border-line px-2 py-2">
        <button aria-label="뒤로" className="p-2" onClick={() => onClose(false)}>
          <Icon.back />
        </button>
        <Avatar card={card} size="h-9 w-9" />
        <h1 className="flex-1 truncate font-serif text-[19px]">{card.nickname}</h1>
        <button aria-label="메뉴" className="p-2 text-muted" onClick={() => setMenu("menu")}>
          <Icon.more />
        </button>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {messages.map((row) => {
          const mine = row.from === me;
          return (
            <div key={row.seq} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
              <p
                className={`max-w-[78%] whitespace-pre-wrap break-words rounded-3xl px-4 py-2.5 text-[15px] leading-relaxed ${
                  mine ? "rounded-br-md bg-marigold text-night" : "rounded-bl-md bg-surface text-ink"
                }`}
              >
                {row.text}
              </p>
              {mine && row.seq === seen && <span className="mt-1 text-[12px] text-muted">읽음</span>}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-line px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-3">
        <ErrorLine error={error} />
        {matched ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              rows={1}
              className={`${inputClass} max-h-32 resize-none rounded-3xl`}
              value={text}
              maxLength={1000}
              onChange={(e) => setText(e.target.value)}
              aria-label="메시지"
            />
            <button aria-label="보내기" disabled={!text.trim()} className="mb-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-marigold text-night disabled:opacity-40">
              <Icon.send className="h-5 w-5" />
            </button>
          </form>
        ) : (
          <p className="py-2 text-center text-[14px] text-muted">대화가 끝났어요</p>
        )}
      </div>

      <Sheet open={menu === "menu"} onClose={() => setMenu("closed")}>
        <div className="flex flex-col gap-3">
          <Button tone="quiet" disabled={busy} onClick={() => void act(() => datingApi.unmatch(card.id))}>
            매칭 끊기
          </Button>
          <Button tone="danger" disabled={busy} onClick={() => setMenu("report")}>
            신고하기
          </Button>
          <Button tone="danger" disabled={busy} onClick={() => void act(() => socialApi.block(card.id))}>
            차단하기
          </Button>
        </div>
      </Sheet>
      <Sheet open={menu === "report"} onClose={() => setMenu("closed")}>
        <h2 className="mb-4 font-serif text-[22px]">신고 이유</h2>
        <div className="flex flex-col gap-2">
          {REPORT_REASONS.map((reason) => (
            <Button
              key={reason}
              tone="quiet"
              disabled={busy}
              className="text-left"
              onClick={() =>
                void act(async () => {
                  const theirs = messages.filter((row) => row.from === card.id).slice(-5).map((row) => row.text);
                  await socialApi.report(card.id, reason, theirs);
                  await socialApi.block(card.id);
                })
              }
            >
              {reason}
            </Button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
