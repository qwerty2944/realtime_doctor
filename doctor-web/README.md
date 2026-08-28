# doctor-web

의사용 통계 대시보드. Next.js 16, 이 모노레포 안의 **독립 npm 프로젝트**입니다
(`admin-web/`, `kiosk/`와 같은 방식 — 루트 Electron 프로젝트와 의존성을 공유하지 않고
자체 `node_modules`를 씁니다).

`righthand_voice` 저장소에서 옮겨 왔습니다. 옮기기 전에 환자 문진·진료 중 분석 등 다른
화면들이 제거되어, 지금 이 앱의 표면은 하나입니다.

## 화면

| 경로 | 내용 |
|---|---|
| `/` | 회사 홈 |
| `/righthand` | 제품 소개 |
| `/righthand/doctor/login` | 의료진 로그인 |
| `/righthand/doctor` | 로그인 후 진입점 |
| `/righthand/doctor/statistics` | 통계 |
| `/api/dashboard/statistics` | 통계 조회 (GET) |
| `/api/dashboard/statistics/export` | CSV 내보내기 감사 기록 (POST) |

`/righthand/patient`는 **의도적으로 404입니다.** 환자 문진은 `kiosk/`로 옮겼고 아직
배포되지 않았습니다. `next.config.ts`의 `/intake → /righthand/patient` 리다이렉트는 예전
QR·링크를 위해 남아 있으며, 키오스크가 배포되면 그쪽을 가리키도록 바꿔야 합니다.

## 개발

```bash
npm install
npm run dev            # http://localhost:3000
```

`.env.example`를 `.env.local`로 복사해 값을 채우세요. 필요한 변수는 세 개뿐이고 셋 다
필수입니다.

## 검증

```bash
npx tsc --noEmit
npm run build
npx eslint .
npm test               # vitest, src/**/*.test.ts
```

## 데이터

이 앱은 네이티브 앱의 실 운영 Supabase 프로젝트 `yhwvwojjwwlcrvpfxgag`를 **읽기 위주로**
씁니다. 집계는 전부 DB 쪽 `f_web_stats_*` 함수가 하고
(`supabase/migrations/0014_web_statistics.sql`), JS에서 다시 집계하는 코드는 없습니다.
쓰기는 CSV 내보내기 감사 기록 한 줄이 전부입니다.

이 앱은 `encounters` / `intake_results` / `patients` / `profiles`의 JSON 형태를 TypeScript로
다시 정의하지 않습니다. 그 형태의 단일 소유자는 `kiosk/lib/intake/schemas.ts`(쓰는 쪽)와
`src/shared/types.ts`(Electron이 읽는 쪽)이고, 웹은 이미 집계된 스칼라만 받습니다. 나중에
이 앱이 행 단위 데이터를 직접 읽게 된다면, 여기서 자체 타입을 만들지 말고 그 두 곳 중
하나에서 가져오세요 — 형태가 저장소마다 갈라졌던 것이 이 병합의 이유였습니다.

## 배포

`DEPLOY.md`를 보세요. 파트너에게 건네는 사용 안내는 `PARTNER-GUIDE.md`입니다.
