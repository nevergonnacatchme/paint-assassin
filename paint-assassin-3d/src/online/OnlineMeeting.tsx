// Server-driven Emergency Meeting board: live vote counts, countdown, 3-tie counter, meeting chat and the reveal.
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Send, Ghost } from 'lucide-react';
import type { OnlineSession, SessionState } from './session';
import type { Player } from '../types';
import { Glass, Btn, inputCls } from './ui';

interface Props { session: OnlineSession; state: SessionState; players: Player[]; headshot: (p: Player) => string; revealing: boolean }

export function OnlineMeeting({ session, state, players, headshot, revealing }: Props) {
  const m = state.meeting; const v = state.votes; const t = state.tally;
  const me = players.find((p) => p.isHuman);
  const alive = !!me?.isAlive;
  const [now, setNow] = useState(Date.now());
  const [msg, setMsg] = useState('');
  const chatEnd = useRef<HTMLDivElement | null>(null);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id); }, []);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'end' }); }, [state.chat.length]);
  const secs = m ? Math.max(0, Math.ceil((m.endsAt - now) / 1000)) : 0;
  const counts = (revealing && t ? t.counts : v?.counts) ?? {};
  const skips = (revealing && t ? t.skips : v?.skips) ?? 0;
  const voted = new Set(v?.votedPids ?? []);
  const tie = t?.tieCount ?? m?.tieCount ?? 0;
  const ejected = t?.ejectedId != null ? players.find((p) => p.id === t.ejectedId) : null;

  let title = '', sub = '';
  if (revealing && t) {
    if (t.deadlock) { title = 'Tied 3 times — meeting cancelled!'; sub = 'No agreement. Everyone returns to the arena…'; }
    else if (t.isTie) { title = `Tie vote! (Tie #${t.tieCount} of 3)`; sub = `Revote starting… ${3 - t.tieCount} more tie${3 - t.tieCount === 1 ? '' : 's'} cancels the meeting.`; }
    else if (t.skipped || !ejected) { title = 'Vote skipped'; sub = 'No one was ejected.'; }
    else { title = `${ejected.name} was ejected`; sub = t.ejectedWasAssassin ? `${ejected.name} WAS the Assassin!` : `${ejected.name} was NOT the Assassin…`; }
  }

  return (
    <div className={`absolute inset-0 z-30 flex items-center justify-center p-3 ${revealing ? 'pointer-events-none bg-slate-900/15' : 'bg-slate-900/50 backdrop-blur-sm'}`}>
      <Glass className={`pointer-events-auto flex max-h-full w-full max-w-5xl animate-fadeIn flex-col gap-3 p-4 md:flex-row ${revealing ? 'translate-y-[14vh] scale-95' : ''}`}>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-xl font-black text-slate-700"><AlertTriangle className="text-rose-500" size={22} />Who is the Assassin?</h2>
            <div className="flex items-center gap-2">
              {tie > 0 && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">Tie #{Math.min(tie, 3)} of 3</span>}
              {!revealing && <span className={`rounded-full px-3 py-1 text-xs font-black ${secs <= 10 ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-600'}`}>⏱ {secs}s</span>}
            </div>
          </div>
          <p className="mt-1 text-sm text-slate-500">{m?.reason}</p>
          <div className="mt-3 grid grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4 lg:grid-cols-6">
            {players.map((p) => {
              const canPick = !revealing && alive && state.myVote === null && p.isAlive && !p.isHuman;
              const n = counts[p.id] || 0;
              return (
                <button key={p.id} disabled={!canPick} onClick={() => session.vote(p.id)}
                  className={`relative rounded-2xl border-2 bg-white p-2 text-center transition ${!p.isAlive ? 'opacity-40' : canPick ? 'hover:-translate-y-0.5 hover:shadow-lg' : ''} ${state.myVote === p.id ? 'border-indigo-500' : 'border-slate-100'}`}>
                  <div className="mx-auto h-16 w-16 overflow-hidden rounded-full" style={{ background: p.color + '55' }}>
                    <img src={headshot(p)} alt={p.name} className="h-full w-full object-cover" draggable={false} />
                  </div>
                  <div className="mt-1 truncate text-sm font-bold text-slate-700">{p.isHuman ? `${p.name} (you)` : p.name}</div>
                  <div className={`text-[10px] font-bold uppercase ${p.isAlive ? 'text-emerald-500' : 'text-slate-400'}`}>{p.isAlive ? 'Alive' : 'Eliminated'}</div>
                  {voted.has(p.id) && !revealing && <span className="absolute left-1.5 top-1.5 rounded-full bg-emerald-500 p-0.5 text-white" title="Has voted"><Check size={11} /></span>}
                  {n > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-6 w-6 animate-scaleIn items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-white">{n}</span>}
                </button>
              );
            })}
          </div>
          {!revealing ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Btn kind={state.myVote === 'skip' ? 'primary' : 'ghost'} disabled={!alive || state.myVote !== null} onClick={() => session.vote('skip')}>Skip vote</Btn>
              <span className="text-xs font-bold text-slate-400">
                {!alive ? '👻 You are a ghost — watching the vote' : state.myVote !== null ? 'Vote locked in — waiting for others…' : 'Click a painter to vote'}
                {` · ${voted.size} voted · ${skips} skip${skips === 1 ? '' : 's'}`}
              </span>
            </div>
          ) : (
            <div className="mt-3 rounded-2xl bg-indigo-50 p-3">
              <div className="text-lg font-black text-slate-700">{title}</div>
              <div className="text-sm text-slate-500">{sub}</div>
            </div>
          )}
        </div>
        <div className="flex max-h-56 min-h-0 w-full flex-col rounded-2xl bg-slate-50 p-3 md:max-h-none md:w-72">
          <div className="mb-2 flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-slate-400">{alive ? 'Emergency chat' : <><Ghost size={12} />Ghost chat (dead only)</>}</div>
          <div className="flex-1 space-y-1.5 overflow-y-auto pr-1 text-sm">
            {state.chat.map((c) => (
              <div key={c.id} className={`rounded-xl px-2.5 py-1.5 ${c.system ? 'bg-indigo-50 text-xs text-indigo-500' : c.ghost ? 'bg-slate-200/60 italic' : 'bg-white shadow-sm'}`}>
                {!c.system && <span className="font-bold" style={{ color: c.color }}>{c.ghost ? '👻 ' : ''}{c.name}: </span>}<span className="text-slate-600">{c.text}</span>
              </div>
            ))}
            <div ref={chatEnd} />
          </div>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); session.sendChat(msg); setMsg(''); }}>
            <input className={`${inputCls} py-1.5 text-sm`} value={msg} maxLength={200} placeholder={alive ? 'Discuss…' : 'Talk to other ghosts…'} onChange={(e) => setMsg(e.target.value)} />
            <Btn kind="soft" className="px-3" title="Send"><Send size={14} /></Btn>
          </form>
        </div>
      </Glass>
    </div>
  );
}
