// Electron 33 ships Node 20, which lacks a native global WebSocket. supabase-js
// instantiates its realtime client when onAuthStateChange fires, and that
// throws unless globalThis.WebSocket exists. This polyfill loads first so the
// global is set before @supabase/supabase-js evaluates.
import WS from 'ws';

const g = globalThis as { WebSocket?: unknown };
if (typeof g.WebSocket === 'undefined') {
  g.WebSocket = WS as unknown as typeof WebSocket;
}
