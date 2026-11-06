"use client";

import { useCallback, useEffect, useState } from "react";
import { datingApi, photoUrl } from "@/lib/dating/client";
import type { DatingCard } from "@/lib/dating/rules";
import { PersonCard } from "./PersonCard";
import { Button, ErrorLine, Icon } from "./ui";

export type Matched = { card: DatingCard; threadId: string };

/**
 * 추천 — 한 번에 한 사람. ✕ 패스 / ♥ 좋아요. 서로 좋아요면 그 자리에서 매칭 화면.
 * `source`를 주면 그 목록(받은 좋아요)을 넘긴다.
 */
export function Discover({
  source = "discover",
  myPhoto,
  onMatch,
  onOpenChat,
}: {
  source?: "discover" | "likedMe";
  myPhoto: string | null;
  onMatch?: () => void;
  onOpenChat: (match: Matched) => void;
}) {
  const [cards, setCards] = useState<DatingCard[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [matched, setMatched] = useState<Matched | null>(null);

  const load = useCallback(
    () =>
      (source === "discover" ? datingApi.discover() : datingApi.likedMe()).then(
        (result) => {
          setError(null);
          setCards(result.cards);
        },
        (caught: unknown) => {
          setError(caught);
          setCards([]);
        },
      ),
    [source],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const current = cards?.[0];

  async function decide(kind: "like" | "pass") {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === "pass") await datingApi.pass(current.id);
      else {
        const result = await datingApi.like(current.id);
        if (result.matched && result.threadId) {
          setMatched({ card: current, threadId: result.threadId });
          onMatch?.();
        }
      }
      const rest = cards!.slice(1);
      setCards(rest);
      if (rest.length === 0 && source === "discover") void load();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  if (cards === null) return <div className="flex flex-1 items-center justify-center text-muted">…</div>;

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
      {current ? (
        <>
          <div className="relative min-h-0 flex-1">
            <PersonCard key={current.id} card={current} />
          </div>
          <ErrorLine error={error} />
          <div className="flex items-center justify-center gap-6 pt-4">
            <button
              aria-label="패스"
              disabled={busy}
              onClick={() => void decide("pass")}
              className="flex h-16 w-16 items-center justify-center rounded-full border border-line text-muted transition hover:text-ink disabled:opacity-40"
            >
              <Icon.close className="h-7 w-7" />
            </button>
            <button
              aria-label="좋아요"
              disabled={busy}
              onClick={() => void decide("like")}
              className="flex h-20 w-20 items-center justify-center rounded-full bg-rose text-ink shadow-[0_8px_30px_-8px_var(--rose)] transition hover:brightness-110 disabled:opacity-40"
            >
              <Icon.heart className="h-9 w-9" filled />
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-start justify-center gap-5 px-2">
          <p className="font-serif text-[26px] leading-snug">
            {source === "discover" ? "지금 보여 줄 사람을 다 봤어요" : "아직 받은 좋아요가 없어요"}
          </p>
          <ErrorLine error={error} />
          {source === "discover" && (
            <Button tone="quiet" onClick={() => void load()}>
              다시 찾기
            </Button>
          )}
        </div>
      )}

      {matched && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-night px-8 text-center" role="dialog" aria-label="매칭">
          <div className="match-in flex flex-col items-center">
            <div className="flex -space-x-5">
              {myPhoto && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={myPhoto} alt="" className="h-28 w-28 rounded-full border-4 border-night object-cover" />
              )}
              {matched.card.photos[0] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoUrl(matched.card.id, matched.card.photos[0])}
                  alt=""
                  className="h-28 w-28 rounded-full border-4 border-night object-cover"
                />
              )}
            </div>
            <Icon.heart className="mt-6 h-8 w-8 text-rose" filled />
            <p className="mt-4 font-serif text-[30px] leading-tight">{matched.card.nickname}님과 연결됐어요</p>
          </div>
          <div className="mt-10 flex w-full max-w-xs flex-col gap-3">
            <Button
              onClick={() => {
                const match = matched;
                setMatched(null);
                onOpenChat(match);
              }}
            >
              대화 시작
            </Button>
            <Button tone="quiet" onClick={() => setMatched(null)}>
              계속 보기
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
