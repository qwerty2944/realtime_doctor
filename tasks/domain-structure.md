# entanglecare.com 구조 설계

조사 시점: 2026-08-06. **다른 세션이 `righthand_voice` 에서 동시 작업 중** — 이 문서는 읽기만
해서 작성했다.

## 관측된 현재 상태

| 항목 | 상태 |
|---|---|
| `entanglecare.com` DNS | Cloudflare 네임서버, 루트는 프록시 OFF → Vercel IP 직결 |
| 루트를 서빙하는 것 | Vercel 프로젝트 `app` = `righthand_voice/app` |
| 루트 페이지 | 회사 홈페이지(C안) 이식 완료, **미배포** (커밋 15ad5c0) |
| `/righthand/doctor/*` | 라우트 존재 (login, (app), statistics) |
| `/righthand/patient` | **라우트 없음.** `next.config.ts` 가 리다이렉트로 보내지만 받는 페이지가 없어 404 |
| righthand 앱의 Supabase | `iqrkfqtifjanseoknkpq` — **이 프로젝트는 삭제됐다.** 연결 불가 |
| realtime_doctor 의 Supabase | `yhwvwojjwwlcrvpfxgag` — 살아 있고 0000~0013 적용 완료 |
| realtime_doctor/kiosk | 완성돼 있으나 **미배포** |

### [HARD] 즉시 확인이 필요한 두 가지

1. **entanglecare.com 의 DB 의존 기능은 지금 전부 죽어 있다.** 홈페이지는 정적이라 뜨지만
   의사 로그인·대시보드·통계는 존재하지 않는 프로젝트를 호출한다.
2. **문진 구현이 두 벌이 되려 하고 있다.** `realtime_doctor/kiosk` 에 방문 코드·AI 고지·
   근거 기반 출력까지 갖춘 것이 이미 있는데, 다른 세션이 `righthand_voice` 에 접근코드
   방식을 새로 만들고 있다.

---

## 진짜 질문은 URL 이 아니라 **DB 가 몇 개인가** 이다

의사 데스크톱 앱의 대기목록은 문진 결과가 채운다. 웹 문진이 데스크톱이 읽는 것과 다른 DB 에
쓰면 **대기목록은 영원히 비어 있다.** 이건 가정이 아니라 이미 한 번 겪은 실패다(키오스크
미배포 상태에서 정확히 이 증상이었다).

그러므로 URL 배치보다 먼저 정해야 하는 것은 단일 진실 공급원이다.

---

## 권장 구조

**DB 하나(`yhwvwojjwwlcrvpfxgag`), 문진 하나(`realtime_doctor/kiosk`).**

```
entanglecare.com/                    회사 홈페이지        righthand_voice/app
entanglecare.com/righthand/patient   문진 키오스크        realtime_doctor/kiosk (별도 Vercel 프로젝트)
entanglecare.com/righthand/doctor    의사 웹              righthand_voice/app  (DB 를 새 프로젝트로 이전)
데스크톱 앱                           진료 중 오버레이     realtime_doctor      (같은 DB)
```

### 라우팅 방법

`righthand_voice/app` 이 도메인과 `/righthand` 네임스페이스를 이미 소유하고 있으므로,
그 앱의 `next.config.ts` 에 **rewrite** 를 하나 넣어 `/righthand/patient/*` 를 키오스크
배포로 넘기는 것이 가장 마찰이 적다. 그 파일은 다른 세션이 이미 편집 중이라 새 파일을
건드리지 않는다.

Cloudflare 프록시로 경로를 가르는 방법도 되지만(루트 프록시 ON + Worker), 홉이 하나 늘고
Vercel 앞단 설정을 조정해야 한다. rewrite 로 충분하면 그쪽이 낫다.

키오스크는 이미 `NEXT_PUBLIC_BASE_PATH` 로 하위 경로 배포를 지원한다(L1 에서 추가).

### 왜 문진을 realtime_doctor 쪽 것으로 쓰는가

righthand 쪽에서 새로 만드는 대신 이미 있는 것을 쓰는 이유:

- 방문 코드 접근 통제가 **이미 실기 검증까지 끝났다.** 공개 주소에서 아무나 진료 행을 만드는
  문제, PUBLIC EXECUTE 로 anon 이 코드 소모 함수를 직접 부를 수 있던 문제, 레이트리밋이
  서비스 거부 지렛대였던 문제가 전부 잡혀 있다. 새로 만들면 그 셋을 다시 만난다.
- AI 고지 문구가 이미 있다("AI 가 위험하다고 알려줄 때까지 기다리지 마십시오").
- 산출 JSON 이 데스크톱 앱의 파서와 **정확히 맞춰져 있다** (`name_en`, `follow_up_questions`,
  `medical_terms`). 다른 구현이 쓰면 창들이 다시 빈 상태가 된다.
- 살아 있는 DB 를 본다.

---

## 확정된 역할 분담 (사용자 결정, 2026-08-06)

> **앱은 환자 개인의 진료 데이터, 웹은 여러 환자를 묶어 보는 전체 통계.**
> DB 는 `yhwvwojjwwlcrvpfxgag` 하나로 통합한다 (이것이 righthand DB 다).

| | 데스크톱 앱 | 의사 웹 (`/righthand/doctor`) |
|---|---|---|
| 단위 | 환자 1명 | 여러 환자 집계 |
| 내용 | 대기목록, 문진 열람, 감별진단, 근거, 진료 중 오버레이 | 환자 통계, 추세, 진료량 |
| 겹침 | 없음 — 웹은 앱이 안 보여주는 것만 |

이 분담의 좋은 점: 두 표면이 같은 화면을 두 번 만들지 않는다. 그리고 통계는 브라우저에서
보는 것이 자연스럽고(넓은 화면, 인쇄·공유), 진료 중 오버레이는 데스크톱이어야 한다.

## 남는 결정
2. **다른 세션에 알릴 것.** 접근코드를 새로 만들고 있다면 중복이다.
3. **web_statistics 마이그레이션의 대상 DB.** 삭제된 프로젝트를 향하고 있지 않은지 확인.

---

## 순서

1. 위 결정 1·2 확정
2. righthand 앱의 Supabase 접속 대상을 살아 있는 프로젝트로 교체 (지금 죽어 있는 것을 먼저 살린다)
3. 키오스크를 별도 Vercel 프로젝트로 배포 (`NEXT_PUBLIC_BASE_PATH=/righthand/patient`)
4. righthand 앱에 rewrite 추가 → 배포
5. `BILLING_PORTAL_URL` 확정 후 데스크톱 앱 재빌드
