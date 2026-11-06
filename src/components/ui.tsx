"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { AccountRequestError } from "@/lib/account/client";

type Tone = "primary" | "quiet" | "danger";

const TONE: Record<Tone, string> = {
  primary: "bg-marigold text-night font-semibold hover:brightness-105",
  quiet: "border border-line text-ink hover:bg-surface",
  danger: "border border-rose/60 text-rose hover:bg-rose/10",
};

export function Button({ tone = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return (
    <button
      {...props}
      className={`h-12 rounded-full px-5 text-[15px] transition disabled:opacity-40 ${TONE[tone]} ${className}`}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] text-muted">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-line bg-surface px-4 py-3 text-[15px] text-ink placeholder:text-muted/60 focus:border-marigold focus:outline-none";

/** 고를 수 있는 칩(성별·지역 등). */
export function Chip({ on, children, onClick }: { on: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-full border px-3.5 py-1.5 text-[14px] transition ${
        on ? "border-marigold bg-marigold/15 text-marigold" : "border-line text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/** 아래에서 올라오는 시트(신고·메뉴). */
export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        className="w-full max-w-md rounded-t-3xl border-t border-line bg-surface px-5 pb-8 pt-5"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

const MESSAGES: Record<string, string> = {
  NETWORK: "서버에 닿지 않아요. 연결을 확인하고 다시 눌러 주세요.",
  SIGNED_OUT: "다시 로그인해 주세요.",
  SUSPENDED: "운영 정책으로 이용이 잠시 멈춰 있어요.",
  UNVERIFIED: "본인인증을 마치면 이용할 수 있어요.",
  TARGET_UNVERIFIED: "상대가 아직 본인인증을 하지 않았어요.",
  LIMIT: "오늘 좋아요를 모두 썼어요. 내일 다시 보낼 수 있어요.",
  BLOCKED: "차단된 상대예요.",
  NOT_MATCHED: "매칭이 끊긴 대화예요.",
  NO_PROFILE: "프로필을 먼저 만들어 주세요.",
  FULL: "사진은 6장까지 올릴 수 있어요.",
  PHOTO_INVALID: "사진을 읽지 못했어요. 다른 사진을 골라 주세요.",
  PHOTO_TOO_BIG: "사진이 너무 커요. 다른 사진을 골라 주세요.",
  BAD_BIRTH_YEAR: "만 19세 이상(연 나이)만 가입할 수 있어요.",
  WRONG_PASSWORD: "아이디나 비밀번호가 맞지 않아요.",
  USERNAME_TAKEN: "이미 쓰는 아이디예요.",
  USERNAME_INVALID: "아이디는 영문·숫자 4~20자예요.",
  PASSWORD_WEAK: "비밀번호는 8자 이상이에요.",
  TOO_MANY_TRIES: "너무 많이 시도했어요. 잠시 뒤 다시 해 주세요.",
  INVALID_EMAIL: "이메일 주소를 확인해 주세요.",
  WRONG_CODE: "코드가 맞지 않아요.",
  CODE_EXPIRED: "코드가 만료됐어요. 다시 받아 주세요.",
  RATE_LIMITED: "코드를 너무 많이 받았어요. 한 시간 뒤 다시 해 주세요.",
  SEND_FAILED: "메일을 보내지 못했어요. 잠시 뒤 다시 해 주세요.",
  GOOGLE_FAILED: "Google 로그인이 되지 않았어요.",
  GOOGLE_CANCELLED: "",
  CI_TAKEN: "이미 다른 계정에서 인증한 정보예요. 한 사람은 한 계정만 쓸 수 있어요.",
  USED: "이미 쓴 인증이에요. 다시 인증해 주세요.",
  OFF: "이 정보로는 이용할 수 없어요.",
  NOT_CONFIGURED: "본인인증이 아직 준비되지 않았어요.",
  HOST_LIMIT: "모임은 동시에 3개까지 열 수 있어요.",
  NO_SEAT: "남은 자리가 없어요.",
  CLOSED: "마감된 모임이에요.",
  REJECTED: "참가할 수 없는 모임이에요.",
  ALREADY: "이미 신청했어요.",
  NO_MEET: "없어진 모임이에요.",
  BLOCKED_TEXT: "이 내용은 올릴 수 없어요.",
  BAD_TIME: "모임 시간은 지금부터 7일 안으로 정해 주세요.",
  BAD_AREA: "동네를 적어 주세요.",
  BAD_PLACE: "장소를 적어 주세요.",
  BAD_SEATS: "인원은 나를 포함해 2~10명이에요.",
  NOT_MEMBER: "모임에 참가한 사람만 볼 수 있어요.",
  JOIN_FAILED: "참가 처리를 못 했어요. 다시 눌러 주세요.",
};

export function errorText(error: unknown): string {
  const code =
    error instanceof ApiError || error instanceof AccountRequestError
      ? error.code
      : error instanceof Error
        ? error.message
        : "NETWORK";
  return MESSAGES[code] ?? "문제가 생겼어요. 다시 눌러 주세요.";
}

export function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  const text = errorText(error);
  if (!text) return null;
  return (
    <p role="alert" className="text-[14px] text-rose">
      {text}
    </p>
  );
}

// ── 아이콘(선 1.8, 24격자) ─────────────────────────────────

type IconProps = { className?: string; filled?: boolean };
const base = (className = "") => ({
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className,
  "aria-hidden": true,
});

export const Icon = {
  heart: ({ className, filled }: IconProps) => (
    <svg {...base(className)} fill={filled ? "currentColor" : "none"}>
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />
    </svg>
  ),
  close: ({ className }: IconProps) => (
    <svg {...base(className)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),
  cards: ({ className }: IconProps) => (
    <svg {...base(className)}>
      <rect x="6" y="3.5" width="12" height="17" rx="2.5" />
      <path d="M3.5 7v10M20.5 7v10" />
    </svg>
  ),
  chat: ({ className }: IconProps) => (
    <svg {...base(className)}>
      <path d="M4 5.5h16v10H9l-5 4v-14Z" />
    </svg>
  ),
  person: ({ className }: IconProps) => (
    <svg {...base(className)}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c1.4-3.6 4.2-5 7.5-5s6.1 1.4 7.5 5" />
    </svg>
  ),
  back: ({ className }: IconProps) => (
    <svg {...base(className)}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  ),
  more: ({ className }: IconProps) => (
    <svg {...base(className)}>
      <circle cx="5.5" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1" fill="currentColor" />
    </svg>
  ),
  plus: ({ className }: IconProps) => (
    <svg {...base(className)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  send: ({ className }: IconProps) => (
    <svg {...base(className)}>
      <path d="M4 12 20 4l-5 16-3-7-8-1Z" />
    </svg>
  ),
  glasses: ({ className }: IconProps) => (
    <svg {...base(className)}>
      <path d="M5 4h6l-.6 6.2A2.4 2.4 0 0 1 8 12.4a2.4 2.4 0 0 1-2.4-2.2L5 4Z" />
      <path d="M8 12.4V19M5.5 19h5" />
      <path d="M13 6h6l-.6 6.2a2.4 2.4 0 0 1-2.4 2.2 2.4 2.4 0 0 1-2.4-2.2L13 6Z" />
      <path d="M16 14.4V20M13.5 20h5" />
    </svg>
  ),
  shield: ({ className }: IconProps) => (
    <svg {...base(className)}>
      <path d="M12 3.5 19 6v5.5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9V6l7-2.5Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </svg>
  ),
};
