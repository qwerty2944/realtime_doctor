import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import type { Language } from '../../shared/types';
import ko from './locales/ko';
import en from './locales/en';

export type TKey = keyof typeof ko;

const BUNDLES: Record<Language, Record<TKey, string>> = { ko, en };

interface LangCtxValue {
  lang: Language;
}

const LangCtx = createContext<LangCtxValue>({ lang: 'ko' });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>('ko');

  useEffect(() => {
    let cancelled = false;
    window.api.language
      .get()
      .then((l) => {
        if (!cancelled && l) setLang(l);
      })
      .catch(() => {});
    const off = window.api.language.onChange((l) => setLang(l ?? 'ko'));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const value = useMemo(() => ({ lang }), [lang]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export function useLang(): Language {
  return useContext(LangCtx).lang;
}

export function useT(): (key: TKey) => string {
  const { lang } = useContext(LangCtx);
  return (key: TKey) => BUNDLES[lang][key] ?? String(key);
}
