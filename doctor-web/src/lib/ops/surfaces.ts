/**
 * 감시 대상 표면 목록. SERVER ONLY.
 *
 * 목록이 코드에 있는 이유: 표면이 하나 늘었는데 감시에 안 붙는 상황은 조용히
 * 일어나고 조용히 유지된다. DB 테이블로 두면 "추가하는 것을 잊는" 실패가 배포
 * 리뷰에 걸리지 않는다. 여기 있으면 새 표면을 만든 커밋이 이 파일을 건드린다.
 *
 * URL 은 전부 환경변수로 덮어쓸 수 있지만 **기본값이 실제 운영 주소**다.
 * 기본값을 비워 두면 미설정 시 조용히 빈 목록을 감시하게 되고, 그건 "전부
 * 정상"으로 보인다.
 */

export type SurfaceKind = 'web' | 'edge';

export interface Surface {
  /** `ops_probe_runs.details[].surface` 와 알림 키에 쓰인다. 안정적이어야 한다. */
  name: string;
  kind: SurfaceKind;
  url: string;
  /**
   * true 면 이 표면이 죽었을 때 실행 전체가 `down` 이 된다.
   * false 면 `degraded` 에 그친다.
   */
  critical: boolean;
  /** 이 표면이 죽으면 사람에게 어떤 일이 일어나는가. 알림 본문에 들어간다. */
  impact: string;
}

function supabaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
}

function origin(): string {
  // 자기 자신을 **공개 도메인으로** 친다. VERCEL_URL(배포별 주소)로 치면 DNS,
  // TLS, 도메인 별칭, 그리고 kiosk 재작성 규칙이 전부 감시 범위 밖으로 나간다 --
  // 실제 환자와 의사가 지나는 경로는 이쪽이다.
  return (process.env.OPS_PROBE_ORIGIN ?? 'https://entanglecare.com').replace(/\/+$/, '');
}

export function surfaces(): Surface[] {
  const sb = supabaseUrl();
  const o = origin();
  const list: Surface[] = [
    {
      name: 'doctor-web',
      kind: 'web',
      url: `${o}/api/health`,
      critical: true,
      impact: '의사가 통계 화면에 로그인하거나 데이터를 볼 수 없다.',
    },
    {
      name: 'kiosk',
      kind: 'web',
      // entanglecare.com 경유. doctor-web 의 rewrite(next.config.ts)를 지나므로
      // 키오스크 자체뿐 아니라 그 재작성 규칙까지 확인된다. 키오스크 고유
      // 주소로 직접 치면 재작성이 깨진 날 "키오스크 정상"이 보고된다.
      url: `${o}/righthand/patient/api/health`,
      critical: true,
      impact: '대기실 태블릿에서 환자가 문진을 시작할 수 없다.',
    },
    {
      name: 'admin-web',
      kind: 'web',
      // 키오스크와 같은 이유로 **브랜드 도메인 경유**로 친다. admin-web 은
      // doctor-web 의 rewrite(next.config.ts) 뒤에 있으므로, 자기 Vercel 주소로
      // 직접 치면 재작성이 깨진 날에도 "결제 정상"이 보고된다 -- 그날 의사는
      // 결제 페이지에 도달조차 못 한다.
      url: `${o}/righthand/api/health`,
      critical: true,
      impact:
        '체험이 끝난 의사가 결제할 수 없다. 결제가 막히면 자격이 만료되고 앱 전체가 잠긴다. ' +
        '이 표면의 헬스체크는 결제 주기 감시 크론(watchdog)의 생사도 함께 싣는다.',
    },
  ];

  if (sb) {
    const edge: [string, boolean, string][] = [
      [
        'entitlement',
        true,
        '앱이 구독 자격을 갱신하지 못한다. 72시간 오프라인 유예가 끝나면 유료 사용자 전원이 잠긴다.',
      ],
      ['device', false, '새 기기 등록과 원격 해지가 되지 않는다. 기존 기기는 계속 동작한다.'],
      ['ai-gemini', true, '분석·요약·구술이 전부 멈춘다.'],
      ['ai-realtime', true, '실시간 전사가 멈춘다.'],
    ];
    for (const [fn, critical, impact] of edge) {
      list.push({
        name: `edge:${fn}`,
        kind: 'edge',
        url: `${sb}/functions/v1/${fn}?health=1`,
        critical,
        impact,
      });
    }
  }

  return list;
}
