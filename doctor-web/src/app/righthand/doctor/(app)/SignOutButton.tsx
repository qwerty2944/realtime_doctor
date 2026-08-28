'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogOut } from 'lucide-react';

import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const handleSignOut = async () => {
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signOut();
      if (error) {
        // Surfaced rather than ignored: a doctor who believes they signed out on a
        // shared consulting-room PC and did not is a real exposure.
        console.error('[dashboard] Sign-out failed.', error);
        window.alert('로그아웃에 실패했습니다. 브라우저를 닫아 주세요.');
        return;
      }
      router.replace('/righthand/doctor/login');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={busy}
      className="flex items-center gap-1 rounded-lg border border-line-strong px-3 py-1.5 t7 text-content-secondary transition-colors hover:bg-surface-canvas disabled:opacity-50"
    >
      <LogOut aria-hidden="true" className="size-3.5" />
      로그아웃
    </button>
  );
}
