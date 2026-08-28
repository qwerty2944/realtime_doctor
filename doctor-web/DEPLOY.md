# doctor-web 배포 안내 (Vercel)

의사용 통계 대시보드(`/righthand/doctor/*`)를 Vercel에 올리는 절차와, Vercel 프로젝트에
등록해야 하는 환경변수 전체 목록입니다.

핵심 사실 정리:

- 프레임워크: Next.js 16 (`doctor-web/`, 모노레포 안의 독립 npm 프로젝트)
- 화면 범위: **의사용 통계 화면 하나뿐**입니다. 환자 문진은 `kiosk/`, 진료 중 녹음·분석은
  `src/`의 Electron 앱이 담당합니다. 이 배포에는 둘 다 들어 있지 않습니다.
- DB/인증: Supabase 프로젝트 **`yhwvwojjwwlcrvpfxgag`** (`realtime-doctor`,
  ap-northeast-2 서울) — **네이티브 앱의 실 운영 DB**입니다. 통계 함수는
  `supabase/migrations/0014_web_statistics.sql`이 추가했고 **이미 적용돼 있습니다.**
- 웹이 예전에 쓰던 자체 Supabase 프로젝트 `iqrkfqtifjanseoknkpq`는 **삭제됐습니다.** 이
  프로젝트 id가 어딘가 남아 있다면 그건 낡은 기록입니다.
- 서버리스 리전: `icn1`(서울) — `vercel.json`에 고정. Supabase가 서울이라 매 쿼리마다
  태평양을 왕복하지 않도록 가장 가까운 리전으로 맞췄습니다.
- Vercel CLI 위치: `/Users/seungwoolee/.hermes/node/bin/vercel` (PATH에 없음)
- Vercel 프로젝트의 **Root Directory는 `doctor-web`** 이어야 합니다 (`admin-web`,
  `kiosk`와 같은 방식).

> 이 대시보드가 보여 주는 임상 내용(감별진단 분포 등)은 AI가 만든 초안에서 집계한
> 값이며 진단이 아닙니다. 다만 통계 화면 자체는 환자 식별정보를 담지 않습니다 —
> `f_web_stats_*` 함수 어느 것도 환자 이름·생년월일·등록번호·전화번호·환자 id·진료 id를
> 반환하지 않습니다.

---

## 0. 배포 한 줄 요약

`vercel login`을 먼저 끝낸 뒤, 아래 한 줄이면 됩니다. `deploy.sh`가 환경변수 등록부터
`vercel --prod`까지 전부 처리합니다.

```bash
/Users/seungwoolee/.hermes/node/bin/vercel login   # 최초 1회, 대화형
cd ~/Desktop/project/realtime_doctor/doctor-web
./deploy.sh
```

`deploy.sh`는 재실행해도 안전합니다(이미 등록된 변수는 건드리지 않음). 로그인이 안 되어
있으면 멈춰서 기다리지 않고 20초 안에 분명한 에러로 종료합니다.

배포가 끝나면 스크립트가 출력하는 URL과, 마지막에 안내되는 **Supabase Site URL 설정
(3번 항목)** 을 반드시 처리하세요. 이걸 빼면 의사 로그인이 실패할 수 있습니다.

---

## 1. 환경변수 전체 목록

세 개가 전부이고, 셋 다 필수입니다. 값은 모두 `doctor-web/.env.local`에서 읽습니다.

| 변수 | 용도 | 비밀 | 값 출처 |
|---|---|:---:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 브라우저·서버 공용 Supabase 주소 | 아니오(공개) | `doctor-web/.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 브라우저용 anon 키 (RLS 적용) | 아니오(공개) | `doctor-web/.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용. RLS 우회 — CSV 내보내기 감사 로그 1건 쓰기 | **예** | `doctor-web/.env.local` |

목록이 맞는지 의심되면 코드에 직접 물어보세요:

```bash
grep -rn "requireEnv\|process.env" doctor-web/src/
```

### 사라진 변수들

예전 배포에는 `LLM_PROVIDER`, `GEMINI_API_KEY`, `INTAKE_TOKEN_SECRET`, `STT_PROVIDER`,
`CLOVA_SPEECH_INVOKE_URL`, `CLOVA_SPEECH_SECRET`, `PUBMED_CONTACT_EMAIL`, `APP_ORIGIN`,
`PUBDATA_*`가 등록돼 있었습니다. **그 값을 읽던 코드가 이 앱에 더 이상 없습니다.** 새로
등록할 필요가 없고, Vercel 프로젝트에 남아 있다면 손으로 지워도 됩니다.

`INTAKE_TOKEN_SECRET`이 사라지면서 예전 문서가 안고 있던 문제 하나도 함께 사라졌습니다:
그 문서는 데모용 시크릿 값을 본문에 그대로 적어 두고 있었습니다. 이 앱은 그 키를 쓰지
않으므로 여기에는 어떤 비밀값도 적혀 있지 않습니다. **앞으로도 적지 마세요** — 비밀은
`.env.local`에 두고 `deploy.sh`가 stdin으로 넘깁니다.

