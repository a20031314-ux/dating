/** 사진 파일 경로(서버 기준). 앱은 apiUrl()을 앞에 붙여 쓴다(lib/dating/client.ts photoUrl). */
export function photoPath(accountId: string, version: string): string {
  return `/api/dating/photo?u=${accountId}&v=${version}`;
}
