import { globalShortcut } from 'electron';
import type { ShortcutId } from '../shared/types.js';
import { getShortcuts } from './store.js';

type Dispatch = (id: ShortcutId) => void;

let dispatch: Dispatch | null = null;
let registered = false;

export function setShortcutDispatch(fn: Dispatch): void {
  dispatch = fn;
}

export function registerAllShortcuts(): void {
  globalShortcut.unregisterAll();
  registered = false;
  const map = getShortcuts();
  for (const [id, accel] of Object.entries(map)) {
    if (!accel) continue;
    try {
      const ok = globalShortcut.register(accel, () => dispatch?.(id as ShortcutId));
      if (!ok) console.warn('[shortcuts] register returned false', id, accel);
    } catch (err) {
      console.warn('[shortcuts] register threw', id, accel, err);
    }
  }
  registered = true;
}

export function unregisterAllShortcuts(): void {
  globalShortcut.unregisterAll();
  registered = false;
}

export function isRegistered(): boolean {
  return registered;
}
