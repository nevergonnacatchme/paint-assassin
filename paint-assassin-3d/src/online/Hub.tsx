// Multiplayer hub: Quick Play, server browser (search + filters), Create Party, Join by Code.
import { useEffect, useMemo, useState } from 'react';
import { Zap, Search, RefreshCw, Lock, Users, Plus, KeyRound, ArrowLeft, Wifi, WifiOff } from 'lucide-react';
import type { OnlineSession, SessionState } from './session';
import type { JoinResult, RoomInfo } from '../net/protocol';
import { MIN_PLAYERS, MAX_PLAYERS } from '../net/protocol';
import { Glass, Btn, Field, Modal, inputCls, saveName } from './ui';

interface Props { session: OnlineSession; state: SessionState; name: string; setName: (n: string) => void; onExit: () => void; inviteCode: string | null }

export function Hub({ session, state, name, setName, onExit, inviteCode }: Props) {
  const [search, setSearch] = useState('');
  const [hideFull, setHideFull] = useState(false);
  const [hideRunning, setHideRunning] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showCode, setShowCode] = useState(!!inviteCode);
  const [pwFor, setPwFor] = useState<RoomInfo | null>(null);

  const cleanName = () => { const n = name.trim().slice(0, 12) || 'Painter'; saveName(n); return n; };
  const handle = async (p: Promise<JoinResult>): Promise<JoinResult> => {
    setBusy(true); setErr('');
    const r = await p; setBusy(false);
    if (!r.ok) setErr(r.error);
    return r;
  };

  useEffect(() => { const id = setInterval(() => session.refreshList(), 5000); return () => clearInterval(id); }, [session]);

  const rooms = useMemo(() => state.rooms.filter((r) =>
    (!search || r.name.toLowerCase().includes(search.toLowerCase()) || r.hostName.toLowerCase().includes(search.toLowerCase())) &&
    (!hideFull || r.players < r.maxPlayers) && (!hideRunning || r.phase === 'LOBBY') && (!onlyOpen || !r.hasPasscode)), [state.rooms, search, hideFull, hideRunning, onlyOpen]);

  const offline = state.conn !== 'online';

  return (
    <div className="absolute inset-0 z-30 overflow-y-auto bg-gradient-to-br from-white/40 via-indigo-50/40 to-pink-50/40 p-4 md:p-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        {/* header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Btn kind="ghost" onClick={onExit}><ArrowLeft size={16} />Solo</Btn>
            <h1 className="bg-gradient-to-r from-indigo-500 to-pink-400 bg-clip-text text-3xl font-black tracking-tight text-transparent md:text-4xl">Paint Assassin Online</h1>
          </div>
          <div className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold shadow ${state.conn === 'online' ? 'bg-emerald-50 text-emerald-600' : state.conn === 'connecting' ? 'bg-amber-50 text-amber-600' : 'bg-rose-50 text-rose-600'}`}>
            {state.conn === 'online' ? <Wifi size={16} /> : <WifiOff size={16} />}
            {state.conn === 'online' ? `Connected · ${state.ping || '…'}ms` : state.conn === 'connecting' ? 'Connecting to server…' : 'Server not reachable'}
          </div>
        </div>
        {state.conn === 'offline' && (
          <Glass className="border-rose-200 p-4 text-sm text-rose-600">
            Can't reach the multiplayer server. Make sure it was started with <b>npm run dev</b> (not plain <code>vite</code>) and that you opened the address it printed.
          </Glass>
        )}

        {/* name + three pathways */}
        <div className="grid gap-4 md:grid-cols-4">
          <Glass className="p-5">
            <Field label="Your display name">
              <input className={inputCls} value={name} maxLength={12} onChange={(e) => setName(e.target.value)} onBlur={() => saveName(name.trim() || 'Painter')} />
            </Field>
            <p className="mt-3 text-xs text-slate-400">Shown to everyone in your party. Colors are picked in the party room.</p>
          </Glass>
          <button disabled={offline || busy} onClick={() => handle(session.quickPlay(cleanName()))}
            className="group rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-500 p-5 text-left text-white shadow-xl shadow-indigo-300/50 transition hover:-translate-y-0.5 disabled:opacity-50">
            <Zap className="mb-2" size={28} /><div className="text-xl font-black">Quick Play</div>
            <div className="text-sm text-white/80">Jump into the busiest open lobby, or start a new one.</div>
          </button>
          <button disabled={offline} onClick={() => setShowCreate(true)}
            className="rounded-3xl border border-white/60 bg-white/75 p-5 text-left shadow-xl shadow-indigo-200/40 backdrop-blur-xl transition hover:-translate-y-0.5 disabled:opacity-50">
            <Plus className="mb-2 text-pink-500" size={28} /><div className="text-xl font-black text-slate-700">Create Party</div>
            <div className="text-sm text-slate-500">Public or private, 4–12 painters.</div>
          </button>
          <button disabled={offline} onClick={() => setShowCode(true)}
            className="rounded-3xl border border-white/60 bg-white/75 p-5 text-left shadow-xl shadow-indigo-200/40 backdrop-blur-xl transition hover:-translate-y-0.5 disabled:opacity-50">
            <KeyRound className="mb-2 text-teal-500" size={28} /><div className="text-xl font-black text-slate-700">Join with Code</div>
            <div className="text-sm text-slate-500">Got a 6-character code from a friend?</div>
          </button>
        </div>
        {err && !showCode && !showCreate && !pwFor && <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600">{err}</div>}

        {/* server browser */}
        <Glass className="p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="mr-auto text-xl font-black text-slate-700">Server Browser</h2>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className={`${inputCls} w-56 pl-9`} placeholder="Search rooms or hosts" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Btn kind="ghost" onClick={() => session.refreshList()} title="Refresh"><RefreshCw size={16} /></Btn>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {([['Hide Full', hideFull, setHideFull], ['Hide In-Progress', hideRunning, setHideRunning], ['Only Open (no passcode)', onlyOpen, setOnlyOpen]] as const).map(([label, on, set]) => (
              <button key={label} onClick={() => set(!on)} className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${on ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>{label}</button>
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rooms.length === 0 && (
              <div className="col-span-full rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center text-slate-400">
                No public rooms {state.rooms.length ? 'match your filters' : 'yet'}. Hit <b>Quick Play</b> or <b>Create Party</b> to start one!
              </div>
            )}
            {rooms.map((r) => {
              const full = r.players >= r.maxPlayers, running = r.phase !== 'LOBBY';
              return (
                <div key={r.id} className="flex flex-col rounded-2xl border border-slate-100 bg-white/90 p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-black text-slate-700">{r.name}</div>
                      <div className="text-xs text-slate-400">Host: {r.hostName}</div>
                    </div>
                    {r.hasPasscode ? <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-600"><Lock size={11} />Passcode</span>
                      : <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">Public</span>}
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-sm font-bold text-slate-600"><Users size={15} />{r.players}/{r.maxPlayers}
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-400" style={{ width: `${(r.players / r.maxPlayers) * 100}%` }} /></div>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className={`text-xs font-bold ${running ? 'text-rose-500' : 'text-emerald-600'}`}>{running ? '● In Progress' : '● In Lobby'}</span>
                    <Btn kind="soft" disabled={full || running || busy || offline} onClick={() => (r.hasPasscode ? setPwFor(r) : handle(session.join({ name: cleanName(), roomId: r.id })))}>
                      {full ? 'Full' : running ? 'Playing' : 'Join'}
                    </Btn>
                  </div>
                </div>
              );
            })}
          </div>
        </Glass>
      </div>

      {showCreate && <CreateModal busy={busy} err={err} onClose={() => { setShowCreate(false); setErr(''); }}
        onCreate={async (o) => { const r = await handle(session.create({ ...o, name: cleanName() })); if (r.ok) setShowCreate(false); }} defaultName={`${name.trim() || 'Painter'}'s Paint Squad`} />}
      {showCode && <CodeModal busy={busy} err={err} initial={inviteCode ?? ''} onClose={() => { setShowCode(false); setErr(''); }}
        onJoin={async (code, passcode) => { const r = await handle(session.join({ name: cleanName(), code, passcode })); if (r.ok) setShowCode(false); return r; }} />}
      {pwFor && <PasscodeModal room={pwFor} busy={busy} err={err} onClose={() => { setPwFor(null); setErr(''); }}
        onJoin={async (passcode) => { const r = await handle(session.join({ name: cleanName(), roomId: pwFor.id, passcode })); if (r.ok) setPwFor(null); }} />}
    </div>
  );
}