### `vercel env add` 수동 명령 (참고용)

```bash
V=/Users/seungwoolee/.hermes/node/bin/vercel
cd ~/Desktop/project/realtime_doctor/doctor-web

# .env.local 에서 값을 복사해서 붙여넣으세요.
$V env add NEXT_PUBLIC_SUPABASE_URL      production
$V env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
$V env add SUPABASE_SERVICE_ROLE_KEY     production   # 비밀
```

---

## 2. 배포 절차 상세

1. **로그인** (최초 1회, 대화형):
   ```bash
   /Users/seungwoolee/.hermes/node/bin/vercel login
   ```
2. **배포**:
   ```bash
   cd ~/Desktop/project/realtime_doctor/doctor-web
   ./deploy.sh
   ```
   - 처음 실행하면 `vercel link`로 프로젝트를 생성/연결합니다(비대화형). 연결 후 Vercel
     대시보드에서 **Root Directory를 `doctor-web`으로** 설정했는지 확인하세요.
   - 누락된 환경변수만 등록하고, 이미 있는 값은 건드리지 않습니다.
   - `doctor-web/`에서 `vercel --prod`를 실행하고, 끝나면 URL을 출력합니다.
3. **재배포**: 코드만 바꿨다면 `./deploy.sh`를 다시 실행하면 됩니다.
4. **키 교체 후**: `./deploy.sh --force-env` (등록된 변수를 지우고 다시 등록).
5. **환경변수만 동기화**(배포 없이): `./deploy.sh --env-only`.

배포 전 로컬 검증:

```bash
cd ~/Desktop/project/realtime_doctor/doctor-web
npm install
npx tsc --noEmit && npm run build && npx eslint . && npm test
```

---

## 3. Supabase 운영 설정 (배포 후 필수 1가지)

의사 로그인은 Supabase Auth를 씁니다. **Site URL을 서비스 도메인으로 설정**해야 인증
리다이렉트가 올바르게 동작합니다. 배포마다 새로 생기는 `*.vercel.app` 주소가 아니라
고정 도메인을 넣어야 합니다. `deploy.sh`가 끝날 때 같은 값을 다시 안내합니다.

- 설정 위치:
  `https://supabase.com/dashboard/project/yhwvwojjwwlcrvpfxgag/auth/url-configuration`
- **Site URL**: `https://entanglecare.com`
- **Redirect URLs**: 이 앱은 비밀번호 로그인만 쓰고 이메일 매직링크·OAuth 콜백을 쓰지
  않으므로, 별도 추가는 없어도 됩니다. 다만 나중에 비밀번호 재설정 메일 등을 켠다면 위
  화면의 Redirect URLs에 `https://entanglecare.com/**`를 추가해야 합니다.

> **주의**: 이 Supabase 프로젝트는 네이티브 앱·키오스크·관리자 웹이 함께 쓰는 실 운영
> DB입니다. Site URL은 프로젝트 전역 설정이므로 다른 표면의 인증 흐름에도 영향을 줍니다.
> 바꾸기 전에 그 표면들을 확인하세요.

### 계정 / 권한

- 로그인 계정은 Supabase Auth 사용자이고, 대시보드는 `public.profiles` 행을 읽습니다.
  이 행은 DB의 가입 트리거(`handle_new_user_profile`)가 만듭니다 — 웹은 아무것도 만들지
  않고, 행이 없으면 조용히 넘어가지 않고 에러를 냅니다.
- 통계 숫자는 **로그인한 의사 본인의 것만** 보입니다. `f_web_stats_*` 함수는
  `SECURITY DEFINER`라 RLS가 적용되지 않고, 함수 안에 쓰인 `e.user_id = auth.uid()`
  술어 하나가 다른 의사의 숫자를 막는 유일한 장치입니다. 이 조건을 지우면 클리닉 전체
  집계가 모든 로그인 사용자에게 열립니다.
- `profiles.is_admin`을 읽긴 하지만, 이 대시보드에는 아직 관리자 전용 화면이 없습니다.

### CORS / 허용 오리진

추가 설정 불필요합니다. 브라우저는 anon 키로 같은 Supabase 프로젝트에 직접 붙고, Supabase는
기본적으로 anon 키 요청의 오리진을 제한하지 않습니다. 서비스롤 키를 쓰는 유일한 쓰기(CSV
내보내기 감사 로그)는 서버 라우트 핸들러에서만 일어나므로 브라우저 CORS와 무관합니다.

---

## 4. 마이그레이션

`supabase/migrations/0014_web_statistics.sql`은 **이미 프로덕션에 적용돼 있습니다.**
배포 과정에서 다시 실행할 필요가 없습니다. 배경과 주의사항(특히 `0013`을 다시 돌릴 때의
상호작용)은 `supabase/migrations/README-0014-web-statistics.md`를 보세요.
