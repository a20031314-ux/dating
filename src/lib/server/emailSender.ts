/**
 * 로그인 코드 메일 보내기 (Resend REST API, 라이브러리 없이 fetch).
 *
 * 필요한 환경 변수:
 *   RESEND_API_KEY     Resend에서 만든 키
 *   AUTH_EMAIL_FROM    보내는 주소, 예: "{app} <login@보유도메인>" (Resend에서 도메인 인증 필요)
 * 둘 중 하나라도 없으면 이메일 로그인은 꺼진다(/api/account/config가 email:false).
 *
 * 메일 글은 앱 화면 언어로. 14개 언어 — 글이 짧아 여기 둔다.
 */

/**
 * 로컬 확인용: `AUTH_EMAIL_LOG_ONLY=1`이면 메일을 보내지 않고 서버 로그에 코드를 찍는다.
 * 코드는 서버 로그에만 있으므로 운영에 켜져도 남이 로그인할 수는 없지만, 메일이 안 가니 켜지 않는다.
 */
function logOnly(): boolean {
  return process.env.AUTH_EMAIL_LOG_ONLY?.trim() === "1";
}

export function emailConfigured(): boolean {
  return logOnly() || Boolean(process.env.RESEND_API_KEY?.trim() && process.env.AUTH_EMAIL_FROM?.trim());
}

type Letter = { subject: string; body: string };

/** `{code}`는 6자리 코드, `{minutes}`는 유효 시간. */
const LETTERS: Record<string, Letter> = {
  ko: { subject: "{app} 로그인 코드 {code}", body: "로그인 코드: {code}\n\n{minutes}분 동안 쓸 수 있어요. 직접 요청하지 않았다면 이 메일은 무시하세요." },
  en: { subject: "Your {app} sign-in code: {code}", body: "Your sign-in code: {code}\n\nIt works for {minutes} minutes. If you didn't ask for it, you can ignore this email." },
  es: { subject: "Tu código para entrar en {app}: {code}", body: "Tu código: {code}\n\nSirve durante {minutes} minutos. Si no lo pediste, ignora este correo." },
  ja: { subject: "{app} ログインコード {code}", body: "ログインコード: {code}\n\n{minutes}分間有効です。心当たりがない場合は、このメールを無視してください。" },
  zh: { subject: "{app} 登录验证码 {code}", body: "登录验证码：{code}\n\n{minutes} 分钟内有效。如果不是你本人申请的，请忽略这封邮件。" },
  vi: { subject: "Mã đăng nhập {app}: {code}", body: "Mã đăng nhập: {code}\n\nMã có hiệu lực trong {minutes} phút. Nếu bạn không yêu cầu, hãy bỏ qua email này." },
  fr: { subject: "Votre code de connexion {app} : {code}", body: "Votre code : {code}\n\nIl est valable {minutes} minutes. Si vous ne l’avez pas demandé, ignorez cet e-mail." },
  it: { subject: "Il tuo codice di accesso a {app}: {code}", body: "Il tuo codice: {code}\n\nÈ valido per {minutes} minuti. Se non l’hai richiesto, ignora questa email." },
  pt: { subject: "Seu código de acesso ao {app}: {code}", body: "Seu código: {code}\n\nEle vale por {minutes} minutos. Se você não pediu, ignore este e-mail." },
  ru: { subject: "Код для входа в {app}: {code}", body: "Ваш код: {code}\n\nОн действует {minutes} минут. Если вы его не запрашивали, просто проигнорируйте это письмо." },
  id: { subject: "Kode masuk {app}: {code}", body: "Kode masuk: {code}\n\nBerlaku selama {minutes} menit. Jika kamu tidak memintanya, abaikan email ini." },
  ar: { subject: "رمز الدخول إلى {app}: {code}", body: "رمز الدخول: {code}\n\nصالح لمدة {minutes} دقائق. إذا لم تطلبه، فتجاهل هذه الرسالة." },
  th: { subject: "รหัสเข้าสู่ระบบ {app}: {code}", body: "รหัสเข้าสู่ระบบ: {code}\n\nใช้ได้ภายใน {minutes} นาที หากคุณไม่ได้ขอรหัสนี้ ไม่ต้องสนใจอีเมลนี้" },
  hi: { subject: "{app} साइन-इन कोड: {code}", body: "आपका साइन-इन कोड: {code}\n\nयह {minutes} मिनट तक मान्य है। अगर आपने यह नहीं माँगा था, तो इस ईमेल को अनदेखा करें।" },
};

export function letterFor(locale: string | null | undefined, code: string, minutes: number): Letter {
  const letter = LETTERS[locale ?? ""] ?? LETTERS.en;
  const appName = process.env.APP_NAME?.trim() || "dating-app";
  const fill = (text: string) => text.split("{code}").join(code).split("{minutes}").join(String(minutes)).split("{app}").join(appName);
  return { subject: fill(letter.subject), body: fill(letter.body) };
}

export function supportedLetterLocales(): string[] {
  return Object.keys(LETTERS);
}

export async function sendLoginCode(to: string, code: string, locale: string | null, minutes: number): Promise<boolean> {
  if (logOnly()) {
    console.log(`[account] (log only) code for ${to}: ${code}`);
    return true;
  }
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.AUTH_EMAIL_FROM?.trim();
  if (!key || !from) return false;
  const letter = letterFor(locale, code, minutes);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: letter.subject, text: letter.body }),
      cache: "no-store",
    });
    if (!response.ok) {
      console.error("[account] resend failed", response.status, await response.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (error) {
    console.error("[account] resend failed", error);
    return false;
  }
}
