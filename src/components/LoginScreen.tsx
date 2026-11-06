"use client";

import { useEffect, useState } from "react";
import {
  fetchAuthConfig,
  googleLogin,
  passwordLogin,
  passwordSignup,
  startEmailLogin,
  verifyEmailLogin,
} from "@/lib/account/client";
import type { AuthConfig } from "@/lib/account/shared";
import { Button, ErrorLine, Field, inputClass } from "./ui";

/**
 * 로그인 — 원본 계정 기능(아이디·비밀번호, 이메일 코드, Google)을 그대로 부른다.
 * 서버에 켜진 방식만 보인다(/api/account/config).
 */
export function LoginScreen() {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [mode, setMode] = useState<"login" | "signup" | "email">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    void fetchAuthConfig().then(setConfig);
  }, []);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  const noMethod = config && !config.password && !config.email && !config.googleClientId;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pb-10 pt-[18vh]">
      <h1 className="font-serif text-[40px] leading-[1.15] text-ink">
        오늘 밤,
        <br />
        누군가와
        <br />
        이야기해요
      </h1>

      <div className="mt-auto space-y-4 pt-12">
        {noMethod && <p className="text-[14px] text-muted">서버에 로그인 방식이 켜져 있지 않아요. README의 환경 변수를 확인해 주세요.</p>}

        {config?.googleClientId && (
          <Button tone="quiet" className="w-full" disabled={busy} onClick={() => run(() => googleLogin(config.googleClientId!))}>
            Google로 계속하기
          </Button>
        )}

        {mode !== "email" && config?.password && (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => (mode === "login" ? passwordLogin(username, password) : passwordSignup(username, password)));
            }}
          >
            <Field label="아이디">
              <input className={inputClass} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
            </Field>
            <Field label="비밀번호">
              <input
                className={inputClass}
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Button className="w-full" disabled={busy || !username || !password}>
              {mode === "login" ? "로그인" : "가입하기"}
            </Button>
          </form>
        )}

        {mode === "email" && (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!codeSent) void run(async () => { await startEmailLogin(email, "ko"); setCodeSent(true); });
              else void run(() => verifyEmailLogin(email, code));
            }}
          >
            <Field label="이메일">
              <input className={inputClass} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            {codeSent && (
              <Field label="받은 코드 6자리">
                <input className={inputClass} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
            )}
            <Button className="w-full" disabled={busy || !email || (codeSent && code.length !== 6)}>
              {codeSent ? "로그인" : "코드 받기"}
            </Button>
          </form>
        )}

        <ErrorLine error={error} />

        <div className="flex justify-center gap-5 pt-1 text-[14px] text-muted">
          {config?.password && mode !== "login" && <button onClick={() => setMode("login")}>아이디로 로그인</button>}
          {config?.password && mode !== "signup" && <button onClick={() => setMode("signup")}>새로 가입</button>}
          {config?.email && mode !== "email" && <button onClick={() => setMode("email")}>이메일로</button>}
        </div>
      </div>
    </main>
  );
}
