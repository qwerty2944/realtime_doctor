const IS_MAC =
  typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

export function formatAccelerator(accel: string | undefined | null): string {
  if (!accel) return '—';
  const parts = accel.split('+');
  return parts.map(formatPart).join(IS_MAC ? ' ' : '+');
}

function formatPart(p: string): string {
  if (IS_MAC) {
    switch (p) {
      case 'CommandOrControl':
      case 'CmdOrCtrl':
      case 'Command':
      case 'Cmd':
      case 'Super':
      case 'Meta':
        return '⌘';
      case 'Control':
      case 'Ctrl':
        return '⌃';
      case 'Alt':
      case 'Option':
        return '⌥';
      case 'Shift':
        return '⇧';
      default:
        return p.length === 1 ? p.toUpperCase() : p;
    }
  }
  switch (p) {
    case 'CommandOrControl':
    case 'CmdOrCtrl':
      return 'Ctrl';
    default:
      return p;
  }
}

export function accelFromEvent(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.metaKey) mods.push('Command');
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const key = normalizeKey(e.key, e.code);
  if (!key) return null;
  // modifier 없는 단축키는 글로벌로 위험. F-key 만 예외 허용.
  if (mods.length === 0 && !/^F\d{1,2}$/.test(key)) return null;
  // macOS Command 와 Win Control 을 CommandOrControl 로 정규화
  const finalMods = mods
    .map((m) => (m === 'Command' || m === 'Control' ? 'CommandOrControl' : m))
    .filter((v, i, a) => a.indexOf(v) === i);
  return [...finalMods, key].join('+');
}

function normalizeKey(key: string, code: string): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift', 'CapsLock'].includes(key)) return null;
  if (/^[a-z]$/.test(key)) return key.toUpperCase();
  if (/^[A-Z0-9]$/.test(key)) return key;
  if (/^F\d{1,2}$/.test(key)) return key;
  const map: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ' ': 'Space',
    Escape: 'Esc',
    Enter: 'Return',
    Backspace: 'Backspace',
    Tab: 'Tab',
    Delete: 'Delete'
  };
  if (map[key]) return map[key];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return null;
}
