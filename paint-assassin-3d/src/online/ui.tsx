// Small shared UI pieces for the online screens (glassmorphism cards, buttons, inputs).
import type { ReactNode } from 'react';

export const NAME_KEY = 'paint_assassin_display_name';
export const readName = (): string => { try { return localStorage.getItem(NAME_KEY) || 'Painter'; } catch { return 'Painter'; } };
export const saveName = (n: string): void => { try { localStorage.setItem(NAME_KEY, n); } catch { /* storage unavailable */ } };

export function Glass({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-3xl border border-white/60 bg-white/75 shadow-xl shadow-indigo-200/40 backdrop-blur-xl ${className}`}>{children}</div>;
}

export function Btn({ children, onClick, disabled, kind = 'primary', className = '', title }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean; kind?: 'primary' | 'ghost' | 'danger' | 'soft'; className?: string; title?: string;
}) {
  const k = {
    primary: 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-300/50 hover:brightness-110',
    ghost: 'bg-white/80 text-slate-700 border border-slate-200 hover:bg-white',
    danger: 'bg-rose-500 text-white hover:bg-rose-600',
    soft: 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100',
  }[kind];
  return (
    <button title={title} onClick={onClick} disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-extrabold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100 ${k} ${className}`}>
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</span><div className="mt-1">{children}</div></label>;
}

export const inputCls = 'w-full rounded-xl border-2 border-slate-200 bg-white/90 px-3 py-2 font-semibold text-slate-700 outline-none transition focus:border-indigo-400';

export function Modal({ children, onClose, title }: { children: ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <Glass className="w-full max-w-md animate-fadeIn p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-black text-slate-700">{title}</h3>
          <button onClick={onClose} className="rounded-full px-2 text-2xl leading-none text-slate-400 hover:text-slate-600" aria-label="Close">×</button>
        </div>
        {children}
      </Glass>
    </div>
  );
}

export function PingDot({ ms }: { ms: number }) {
  const c = ms === 0 ? 'bg-slate-300' : ms < 80 ? 'bg-emerald-400' : ms < 160 ? 'bg-amber-400' : 'bg-rose-500';
  return <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400"><span className={`h-2 w-2 rounded-full ${c}`} />{ms ? `${ms}ms` : '—'}</span>;
}
