// Pre-game party room: invite code, roster with pings, color picker, ready / start, host controls and live chat.
import { useEffect, useRef, useState } from 'react';
import { Copy, Check, Crown, LogOut, Send, UserX, Lock, Globe } from 'lucide-react';
import type { OnlineSession, SessionState } from './session';
import { MIN_PLAYERS, PALETTE } from '../net/protocol';
import { Glass, Btn, PingDot, inputCls } from './ui';

interface Props { session: OnlineSession; state: SessionState; avatar: (color: string) => string }

export function PartyRoom({ session, state, avatar }: Props) {
  const room = state.room!;
  const me = room.roster.find((r) => r.pid === state.selfPid);
  const isHost = room.hostPid === state.selfPid;
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [msg, setMsg] = useState('');
  const chatEnd = useRef<HTMLDivElement | null>(null);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'end' }); }, [state.chat.length]);

  const copy = async (what: 'code' | 'link') => {
    const text = what === 'code' ? room.code : `${window.location.origin}/?code=${room.code}`;
    try { await navigator.clipboard.writeText(text); } catch { window.prompt('Copy this:', text); }
    setCopied(what); setTimeout(() => setCopied(null), 1500);
  };
  const readyCount = room.roster.filter((r) => r.ready).length;
  const allReady = readyCount === room.roster.length;
  const canStart = isHost && room.roster.length >= MIN_PLAYERS && allReady;
  const status = room.roster.length < MIN_PLAYERS ? `Waiting for players (${room.roster.length}/${MIN_PLAYERS} minimum)` : !allReady ? `Waiting for everyone to ready up (${readyCount}/${room.roster.length})` : 'Everyone is ready!';

  return (
    <div className="absolute inset-0 z-30 overflow-y-auto bg-gradient-to-br from-white/40 via-indigo-50/40 to-pink-50/40 p-4 md:p-8">
      <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-5">
          {/* header */}
          <Glass className="flex flex-wrap items-center gap-4 p-5">
            <div className="mr-auto min-w-0">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                {room.isPrivate ? <><Lock size={12} />Private party</> : <><Globe size={12} />Public party</>}{room.hasPasscode && ' · passcode'}
              </div>
              <h2 className="truncate text-2xl font-black text-slate-700">{room.name}</h2>
              <div className="text-sm font-bold text-slate-500">{room.roster.length}/{room.maxPlayers} painters{room.assassinCount === 2 ? ' · 2 assassins at 10+' : ''}</div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => copy('code')} className="rounded-2xl bg-slate-800 px-4 py-2 font-mono text-2xl font-black tracking-[0.3em] text-white" title="Copy code">
                {room.code}
              </button>
              <Btn kind="soft" onClick={() => copy('link')}>{copied === 'link' ? <Check size={16} /> : <Copy size={16} />}{copied === 'link' ? 'Copied!' : 'Copy Invite Link'}</Btn>
            </div>
            <Btn kind="ghost" onClick={() => session.leave()}><LogOut size={16} />Leave</Btn>
          </Glass>

          {/* roster */}
          <Glass className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-black text-slate-700">Painters</h3>
              {isHost && (
                <button onClick={() => session.setPrivacy(!room.isPrivate)} className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200">
                  <span className={`relative h-4 w-7 rounded-full transition ${room.isPrivate ? 'bg-indigo-500' : 'bg-slate-300'}`}><span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${room.isPrivate ? 'left-3.5' : 'left-0.5'}`} /></span>
                  Private room
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {room.roster.map((p) => (
                <div key={p.pid} className={`relative rounded-2xl border-2 bg-white p-3 text-center transition ${p.pid === state.selfPid ? 'border-indigo-300' : 'border-transparent'}`}>
                  {p.isHost && <Crown size={16} className="absolute left-2 top-2 text-amber-400" />}
                  {isHost && !p.isHost && (
                    <button onClick={() => session.kick(p.pid)} title={`Kick ${p.name}`} className="absolute right-2 top-2 rounded-full p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-500"><UserX size={14} /></button>
                  )}
                  <div className="mx-auto h-16 w-16 overflow-hidden rounded-full" style={{ background: p.color + '55' }}>
                    <img src={avatar(p.color)} alt="" className="h-full w-full object-cover" draggable={false} />
                  </div>
                  <div className="mt-1 truncate text-sm font-black text-slate-700">{p.name}{p.pid === state.selfPid ? ' (you)' : ''}</div>
                  <div className="mt-1 flex items-center justify-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${p.ready ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>{p.isHost ? 'HOST' : p.ready ? 'READY' : 'NOT READY'}</span>
                    <PingDot ms={p.ping} />
                  </div>
                </div>
              ))}
              {Array.from({ length: Math.max(0, room.maxPlayers - room.roster.length) }).slice(0, 8).map((_, i) => (
                <div key={`e${i}`} className="flex items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 p-3 text-xs font-bold text-slate-300">Open slot</div>
              ))}
            </div>
          </Glass>

          {/* colors + ready/start */}
          <Glass className="flex flex-wrap items-center gap-5 p-5">
            <div>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Your coat color</div>
              <div className="flex flex-wrap gap-2">
                {PALETTE.map((c) => {
                  const owner = room.roster.find((r) => r.color === c);
                  const mine = owner?.pid === state.selfPid;
                  const taken = !!owner && !mine;
                  return (
                    <button key={c} disabled={taken} onClick={() => session.selectColor(c)} title={taken ? `Taken by ${owner?.name}` : 'Claim this color'}
                      className={`relative h-9 w-9 rounded-full border-4 transition ${mine ? 'scale-110 border-slate-700' : 'border-white hover:scale-110'} disabled:cursor-not-allowed disabled:opacity-30`} style={{ background: c }}>
                      {taken && <span className="absolute inset-0 flex items-center justify-center text-lg font-black text-white/90">×</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="ml-auto flex flex-col items-end gap-2">
              <span className="text-xs font-bold text-slate-400">{status}</span>
              {isHost ? <Btn className="px-8 py-3 text-base" disabled={!canStart} onClick={() => void session.start()}>Start Game</Btn>
                : <Btn className="px-8 py-3 text-base" kind={me?.ready ? 'ghost' : 'primary'} onClick={() => session.toggleReady()}>{me?.ready ? 'Not Ready' : "I'm Ready"}</Btn>}
            </div>
          </Glass>
        </div>

        {/* chat */}
        <Glass className="flex h-[70vh] min-h-[420px] flex-col p-4 lg:h-auto">
          <h3 className="mb-2 font-black text-slate-700">Party Chat</h3>
          <div className="flex-1 space-y-1.5 overflow-y-auto pr-1 text-sm">
            {state.chat.map((m) => (
              <div key={m.id} className={`rounded-xl px-3 py-1.5 ${m.system ? 'bg-indigo-50 text-xs text-indigo-500' : 'bg-white shadow-sm'}`}>
                {!m.system && <span className="font-bold" style={{ color: m.color }}>{m.name}: </span>}<span className="text-slate-600">{m.text}</span>
              </div>
            ))}
            <div ref={chatEnd} />
          </div>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); session.sendChat(msg); setMsg(''); }}>
            <input className={inputCls} value={msg} maxLength={200} placeholder="Say hi…" onChange={(e) => setMsg(e.target.value)} />
            <Btn kind="soft" title="Send"><Send size={16} /></Btn>
          </form>
        </Glass>
      </div>
    </div>
  );
}
