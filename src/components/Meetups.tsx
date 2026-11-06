"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { REGIONS, REGION_LABEL, type Gender, type Region } from "@/lib/dating/rules";
import { photoUrl } from "@/lib/dating/client";
import { hostPhotoUrl, meetApi, seatsLabel, whenLabel, type MeetDetail } from "@/lib/meet/client";
import {
  COST_LABEL,
  MEET_AREA_MAX,
  MEET_COSTS,
  MEET_MAX_PEOPLE,
  MEET_MIN_PEOPLE,
  MEET_NOTE_MAX,
  MEET_PLACE_MAX,
  seatLeft,
  type MeetCost,
  type MeetSeats,
  type MeetView,
} from "@/lib/meet/rules";
import type { GroupMessage } from "@/lib/rooms/group";
import { Button, Chip, ErrorLine, Field, Icon, Sheet, inputClass } from "./ui";

/**
 * 지역 모임 탭: 지역 칩 → 모집글 목록(가까운 시각 순) · ＋ 모집하기 · 글을 누르면 자세히(신청·승인·채팅).
 */
export function Meetups({ me, myGender, myRegion }: { me: string; myGender: Gender; myRegion: Region }) {
  const [region, setRegion] = useState<Region>(myRegion);
  const [view, setView] = useState<"region" | "mine">("region");
  const [meets, setMeets] = useState<MeetView[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [regionPick, setRegionPick] = useState(false);

  const load = useCallback(
    () =>
      (view === "region" ? meetApi.list(region) : meetApi.mine()).then(
        (result) => {
          setError(null);
          setMeets(result.meets);
        },
        (caught: unknown) => {
          setError(caught);
          setMeets([]);
        },
      ),
    [region, view],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-4 pb-3">
        <Chip on={view === "region"} onClick={() => (view === "region" ? setRegionPick(true) : setView("region"))}>
          {REGION_LABEL[region]} ▾
        </Chip>
        <Chip on={view === "mine"} onClick={() => setView("mine")}>
          내 모임
        </Chip>
        <button
          aria-label="모집하기"
          className="ml-auto flex h-10 w-10 items-center justify-center rounded-full bg-marigold text-night"
          onClick={() => setCreating(true)}
        >
          <Icon.plus className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        <ErrorLine error={error} />
        {meets === null ? (
          <p className="pt-10 text-center text-muted">…</p>
        ) : meets.length === 0 ? (
          <p className="pt-16 font-serif text-[24px] leading-snug">
            {view === "region" ? `${REGION_LABEL[region]}에 열린 모임이 없어요` : "열었거나 신청한 모임이 없어요"}
          </p>
        ) : (
          <ul className="space-y-3">
            {meets.map((meet) => (
              <li key={meet.id}>
                <MeetRow meet={meet} onOpen={() => setOpenId(meet.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <Sheet open={regionPick} onClose={() => setRegionPick(false)}>
        <div className="flex flex-wrap gap-2">
          {REGIONS.map((r) => (
            <Chip
              key={r}
              on={r === region}
              onClick={() => {
                setRegion(r);
                setRegionPick(false);
              }}
            >
              {REGION_LABEL[r]}
            </Chip>
          ))}
        </div>
      </Sheet>

      {creating && (
        <MeetCreate
          region={region}
          myGender={myGender}
          onClose={(createdId) => {
            setCreating(false);
            if (createdId) {
              void load();
              setOpenId(createdId);
            }
          }}
        />
      )}
      {openId && (
        <MeetDetailView
          me={me}
          id={openId}
          onClose={() => {
            setOpenId(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

const RELATION: Partial<Record<MeetView["me"], string>> = { host: "내 모임", member: "참가 중", pending: "신청함", rejected: "마감" };

function MeetRow({ meet, onOpen }: { meet: MeetView; onOpen: () => void }) {
  const photo = hostPhotoUrl(meet.host.photo);
  const badge = RELATION[meet.me] ?? (meet.open ? null : "마감");
  return (
    <button onClick={onOpen} className="w-full rounded-3xl border border-line bg-surface px-5 py-4 text-left transition hover:border-muted/50">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-serif text-[24px] leading-none">{whenLabel(meet.at)}</span>
        {badge && <span className={`text-[13px] ${meet.me === "member" || meet.me === "host" ? "text-marigold" : "text-muted"}`}>{badge}</span>}
      </div>
      <p className="mt-2 text-[16px]">{meet.area}</p>
      {meet.note && <p className="mt-1 line-clamp-2 text-[14px] text-muted">{meet.note}</p>}
      <div className="mt-4 flex items-center gap-2 text-[13px] text-muted">
        <span className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-night">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photo && <img src={photo} alt="" className="h-full w-full object-cover" />}
        </span>
        <span className="text-ink">{meet.host.nickname}</span>
        <span>{meet.host.age}</span>
        <span className="ml-auto">{seatsLabel(meet.seats, meet.filled)}</span>
        <span className="rounded-full border border-line px-2 py-0.5">{COST_LABEL[meet.cost]}</span>
      </div>
    </button>
  );
}

/** 처음 보이는 모임 시각: 오늘 23시(이미 지났으면 지금부터 한 시간 뒤 정시). */
function defaultTime(): string {
  const now = new Date();
  const at = new Date(now);
  at.setHours(23, 0, 0, 0);
  if (at.getTime() - now.getTime() < 30 * 60 * 1000) {
    at.setTime(now.getTime() + 60 * 60 * 1000);
    at.setMinutes(0, 0, 0);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-line px-4 py-2">
      <span className="text-[15px]">{label}</span>
      <span className="flex items-center gap-3">
        <button aria-label={`${label} 줄이기`} className="h-9 w-9 rounded-full border border-line disabled:opacity-30" disabled={value <= min} onClick={() => onChange(value - 1)}>
          −
        </button>
        <span className="w-5 text-center font-serif text-[20px]">{value}</span>
        <button aria-label={`${label} 늘리기`} className="h-9 w-9 rounded-full border border-line disabled:opacity-30" disabled={value >= max} onClick={() => onChange(value + 1)}>
          +
        </button>
      </span>
    </div>
  );
}

function MeetCreate({ region: startRegion, myGender, onClose }: { region: Region; myGender: Gender; onClose: (createdId?: string) => void }) {
  const [region, setRegion] = useState<Region>(startRegion);
  const [area, setArea] = useState("");
  const [place, setPlace] = useState("");
  const [time, setTime] = useState(defaultTime);
  const [ratio, setRatio] = useState(false);
  const [total, setTotal] = useState(4);
  const [m, setM] = useState(2);
  const [f, setF] = useState(2);
  const [cost, setCost] = useState<MeetCost>("split");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const seats: MeetSeats = ratio ? { kind: "ratio", m, f } : { kind: "any", total };
  const people = ratio ? m + f : total;
  const hostSeat = !ratio || (myGender === "m" ? m : f) >= 1;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { meet } = await meetApi.create({ region, area, place, at: new Date(time).getTime(), seats, cost, note });
      onClose(meet.id);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 mx-auto flex max-w-md flex-col bg-night">
      <header className="flex items-center gap-2 border-b border-line px-2 py-2">
        <button aria-label="닫기" className="p-2" onClick={() => onClose()}>
          <Icon.close />
        </button>
        <h1 className="font-serif text-[20px]">모집하기</h1>
      </header>
      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <div className="grid grid-cols-[1fr_1.4fr] gap-3">
          <Field label="지역">
            <select className={inputClass} value={region} onChange={(e) => setRegion(e.target.value as Region)}>
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {REGION_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="동네">
            <input className={inputClass} maxLength={MEET_AREA_MAX} placeholder="홍대입구" value={area} onChange={(e) => setArea(e.target.value)} />
          </Field>
        </div>
        <Field label="장소 · 참가자에게만 보여요">
          <input className={inputClass} maxLength={MEET_PLACE_MAX} value={place} onChange={(e) => setPlace(e.target.value)} />
        </Field>
        <Field label="시간">
          <input className={inputClass} type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted">인원 {people}명 · 나 포함</span>
            <label className="flex items-center gap-2 text-[14px]">
              성비 정하기
              <input type="checkbox" className="h-5 w-5 accent-marigold" checked={ratio} onChange={(e) => setRatio(e.target.checked)} />
            </label>
          </div>
          {ratio ? (
            <>
              <Stepper label="남" value={m} min={0} max={MEET_MAX_PEOPLE - f} onChange={setM} />
              <Stepper label="여" value={f} min={0} max={MEET_MAX_PEOPLE - m} onChange={setF} />
            </>
          ) : (
            <Stepper label="전체" value={total} min={MEET_MIN_PEOPLE} max={MEET_MAX_PEOPLE} onChange={setTotal} />
          )}
        </div>
        <Field label="비용">
          <div className="flex gap-2">
            {MEET_COSTS.map((c) => (
              <Chip key={c} on={cost === c} onClick={() => setCost(c)}>
                {COST_LABEL[c]}
              </Chip>
            ))}
          </div>
        </Field>
        <Field label="한 줄 소개">
          <textarea className={`${inputClass} min-h-20 resize-none`} maxLength={MEET_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <ErrorLine error={error} />
      </div>
      <div className="border-t border-line px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-3">
        <Button className="w-full" disabled={busy || !area.trim() || !place.trim() || !hostSeat || people < MEET_MIN_PEOPLE} onClick={() => void submit()}>
          모집하기
        </Button>
      </div>
    </div>
  );
}

function MeetDetailView({ me, id, onClose }: { me: string; id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<MeetDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [chatting, setChatting] = useState(false);

  const load = useCallback(
    () =>
      meetApi.get(id).then(
        (result) => {
          setError(null);
          setDetail(result);
        },
        setError,
      ),
    [id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function run(work: () => Promise<unknown>, closeAfter = false) {
    setBusy(true);
    setError(null);
    try {
      await work();
      if (closeAfter) onClose();
      else await load();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  const meet = detail?.meet;
  const photo = meet ? hostPhotoUrl(meet.host.photo) : null;

  return (
    <div className="fixed inset-0 z-40 mx-auto flex max-w-md flex-col bg-night">
      <header className="flex items-center gap-2 border-b border-line px-2 py-2">
        <button aria-label="뒤로" className="p-2" onClick={onClose}>
          <Icon.back />
        </button>
        <h1 className="flex-1 truncate font-serif text-[20px]">{meet?.area ?? ""}</h1>
      </header>

      {!meet ? (
        <div className="p-6">
          <ErrorLine error={error} />
        </div>
      ) : (
        <>
          <div className="flex-1 space-y-7 overflow-y-auto px-5 py-6">
            <section>
              <p className="font-serif text-[34px] leading-none">{whenLabel(meet.at)}</p>
              <p className="mt-3 text-[17px]">
                {REGION_LABEL[meet.region]} {meet.area}
              </p>
              {meet.place && <p className="mt-1 text-[15px] text-marigold">{meet.place}</p>}
              <div className="mt-4 flex flex-wrap gap-2 text-[14px]">
                <span className="rounded-full border border-line px-3 py-1">{seatsLabel(meet.seats, meet.filled)}</span>
                <span className="rounded-full border border-line px-3 py-1">{COST_LABEL[meet.cost]}</span>
              </div>
              {meet.note && <p className="mt-5 max-w-[36ch] text-[15px] leading-relaxed text-ink/90">{meet.note}</p>}
            </section>

            <section className="flex items-center gap-3">
              <span className="h-12 w-12 overflow-hidden rounded-full bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {photo && <img src={photo} alt="" className="h-full w-full object-cover" />}
              </span>
              <span>
                <span className="block font-serif text-[18px]">{meet.host.nickname}</span>
                <span className="text-[13px] text-muted">모집한 사람 · {meet.host.age}</span>
              </span>
            </section>

            {detail.applicants && detail.applicants.length > 0 && (
              <section className="space-y-3">
                <h2 className="font-serif text-[20px]">신청 {detail.applicants.length}</h2>
                <ul className="space-y-2">
                  {detail.applicants.map(({ card, gender }) => (
                    <li key={card.id} className="flex items-center gap-3 rounded-2xl border border-line px-3 py-2.5">
                      <Face id={card.id} version={card.photos[0]} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{card.nickname}</span>
                        <span className="text-[13px] text-muted">
                          {gender === "m" ? "남" : "여"} {card.age} · {REGION_LABEL[card.region]}
                        </span>
                      </span>
                      <button className="px-2 text-[14px] text-muted hover:text-ink" disabled={busy} onClick={() => void run(() => meetApi.decide("reject", meet.id, card.id))}>
                        거절
                      </button>
                      {seatLeft(meet.seats, meet.filled, gender) ? (
                        <Button className="h-9 px-4 text-[14px]" disabled={busy} onClick={() => void run(() => meetApi.decide("approve", meet.id, card.id))}>
                          수락
                        </Button>
                      ) : (
                        <span className="px-2 text-[13px] text-muted">자리 없음</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {detail.members.length > 0 && (
              <section className="space-y-3">
                <h2 className="font-serif text-[20px]">참가자 {detail.members.length}</h2>
                <ul className="flex flex-wrap gap-4">
                  {detail.members.map((card) => (
                    <li key={card.id} className="flex w-16 flex-col items-center gap-1">
                      <Face id={card.id} version={card.photos[0]} big />
                      <span className="w-full truncate text-center text-[13px]">{card.nickname}</span>
                      {meet.me === "host" && card.id !== me && (
                        <button className="text-[12px] text-muted hover:text-rose" disabled={busy} onClick={() => void run(() => meetApi.decide("kick", meet.id, card.id))}>
                          내보내기
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <ErrorLine error={error} />
          </div>

          <div className="flex gap-2 border-t border-line px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-3">
            {(meet.me === "host" || meet.me === "member") && (
              <Button className="flex-1" onClick={() => setChatting(true)}>
                채팅
              </Button>
            )}
            {meet.me === "host" && meet.open && (
              <Button tone="quiet" disabled={busy} onClick={() => void run(() => meetApi.act("close", meet.id))}>
                모집 닫기
              </Button>
            )}
            {meet.me === "member" && (
              <Button tone="quiet" disabled={busy} onClick={() => void run(() => meetApi.act("leave", meet.id), true)}>
                나가기
              </Button>
            )}
            {meet.me === "pending" && (
              <Button tone="quiet" className="flex-1" disabled={busy} onClick={() => void run(() => meetApi.act("cancel", meet.id))}>
                신청 취소
              </Button>
            )}
            {meet.me === "none" && (
              <Button className="flex-1" disabled={busy || !meet.open} onClick={() => void run(() => meetApi.act("apply", meet.id))}>
                {meet.open ? "참가 신청" : "마감"}
              </Button>
            )}
            {meet.me === "rejected" && (
              <Button className="flex-1" disabled>
                마감
              </Button>
            )}
          </div>
        </>
      )}

      {chatting && meet && <MeetChat me={me} id={meet.id} title={meet.area} members={detail?.members ?? []} onClose={() => setChatting(false)} />}
    </div>
  );
}

function Face({ id, version, big }: { id: string; version?: string; big?: boolean }) {
  return (
    <span className={`${big ? "h-14 w-14" : "h-11 w-11"} shrink-0 overflow-hidden rounded-full bg-surface`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {version && <img src={photoUrl(id, version)} alt="" className="h-full w-full object-cover" />}
    </span>
  );
}

const SYSTEM_TEXT: Record<string, string> = { join: "님이 들어왔어요", leave: "님이 나갔어요", kick: "님이 나갔어요", host: "님이 모임장이 됐어요" };

/** 모임 단체방 — 원본 단체방 저장소, 3초마다 새 줄. */
function MeetChat({ me, id, title, members, onClose }: { me: string; id: string; title: string; members: MeetDetail["members"]; onClose: () => void }) {
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<unknown>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastSeq = messages.at(-1)?.seq ?? 0;
  const names = new Map(members.map((card) => [card.id, card]));

  const merge = useCallback((rows: GroupMessage[], gone: number[]) => {
    setMessages((prev) => {
      const bySeq = new Map(prev.map((row) => [row.seq, row]));
      for (const row of rows) bySeq.set(row.seq, row);
      for (const seq of gone) bySeq.delete(seq);
      return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
    });
  }, []);

  useEffect(() => {
    const tick = () =>
      meetApi.chat(id, lastSeq).then(
        (result) => merge(result.messages, result.gone),
        (caught: unknown) => setError(caught),
      );
    void tick();
    const timer = setInterval(() => void tick(), 3000);
    return () => clearInterval(timer);
  }, [id, lastSeq, merge]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setText("");
    try {
      merge([(await meetApi.send(id, body)).message], []);
    } catch (caught) {
      setText(body);
      setError(caught);
    }
  }

  return (
    <div className="fixed inset-0 z-50 mx-auto flex max-w-md flex-col bg-night">
      <header className="flex items-center gap-2 border-b border-line px-2 py-2">
        <button aria-label="뒤로" className="p-2" onClick={onClose}>
          <Icon.back />
        </button>
        <h1 className="flex-1 truncate font-serif text-[19px]">{title}</h1>
        <span className="pr-3 text-[14px] text-muted">{members.length}</span>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {messages.map((row) => {
          const who = names.get(row.from);
          if (row.kind === "system") {
            return (
              <p key={row.seq} className="py-1 text-center text-[13px] text-muted">
                {who?.nickname ?? ""}
                {SYSTEM_TEXT[row.text] ?? ""}
              </p>
            );
          }
          const mine = row.from === me;
          return (
            <div key={row.seq} className={`flex gap-2 ${mine ? "justify-end" : "justify-start"}`}>
              {!mine && <Face id={row.from} version={who?.photos[0]} />}
              <div className={`flex max-w-[75%] flex-col ${mine ? "items-end" : "items-start"}`}>
                {!mine && <span className="mb-1 text-[12px] text-muted">{who?.nickname ?? ""}</span>}
                <p
                  className={`whitespace-pre-wrap break-words rounded-3xl px-4 py-2.5 text-[15px] leading-relaxed ${
                    mine ? "rounded-br-md bg-marigold text-night" : "rounded-bl-md bg-surface"
                  }`}
                >
                  {row.text}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <div className="border-t border-line px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-3">
        <ErrorLine error={error} />
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea rows={1} aria-label="메시지" className={`${inputClass} max-h-32 resize-none rounded-3xl`} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
          <button aria-label="보내기" disabled={!text.trim()} className="mb-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-marigold text-night disabled:opacity-40">
            <Icon.send className="h-5 w-5" />
          </button>
        </form>
      </div>
    </div>
  );
}
