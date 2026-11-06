"use client";

import { useState } from "react";
import { photoUrl } from "@/lib/dating/client";
import { REGION_LABEL, type DatingCard } from "@/lib/dating/rules";

/** 한 사람 — 사진을 넘겨 보고(왼쪽·오른쪽 반을 누름), 이름·나이는 사진 위에 크게. */
export function PersonCard({ card }: { card: DatingCard }) {
  const [index, setIndex] = useState(0);
  const count = card.photos.length;
  const version = card.photos[Math.min(index, count - 1)];

  return (
    <article className="relative h-full w-full overflow-hidden rounded-[28px] bg-surface">
      {version && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl(card.id, version)} alt={`${card.nickname} 사진 ${index + 1}`} className="absolute inset-0 h-full w-full object-cover" />
      )}
      {count > 1 && (
        <>
          <div className="absolute inset-x-3 top-3 flex gap-1" aria-hidden>
            {card.photos.map((v, i) => (
              <span key={v} className={`h-[3px] flex-1 rounded-full ${i === index ? "bg-ink" : "bg-ink/30"}`} />
            ))}
          </div>
          <button aria-label="이전 사진" className="absolute inset-y-0 left-0 w-1/2" onClick={() => setIndex((i) => Math.max(0, i - 1))} />
          <button aria-label="다음 사진" className="absolute inset-y-0 right-0 w-1/2" onClick={() => setIndex((i) => Math.min(count - 1, i + 1))} />
        </>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-night via-night/70 to-transparent px-6 pb-6 pt-24">
        <h2 className="font-serif text-[34px] leading-none text-ink">
          {card.nickname} <span className="text-[26px] text-ink/80">{card.age}</span>
        </h2>
        <p className="mt-2 text-[14px] text-muted">{REGION_LABEL[card.region]}</p>
        {card.bio && <p className="mt-3 line-clamp-3 max-w-[34ch] text-[15px] leading-relaxed text-ink/90">{card.bio}</p>}
      </div>
    </article>
  );
}
