import { redirect } from 'next/navigation';

/**
 * The web dashboard is statistics-only; the waiting list and the session detail
 * screens live in the native app. `/righthand/doctor` is kept as the entry point --
 * login and the legacy `/dashboard` redirect both land here -- and forwards to the
 * one screen the web still owns.
 */
export default function DoctorHomePage(): never {
  redirect('/righthand/doctor/statistics');
}
