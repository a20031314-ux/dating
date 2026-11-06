"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { refreshAccount } from "@/lib/account/client";
import { readCachedAccount, subscribeSession } from "@/lib/account/session";
import { datingApi, photoUrl } from "@/lib/dating/client";
import type { DatingCard, DatingProfile } from "@/lib/dating/rules";
import { fetchVerifyStatus, submitVerification, takeReturnedVerification, type VerifyStatus } from "@/lib/verify/client";
import { ChatList, ChatRoom } from "./Chats";
import { Discover } from "./Discover";
import { LoginScreen } from "./LoginScreen";
import { Meetups } from "./Meetups";
import { MyPage } from "./MyPage";
import { ProfileEditor } from "./ProfileEditor";
import { ErrorLine, Icon } from "./ui";

type Tab = "discover" | "likes" | "meet" | "chats" | "me";

const TABS: { id: Tab; label: string; icon: (on: boolean) => React.ReactNode }[] = [
  { id: "discover", label: "추천", icon: () => <Icon.cards /> },
  { id: "likes", label: "받은 좋아요", icon: (on) => <Icon.heart filled={on} /> },
  { id: "meet", label: "모임", icon: () => <Icon.glasses /> },
  { id: "chats", label: "대화", icon: () => <Icon.chat /> },
  { id: "me", label: "내 정보", icon: () => <Icon.person /> },
];

/**
 * 앱 틀: 로그인 → (처음이면) 프로필 만들기 → 하단 탭 다섯(아이콘만, 이름은 aria-label).
 * 정적 내보내기(Capacitor)라 주소 대신 화면 상태로 옮겨 다닌다.
 */
export function App() {
  const account = useSyncExternalStore(subscribeSession, readCachedAccount, () => null);
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<DatingProfile | null | undefined>(undefined);
  const [verify, setVerify] = useState<VerifyStatus | null>(null);
  const [tab, setTab] = useState<Tab>("discover");
  const [chat, setChat] = useState<DatingCard | null>(null);
  const [chatsKey, setChatsKey] = useState(0);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    void refreshAccount().finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!account) return;
    let alive = true;
    void (async () => {
      try {
        const returned = takeReturnedVerification();
        const status = returned ? await submitVerification(returned).catch(() => fetchVerifyStatus()) : await fetchVerifyStatus();
        const me = await datingApi.me();
        if (!alive) return;
        setVerify(status);
        setProfile(me.profile);
        if (returned) setTab("me");
      } catch (caught) {
        if (alive) {
          setError(caught);
          setProfile(null);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [account]);

  if (!ready) return <Splash />;
  if (!account) return <LoginScreen />;
  if (profile === undefined) return <Splash />;

  // 처음: 기본 정보 → 사진 한 장 이상이면 시작.
  if (!profile || profile.photos.length === 0) {
    return (
      <main className="mx-auto w-full max-w-md px-5 pb-12 pt-10">
        <h1 className="mb-8 font-serif text-[32px] leading-tight">{profile ? "사진을 올려 주세요" : "나를 소개해요"}</h1>
        <ErrorLine error={error} />
        <ProfileEditor account={account} profile={profile} onSaved={setProfile} first />
      </main>
    );
  }

  const myPhoto = profile.photos[0] ? photoUrl(account.id, profile.photos[0]) : null;
  const locked = verify?.required && verify.state !== "verified";

  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col">
      <header className="flex items-baseline justify-between px-5 pb-3 pt-[max(env(safe-area-inset-top),16px)]">
        <h1 className="font-serif text-[26px]">{TABS.find((t) => t.id === tab)!.label}</h1>
      </header>

      {locked && tab !== "me" ? (
        <div className="flex flex-1 flex-col items-start justify-center gap-4 px-6">
          <Icon.shield className="h-8 w-8 text-marigold" />
          <p className="font-serif text-[26px] leading-snug">본인인증을 마치면 사람들을 볼 수 있어요</p>
          <button className="text-[15px] text-marigold" onClick={() => setTab("me")}>
            인증하러 가기
          </button>
        </div>
      ) : (
        <>
          {tab === "discover" && <Discover myPhoto={myPhoto} onMatch={() => setChatsKey((k) => k + 1)} onOpenChat={(m) => setChat(m.card)} />}
          {tab === "likes" && <Discover source="likedMe" myPhoto={myPhoto} onMatch={() => setChatsKey((k) => k + 1)} onOpenChat={(m) => setChat(m.card)} />}
          {tab === "meet" && <Meetups me={account.id} myGender={profile.gender} myRegion={profile.region} />}
          {tab === "chats" && <ChatList refreshKey={chatsKey} onOpen={setChat} />}
          {tab === "me" && <MyPage account={account} profile={profile} verify={verify} onProfile={setProfile} onVerify={setVerify} />}
        </>
      )}

      <nav className="grid grid-cols-5 border-t border-line pb-[max(env(safe-area-inset-bottom),8px)] pt-2" aria-label="탭">
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <button
              key={t.id}
              aria-label={t.label}
              title={t.label}
              aria-current={on ? "page" : undefined}
              onClick={() => setTab(t.id)}
              className={`flex justify-center py-2 ${on ? (t.id === "likes" ? "text-rose" : "text-marigold") : "text-muted"}`}
            >
              {t.icon(on)}
            </button>
          );
        })}
      </nav>

      {chat && (
        <ChatRoom
          me={account.id}
          card={chat}
          onClose={(changed) => {
            setChat(null);
            setChatsKey((k) => k + 1);
            if (changed) setTab("chats");
          }}
        />
      )}
    </div>
  );
}

function Splash() {
  return <div className="flex min-h-dvh items-center justify-center font-serif text-[22px] text-muted">…</div>;
}
