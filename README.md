# dating-app

서로 좋아요를 누르면 대화가 열리는 데이팅 앱입니다. 영어 학습 앱 [english-chat-mvp-android](https://github.com/a20031314-ux/english-chat-mvp-android)의 **커뮤니티 기능(계정·1:1 메시지·차단·신고·성인 본인인증)** 을 그대로 가져와 그 위에 데이팅 기능(프로필·추천·좋아요·매칭)을 얹었습니다.

> 앱 이름은 아직 정하지 않았습니다. 이름을 정하면 `package.json` `name`, `capacitor.config.ts` `appId`·`appName`, `src/app/layout.tsx` 제목, 환경 변수 `APP_NAME`을 바꾸세요. **`appId`는 Play에 한 번 올리면 바꿀 수 없습니다.**

## 할 수 있는 것

| 화면 | 하는 일 |
|---|---|
| 로그인 | 아이디·비밀번호, 이메일 코드, Google (서버에 켠 방식만 보임) |
| 처음 시작 | 닉네임·소개·성별·태어난 해·지역·만나고 싶은 사람(성별·나이·지역) → 사진 1장 이상 |
| 추천 | 서로 조건이 맞는 사람을 한 명씩. 같은 지역 먼저, 그다음 최근 접속 순. ✕ 패스 / ♥ 좋아요 |
| 받은 좋아요 | 나를 좋아요한 사람. ♥를 누르면 바로 매칭 |
| 매칭 | 서로 좋아요하면 그 자리에서 "연결됐어요" → 대화 시작 |
| 대화 | 새 매칭(사진 줄) + 대화 중인 사람(마지막 말·안 읽은 수). 3초마다 새 메시지, 읽음 표시 |
| 대화 메뉴 | 매칭 끊기 · 신고하기(이유 고르기 + 상대 최근 메시지 5줄 첨부 + 자동 차단) · 차단하기 |
| 내 정보 | 본인인증 · 사진 6장까지(대표 사진 바꾸기) · 프로필·조건 고치기 · 추천에 보이기 끄기 · 차단 풀기 · 로그아웃 · 계정 지우기 |

규칙
- **만 19세(연 나이) 미만은 가입 불가** — 태어난 해 기준. 실제 확인은 본인인증이 맡습니다.
- **매칭된 사람끼리만 메시지** — 원본의 "메시지 요청" 단계는 쓰지 않습니다.
- **하루 좋아요 50번**(도배 방지, `DAILY_LIKES`).
- 차단하면 매칭·대화가 끊기고 추천에 다시 나오지 않습니다.
- `ADULT_VERIFY_REQUIRED=1`이면 **본인인증한 사람끼리만** 추천·좋아요가 됩니다. 같은 사람(CI)은 한 계정만.

## 원본에서 가져온 것

원본 커밋 `51fbf4b`(2026-11-06) 기준. "그대로"는 파일을 복사만 했고, "고침"은 학습·결제 연결을 끊은 것입니다.

| 기능 | 이 레포 | 원본 | 상태 |
|---|---|---|---|
| 저장소(Upstash Redis REST, 없으면 메모리) | `lib/server/kv.ts` | 같은 경로 | 그대로 |
| 로그인 토큰 서명 | `lib/server/authToken.ts` | 같은 경로 | 그대로 |
| 계정 저장(아이디·이메일·Google·프로필) | `lib/server/accountStore.ts` | 같은 경로 | 고침 — 계정 삭제 때 지우는 목록을 데이팅용으로 |
| 계정 API 11개 | `app/api/account/**` | 같은 경로 | 고침 — 결제·초대 보상 연결 뺌 |
| 계정 화면 쪽 요청·세션 | `lib/account/client.ts`·`session.ts`·`shared.ts` | 같은 경로 | 고침 — RevenueCat 연결 뺌 |
| 1:1 메시지 저장(30일, 읽음·지우기·숨기기) | `lib/server/dmStore.ts`, `lib/rooms/dm.ts`·`quote.ts` | 같은 경로 | 그대로 |
| 1:1 메시지 API | `app/api/dm/route.ts` | `app/api/dm/route.ts` | 고침 — 매칭된 사람만, 통화·아이콘·방 인용 뺌 |
| 차단·신고 저장 | `lib/server/socialStore.ts` | 같은 경로 | 그대로 |
| 차단·신고 API | `app/api/social/route.ts` | `app/api/social/route.ts` | 고침 — 팔로우·사람 목록·게시판 뺌, 차단 시 매칭 끊기 더함 |
| 성인 본인인증(포트원 V2, CI 한 계정) | `lib/server/identityVerify.ts`·`randomStore.ts`, `lib/verify/client.ts` | `lib/server/…`, `lib/random/client.ts` | 그대로(인증 창은 돌아올 화면만 바꿈) |
| 성인인증 API | `app/api/verify/route.ts` | `app/api/random/route.ts`의 verify | 떼어 옴 |
| 운영자 이용 정지 | `lib/server/banStore.ts`·`suspension.ts` | `lib/server/opsStore.ts`·`suspension.ts` | 정지 부분만 |
| 요청자 확인 | `lib/server/request.ts` | `lib/server/premiumRequest.ts` | 고침 — 구독 판단 뺌 |
| CORS | `lib/server/cors.ts` | 같은 경로 | 고침 — 창구·앱 버전 신호 뺌 |
| 앱(Capacitor) 정적 빌드 | `scripts/build-capacitor.mjs` | 같은 경로 | 고침 — 창구·운영 페이지 처리 뺌 |

원본 테스트도 함께 옮겨 통과를 확인했습니다(`kv`·`account`·`dmStore`·`socialStore`·`presenceStore`·`profileFacts`·`countries`·`dmSeen`).

**가져오지 않은 것:** 학습 기능 전부(채팅 튜터·통화·커리큘럼·영상), 결제(RevenueCat)·포인트·광고, 말하는 방(Room)·단체방·게시판·팔로우, 화면 컴포넌트(`components/rooms/*` — 학습 기능과 얽혀 있어 새로 만들었습니다).

## 새로 만든 것

| 파일 | 하는 일 |
|---|---|
| `lib/dating/rules.ts` | 프로필·조건 모양, 연 나이, 서로 조건 맞추기(`mutualFit`), 추천 순서, 사진 검사 — 앱·서버 공용 |
| `lib/server/datingStore.ts` | 프로필·사진·추천 후보·좋아요·패스·매칭·하루 한도. 매칭 순간 원본 `dmStore.openThreadDirect`로 대화를 엶 |
| `lib/server/datingCards.ts` | 계정 + 데이팅 프로필 → 화면 카드(아이디·이메일·출생 연도 원값은 안 나감) |
| `app/api/dating/route.ts` | 데이팅 API(아래) |
| `app/api/dating/photo/route.ts` | 사진 파일 |
| `components/*` | 화면 전부 |

### 저장하는 것 (KV 키)

| 키 | 내용 | 수명 |
|---|---|---|
| `dating:v1:profile:<계정>` | 성별·태어난 해·지역·조건·사진 목록·보이기 | 계정 삭제까지 |
| `dating:v1:photo:<계정>:<버전>` | 사진(data URL, 최대 16만 자) | 지울 때까지 |
| `dating:v1:active` | 추천 후보(점수 = 마지막 접속) | — |
| `dating:v1:like:<보낸>:<받은>` | 좋아요 | 90일 |
| `dating:v1:seen:<계정>` | 좋아요·패스한 사람(추천에서 뺌) | — |
| `dating:v1:likedby:<계정>` | 받은 좋아요 | — |
| `dating:v1:matches:<계정>` | 매칭 | — |
| `dating:v1:likes:<계정>:<날짜>` | 그날 보낸 좋아요 수 | 2일 |

원본 키(`account:v1:*`, `dm:*`, `social:v1:*`, `random:v1:*`, `ops:v1:ban:*`)는 원본과 같은 모양입니다. 계정을 지우면 `accountStore.deleteAccount`가 위 데이팅 키·성인인증·정지 기록까지 함께 지웁니다.

### API

모두 `POST {action, ...}`, 헤더 `x-auth-token`(로그인 토큰).

| 경로 | action |
|---|---|
| `/api/dating` | `me` · `save` · `photoAdd` · `photoRemove` · `photoOrder` · `discover` · `like` · `pass` · `likedMe` · `matches` · `unmatch` |
| `/api/dm` | `inbox` · `open` · `poll` · `send` · `unsend` · `hide` |
| `/api/social` | `blocked` · `block` · `unblock` · `report` |
| `/api/verify` | `status` · `verify` |
| `/api/account/*` | 원본과 같음 |
| `GET /api/dating/photo?u=<계정>&v=<버전>` | 사진 파일 |

자세한 요청·응답은 각 `route.ts` 머리 주석에 있습니다.

## 실행

```bash
npm install
cp .env.example .env.local   # 개발이면 비워 둬도 됨(메모리 저장, 아이디·비밀번호 로그인)
npm run dev                  # http://localhost:3000
```

```bash
npm test          # 단위 테스트 56개 (원본 46 + 데이팅 10)
npm run typecheck
npm run lint
npm run build     # 웹·API (Vercel이 쓰는 빌드)
```

개발 서버는 KV 없이 메모리에 저장하므로 재시작하면 데이터가 사라집니다. 추천 화면을 보려면 계정이 둘 이상(서로 조건이 맞게) 있어야 합니다.

## 배포 (Vercel)

1. Vercel에서 이 레포를 가져옵니다(빌드 명령 `npm run build` 그대로).
2. Upstash Redis를 연결합니다(Vercel Marketplace → Upstash → `KV_REST_API_URL`·`KV_REST_API_TOKEN`이 자동으로 들어감).
3. 환경 변수를 넣습니다.

| 변수 | 필요 | 설명 |
|---|---|---|
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | 필수 | 저장소 |
| `AUTH_SECRET` | 권장 | 로그인 토큰 서명 키(긴 임의 문자열). 없으면 KV 토큰에서 만듦 |
| `ALLOWED_ORIGINS` | 웹 도메인 쓸 때 | CORS 허용 주소, 쉼표로 여러 개 |
| `GOOGLE_WEB_CLIENT_ID` | Google 로그인 쓸 때 | 쉼표로 여러 개 |
| `RESEND_API_KEY` / `AUTH_EMAIL_FROM` | 이메일 로그인 쓸 때 | `AUTH_EMAIL_LOG_ONLY=1`이면 메일 대신 서버 로그 |
| `APP_NAME` | 선택 | 로그인 메일 제목의 앱 이름 |
| `ADULT_VERIFY_REQUIRED` | 출시 때 `1` | 본인인증한 사람끼리만 |
| `PORTONE_API_SECRET` | 본인인증 | 서버에만 |
| `NEXT_PUBLIC_PORTONE_STORE_ID` / `NEXT_PUBLIC_PORTONE_IDV_CHANNEL_KEY` | 본인인증 | 앱에 들어가는 공개 값 |
| `NEXT_PUBLIC_API_BASE` | 앱 빌드 | 앱이 부를 서버 주소, 예: `https://dating-app.vercel.app` |

## 안드로이드 앱

원본과 같은 방식입니다(Next 정적 내보내기 → Capacitor).

```bash
npx cap add android        # 처음 한 번 — android/ 폴더가 생김
npm run build:android      # API 폴더를 잠시 빼고 정적 빌드 → www/ → cap sync
npx cap open android       # Android Studio에서 서명·번들
```

`build:capacitor`가 도는 동안에는 `src/app/api`가 잠시 옆으로 옮겨집니다 — **빌드 중에 커밋하지 마세요**(원본에서 API가 통째로 지워진 채 올라간 적이 있음).

## 출시 전 확인

- [ ] 앱 이름·`appId` 정하기(첫 업로드 뒤에는 못 바꿈)
- [ ] 포트원 본인인증 계약 → 키 넣고 `ADULT_VERIFY_REQUIRED=1`
- [ ] 청소년 유해매체물 표시·연령 등급(데이팅 앱은 성인 인증 필요) 확인
- [ ] 개인정보 처리방침·이용약관 페이지(사진·메시지 30일·신고 기록 90일·계정 삭제 시 지우는 것)
- [ ] 운영자 신고함 — 지금은 신고가 `social:v1:reports`에 쌓이기만 함. 원본 `/ops` 페이지를 옮겨 오거나 새로 만들기
- [ ] 정지 기능 화면 연결(`banStore.setBan`은 있음, 누를 곳이 없음)
- [ ] 사진 검수(원본은 OpenAI moderation을 썼음 — `api/media` 참고)
- [ ] 개인정보: 사진 주소는 계정 id·사진 버전을 알아야 열리지만 로그인 없이 열림. 공개 전 서명된 주소로 바꾸기 검토
- [ ] Play 데이터 보안 신고(사진·메시지·생년)

## 로드맵

1. **운영자 화면** — 신고 보기·정지·풀기(원본 `/ops` 이식)
2. **사진을 Blob/CDN으로** — 지금은 KV에 data URL. 원본 `mediaStore`(Vercel Blob)로 옮기면 KV 용량이 줄고 빨라짐
3. **추천 색인 나누기** — 지금은 최근 접속 400명을 훑음. 사람이 늘면 지역·성별별 정렬 집합으로
4. **랜덤 대화** — 원본 `randomStore.joinOrPoll`(성인인증한 사람끼리 짝 맞추기)이 이미 들어 있음. 화면·API만 붙이면 됨
5. **메시지에 사진** — `dmStore`는 사진을 받을 수 있음(`image`), 업로드 경로만 필요
6. **영상 통화** — 원본 WebRTC 메시(`lib/rooms/mesh.ts`) + Cloudflare TURN
7. **유료 기능** — 받은 좋아요 보기·좋아요 더 보내기 등. 원본 RevenueCat 연결(`premiumRequest.resolveRequestEntitlement`)을 다시 가져오면 됨

## 폴더

```
src/
  app/
    page.tsx, layout.tsx, globals.css   화면 틀·색 토큰
    api/account/**                      계정 (원본)
    api/dating/                         데이팅 (새로)
    api/dm/  api/social/  api/verify/   메시지·차단신고·본인인증 (원본 고침)
  components/                           화면 (새로)
  lib/
    dating/                             데이팅 규칙·앱 요청 (새로)
    server/                             저장소·서버 공용 (대부분 원본)
    account/  rooms/  random/  verify/  원본 모듈
scripts/build-capacitor.mjs             앱 정적 빌드
```
