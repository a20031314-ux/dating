"use client";

import { useEffect, useState } from "react";
import { deleteAccount, logout } from "@/lib/account/client";
import type { PublicAccount } from "@/lib/account/shared";
import { socialApi } from "@/lib/dating/client";
import type { DatingCard, DatingProfile } from "@/lib/dating/rules";
import { openAdultVerification, portoneClientReady, submitVerification, type VerifyStatus } from "@/lib/verify/client";
import { ProfileEditor } from "./ProfileEditor";
import { Button, ErrorLine, Icon, Sheet } from "./ui";

export function MyPage({
  account,
  profile,
  verify,
  onProfile,
  onVerify,
}: {
  account: PublicAccount;
  profile: DatingProfile;
  verify: VerifyStatus | null;
  onProfile: (profile: DatingProfile) => void;
  onVerify: (status: VerifyStatus) => void;
}) {
  const [blocked, setBlocked] = useState<DatingCard[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void socialApi.blocked().then((result) => setBlocked(result.cards)).catch(() => undefined);
  }, []);

  async function verifyNow() {
    setBusy(true);
    setError(null);
    try {
      const id = await openAdultVerification(account.id);
      if (id) onVerify(await submitVerification(id));
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 space-y-10 overflow-y-auto px-5 pb-10">
      <VerifyRow status={verify} busy={busy} onVerify={() => void verifyNow()} />
      <ErrorLine error={error} />

      <ProfileEditor account={account} profile={profile} onSaved={onProfile} />

      {blocked.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-serif text-[22px]">차단한 사람</h2>
          <ul className="divide-y divide-line">
            {blocked.map((card) => (
              <li key={card.id} className="flex items-center justify-between py-3">
                <span>{card.nickname}</span>
                <button
                  className="text-[14px] text-muted hover:text-ink"
                  onClick={() => void socialApi.unblock(card.id).then(() => setBlocked((rows) => rows.filter((row) => row.id !== card.id)))}
                >
                  풀기
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3 border-t border-line pt-6">
        <Button tone="quiet" onClick={() => void logout()}>
          로그아웃
        </Button>
        <button className="py-2 text-[14px] text-muted hover:text-rose" onClick={() => setConfirmDelete(true)}>
          계정 지우기
        </button>
      </section>

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <h2 className="font-serif text-[22px]">계정을 지울까요?</h2>
        <p className="mt-2 text-[15px] text-muted">프로필·사진·매칭이 모두 사라지고 되돌릴 수 없어요.</p>
        <div className="mt-6 flex flex-col gap-3">
          <Button tone="danger" onClick={() => void deleteAccount().catch(setError)}>
            지우기
          </Button>
          <Button tone="quiet" onClick={() => setConfirmDelete(false)}>
            그대로 두기
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

function VerifyRow({ status, busy, onVerify }: { status: VerifyStatus | null; busy: boolean; onVerify: () => void }) {
  if (!status) return null;
  if (status.state === "verified") {
    return (
      <p className="flex items-center gap-2 pt-2 text-[15px] text-marigold">
        <Icon.shield className="h-5 w-5" /> 본인인증 완료
      </p>
    );
  }
  if (status.state === "blocked" || status.state === "minor") {
    return <p className="pt-2 text-[15px] text-rose">이 계정은 이용할 수 없어요.</p>;
  }
  const canOpen = status.ready && portoneClientReady();
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-line px-4 py-4">
      <span className="flex items-center gap-2 text-[15px]">
        <Icon.shield className="h-5 w-5 text-muted" /> 본인인증
      </span>
      <Button className="h-10 px-4 text-[14px]" disabled={!canOpen || busy} onClick={onVerify}>
        {canOpen ? "인증하기" : "준비 중"}
      </Button>
    </div>
  );
}
