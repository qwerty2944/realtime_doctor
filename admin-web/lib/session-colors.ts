export const SESSION_COLORS = [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink'
] as const;
export type SessionColor = (typeof SESSION_COLORS)[number];

export function isSessionColor(s: unknown): s is SessionColor {
  return typeof s === 'string' && (SESSION_COLORS as readonly string[]).includes(s);
}

export const COLOR_TOKEN: Record<
  SessionColor,
  { bar: string; chip: string; dot: string; tint: string }
> = {
  gray: {
    bar: 'bg-slate-400',
    chip: 'bg-slate-500/15 text-slate-200',
    dot: 'bg-slate-400',
    tint: 'hover:bg-slate-500/[0.04]'
  },
  red: {
    bar: 'bg-rose-500',
    chip: 'bg-rose-500/15 text-rose-200',
    dot: 'bg-rose-500',
    tint: 'hover:bg-rose-500/[0.05]'
  },
  orange: {
    bar: 'bg-orange-500',
    chip: 'bg-orange-500/15 text-orange-200',
    dot: 'bg-orange-500',
    tint: 'hover:bg-orange-500/[0.05]'
  },
  yellow: {
    bar: 'bg-amber-400',
    chip: 'bg-amber-400/15 text-amber-200',
    dot: 'bg-amber-400',
    tint: 'hover:bg-amber-400/[0.05]'
  },
  green: {
    bar: 'bg-emerald-500',
    chip: 'bg-emerald-500/15 text-emerald-200',
    dot: 'bg-emerald-500',
    tint: 'hover:bg-emerald-500/[0.05]'
  },
  blue: {
    bar: 'bg-sky-500',
    chip: 'bg-sky-500/15 text-sky-200',
    dot: 'bg-sky-500',
    tint: 'hover:bg-sky-500/[0.05]'
  },
  purple: {
    bar: 'bg-violet-500',
    chip: 'bg-violet-500/15 text-violet-200',
    dot: 'bg-violet-500',
    tint: 'hover:bg-violet-500/[0.05]'
  },
  pink: {
    bar: 'bg-pink-500',
    chip: 'bg-pink-500/15 text-pink-200',
    dot: 'bg-pink-500',
    tint: 'hover:bg-pink-500/[0.05]'
  }
};

export const COLOR_LABEL: Record<SessionColor, string> = {
  gray: '회색',
  red: '빨강',
  orange: '주황',
  yellow: '노랑',
  green: '초록',
  blue: '파랑',
  purple: '보라',
  pink: '분홍'
};
