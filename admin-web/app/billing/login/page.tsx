import { LoginForm } from '@/components/login-form';

/**
 * 의사 진입점. 브랜드 도메인에서
 * `https://entanglecare.com/righthand/billing/login` 으로 도달한다.
 *
 * 이 경로가 `/login` 이 아니라 `/billing/login` 인 이유는
 * components/login-form.tsx 의 주석에 있다 (재작성 규칙을 접두사 하나로 유지).
 *
 * '← 메인' 을 렌더링하지 않는 이유: 여기서 '/' 는 이 앱의 랜딩이고, 브랜드
 * 도메인에서 그 경로는 재작성 대상이 아니라 doctor-web 으로 간다. 도착지가
 * 호스트에 따라 달라지는 링크는 두 곳 중 한 곳에서 반드시 틀린다.
 */
export default function BillingLoginPage() {
  return <LoginForm defaultNext="/billing" showSignup={false} homeHref={null} />;
}
