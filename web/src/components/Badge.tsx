import type { ReactNode } from 'react';

type Tone = 'neutral' | 'pending' | 'verified' | 'retired';

const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  pending: 'bg-amber-50 text-amber-800 ring-amber-200',
  verified: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  retired: 'bg-slate-100 text-slate-500 ring-slate-200',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
