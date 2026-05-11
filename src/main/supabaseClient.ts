import './wsPolyfill.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { store } from './store.js';

// Build-time fallbacks. legacy anon JWT는 Auth API와 호환됨
// (modern publishable key는 PostgREST/Realtime만 지원하고 auth.signIn 등에서 "Invalid API key"로 거부됨).
// RLS가 꺼져 있어 누구든 row에 접근 가능 — 사용자 결정대로 빠른 개발 단계 유지.
const FALLBACK_SUPABASE_URL = 'https://yqdzxitlmtawznzwpkra.supabase.co';
const FALLBACK_SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxZHp4aXRsbXRhd3puendwa3JhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MDcwNTMsImV4cCI6MjA5NDA4MzA1M30.lORYz6ejjy-NkI0___JinbyGRYpumBr8LbHoYMQzvkM';

const AUTH_STORAGE_KEY_PREFIX = 'sbAuth';

interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const electronStoreAdapter: StorageAdapter = {
  getItem(key) {
    const bag = (store.get('sbAuth') ?? {}) as Record<string, unknown>;
    const value = bag[key];
    return typeof value === 'string' ? value : null;
  },
  setItem(key, value) {
    const bag = { ...((store.get('sbAuth') ?? {}) as Record<string, unknown>) };
    bag[key] = value;
    store.set('sbAuth', bag);
  },
  removeItem(key) {
    const bag = { ...((store.get('sbAuth') ?? {}) as Record<string, unknown>) };
    delete bag[key];
    store.set('sbAuth', bag);
  }
};

void AUTH_STORAGE_KEY_PREFIX;

let cached: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.SUPABASE_URL ?? FALLBACK_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? FALLBACK_SUPABASE_KEY;
  if (!url || !key) {
    console.warn('[db] URL or KEY missing — auth disabled');
    cached = null;
    return cached;
  }
  cached = createClient(url, key, {
    auth: {
      storage: electronStoreAdapter,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'implicit'
    }
  });
  return cached;
}

export function isSupabaseConfigured(): boolean {
  return true;
}
