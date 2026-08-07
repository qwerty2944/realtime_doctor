import { LoginForm } from '@/components/login-form';

/**
 * 운영자 진입점. 이 경로는 브랜드 도메인에서 재작성되지 않으므로 관리 화면
 * 호스트(이 프로젝트의 Vercel 주소)에서만 도달한다.
 */
export default function LoginPage() {
  return <LoginForm defaultNext="/admin" showSignup homeHref="/" />;
}
