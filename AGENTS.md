# 작업 지침

- 답·커밋 메시지·주석은 한국어로.
- Next.js 16 — 예전 버전과 규칙이 다를 수 있다. 코드를 쓰기 전에 `node_modules/next/dist/docs/`의 해당 문서를 읽는다.
- 프로젝트 설명·구조·원본 대응표는 `README.md`. 기능·저장 키·API가 바뀌면 같은 커밋에서 README를 고친다.
- `lib/server/`·`lib/account/`·`lib/rooms/`의 원본 파일은 원본(english-chat-mvp-android)과 맞춰 둔다 — 고칠 때는 README "원본에서 가져온 것" 표의 상태를 바꾼다.
- 색·글꼴은 `src/app/globals.css` 토큰(`night`·`surface`·`line`·`ink`·`muted`·`marigold`·`rose`)만 쓴다. 장미색은 하트·매칭에만.
- 화면 안에 기능 설명 글을 넣지 않는다(상태·오류·버튼 이름만). 하단 탭은 아이콘만, 이름은 aria-label.
- 커밋 전: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- `npm run build:capacitor`가 도는 동안 커밋하지 않는다(API 폴더가 잠시 옮겨짐).
