import type { Language, TranscribeProviderId } from '../shared/types.js';
import { setLanguage, setTranscribeProvider } from './store.js';
import { listProviders } from './transcribers.js';

export function preferredProviderFor(lang: Language): TranscribeProviderId {
  const ps = listProviders();
  const avail = (id: TranscribeProviderId): boolean =>
    ps.find((p) => p.id === id)?.available ?? false;
  if (lang === 'ko') {
    return avail('clova-stream') ? 'clova-stream' : 'gemini';
  }
  return avail('openai') ? 'openai' : 'gemini';
}

export function fallbackProviderFor(_lang: Language): TranscribeProviderId {
  return 'gemini';
}

export function applyLanguage(lang: Language): TranscribeProviderId {
  setLanguage(lang);
  const picked = preferredProviderFor(lang);
  setTranscribeProvider(picked);
  return picked;
}