function CreateModal({ onClose, onCreate, busy, err, defaultName }: {
  onClose: () => void; busy: boolean; err: string; defaultName: string;
  onCreate: (o: { partyName: string; maxPlayers: number; isPrivate: boolean; passcode: string; assassinCount: 1 | 2 }) => void;
}) {
  const [partyName, setPartyName] = useState(defaultName.slice(0, 32));
  const [maxPlayers, setMax] = useState(10);
  const [isPrivate, setPrivate] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [two, setTwo] = useState(false);
  return (
    <Modal title="Create Party" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Party name"><input className={inputCls} value={partyName} maxLength={32} onChange={(e) => setPartyName(e.target.value)} /></Field>
        <Field label={`Max players: ${maxPlayers}`}><input type="range" min={MIN_PLAYERS} max={MAX_PLAYERS} value={maxPlayers} onChange={(e) => setMax(+e.target.value)} className="w-full accent-indigo-500" /></Field>
        <Field label="Privacy">
          <div className="grid grid-cols-2 gap-2">
            {[false, true].map((p) => (
              <button key={String(p)} onClick={() => setPrivate(p)} className={`rounded-xl px-3 py-2 text-sm font-bold transition ${isPrivate === p ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {p ? '🔒 Private (code only)' : '🌐 Public (in browser)'}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Passcode (optional)"><input className={inputCls} value={passcode} maxLength={12} placeholder="Leave empty for none" onChange={(e) => setPasscode(e.target.value)} /></Field>
        <Field label="Assassins">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setTwo(false)} className={`rounded-xl px-3 py-2 text-sm font-bold ${!two ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-600'}`}>1 Assassin</button>
            <button onClick={() => setTwo(true)} disabled={maxPlayers < 10} className={`rounded-xl px-3 py-2 text-sm font-bold disabled:opacity-40 ${two ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-600'}`}>2 Assassins</button>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">2 assassins only applies when 10+ players start.</p>
        </Field>
        {err && <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-600">{err}</div>}
        <Btn className="w-full" disabled={busy} onClick={() => onCreate({ partyName, maxPlayers, isPrivate, passcode, assassinCount: two && maxPlayers >= 10 ? 2 : 1 })}>Create Party</Btn>
      </div>
    </Modal>
  );
}

function CodeModal({ onClose, onJoin, busy, err, initial }: { onClose: () => void; onJoin: (code: string, passcode?: string) => Promise<JoinResult>; busy: boolean; err: string; initial: string }) {
  const [code, setCode] = useState(initial.toUpperCase());
  const [passcode, setPasscode] = useState('');
  const [needPw, setNeedPw] = useState(false);
  const [autoTried, setAutoTried] = useState(false);
  const submit = async () => {
    const r = await onJoin(code, needPw ? passcode : undefined);
    if (!r.ok && (r.code === 'NEED_PASSCODE' || r.code === 'BAD_PASSCODE')) setNeedPw(true);
  };
  useEffect(() => { if (initial.length === 6 && !autoTried) { setAutoTried(true); void submit(); } }, []); // invite links join instantly
  return (
    <Modal title="Join with Code" onClose={onClose}>
      <div className="space-y-4">
        <input autoFocus value={code} maxLength={6} placeholder="PAINT9"
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) void submit(); }}
          className="w-full rounded-2xl border-2 border-slate-200 bg-white py-4 text-center font-mono text-4xl font-black tracking-[0.5em] text-slate-700 outline-none focus:border-indigo-400" />
        {needPw && <Field label="Passcode"><input className={inputCls} value={passcode} autoFocus onChange={(e) => setPasscode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} /></Field>}
        {err && <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-600">{err}</div>}
        <Btn className="w-full" disabled={busy || code.length !== 6} onClick={() => void submit()}>Join Party</Btn>
      </div>
    </Modal>
  );
}

function PasscodeModal({ room, onClose, onJoin, busy, err }: { room: RoomInfo; onClose: () => void; onJoin: (p: string) => void; busy: boolean; err: string }) {
  const [pw, setPw] = useState('');
  return (
    <Modal title={`🔒 ${room.name}`} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Passcode"><input className={inputCls} autoFocus value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onJoin(pw); }} /></Field>
        {err && <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-600">{err}</div>}
        <Btn className="w-full" disabled={busy || !pw} onClick={() => onJoin(pw)}>Join</Btn>
      </div>
    </Modal>
  );
}
