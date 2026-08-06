/**
 * Auth gate for /righthand/doctor/*.
 *
 * Next.js 16 renamed the `middleware` file convention to `proxy`; the function is
 * exported as `proxy` and runs on the Node.js runtime (the `runtime` segment option
 * is rejected in this file). See node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/proxy.md.
 *
 * Two jobs:
 *   1. Refresh the Supabase auth cookies on every dashboard navigation, so a doctor
 *      is not signed out mid-consultation when the access token expires.
 *   2. Redirect unauthenticated navigation to the login screen.
 *
 * This is an optimistic gate for navigation only. It is NOT the authorization
 * boundary: every page and route handler re-checks the session through
 * `requireDoctor` / `requireDoctorForApi`.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { requireEnv } from '@/lib/env';

const LOGIN_PATH = '/righthand/doctor/login';
const DASHBOARD_PATH = '/righthand/doctor';

export async function proxy(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Refreshed tokens must reach both the downstream render (via the request
          // cookies) and the browser (via the response cookies), so both are set.
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && pathname !== LOGIN_PATH) {
    const target = request.nextUrl.clone();
    target.pathname = LOGIN_PATH;
    target.search = '';
    // Preserve where the doctor was heading so login can return them there.
    target.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(target);
  }

  if (user && pathname === LOGIN_PATH) {
    const target = request.nextUrl.clone();
    target.pathname = DASHBOARD_PATH;
    target.search = '';
    return NextResponse.redirect(target);
  }

  return response;
}

export const config = {
  // Patient-facing /righthand/patient/* is deliberately outside the gate: patients are not
  // authenticated and reach the database only through server-side API routes.
  matcher: ['/righthand/doctor/:path*'],
};
