// Online multiplayer screen: owns the socket, the 3D engine and the OnlineSession, and switches between
// hub -> party room -> in-game (role reveal, HUD, meeting, game over).
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Volume2, VolumeX, LogOut, Crosshair } from 'lucide-react';
import { Game3D } from '../game/Game3D';
import { sounds } from '../sound';
import { OnlineSession } from './session';
import type { SessionState, SocketLike } from './session';
import type { HudState, Player } from '../types';
import { GameHud } from '../ui/Hud';
import { isTouchDevice } from '../ui/TouchControls';
import type { HudToast } from '../ui/Hud';
import { Hub } from './Hub';
import { PartyRoom } from './PartyRoom';
import { OnlineMeeting } from './OnlineMeeting';
import { Btn, readName } from './ui';

export default function OnlineApp({ onExit, inviteCode }: { onExit: () => void; inviteCode: string | null }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<Game3D | null>(null);
  const sessionRef = useRef<OnlineSession | null>(null);
  const lockedRef = useRef(false);
  const toastSeq = useRef(0);
  const [state, setState] = useState<SessionState | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [locked, setLocked] = useState(false);
  const [toast, setToast] = useState<HudToast | null>(null);
  const [hitKey, setHitKey] = useState<{ k: number; kind: 'hit' | 'kill' }>({ k: 0, kind: 'hit' });
  const [muted, setMuted] = useState(sounds.isMuted());
  const [name, setName] = useState(readName);
  const [fatal, setFatal] = useState('');
  const [touch] = useState(isTouchDevice);
  const [, force] = useState(0);

  const showToast = (text: string, tone: HudToast['tone']) => {
    const id = ++toastSeq.current; setToast({ id, text, tone });
    window.setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), 2600);
  };

  useEffect(() => {
    const host = hostRef.current; if (!host) return;
    let engine: Game3D | null = null;
    try {
      engine = new Game3D(host, {
        onHud: (h) => setHud(h),
        onHit: (kind) => setHitKey((h) => ({ k: h.k + 1, kind })),
        onToast: (t, tone) => showToast(t, tone),
        onMeeting: () => { /* online meetings come from the server */ },
        onGameOver: () => { /* online results come from the server */ },
        onLockChange: (l) => { lockedRef.current = l; setLocked(l); },
      });
    } catch (e) { setFatal(e instanceof Error ? e.message : 'WebGL is not available.'); }
    engine?.setTouchMode(touch);
    engineRef.current = engine;
    const socket = io({ transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 });
    const session = new OnlineSession(socket as unknown as SocketLike, engine);
    sessionRef.current = session;
    setState(session.state);
    const unsub = session.subscribe((s) => setState(s));
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.code === 'KeyM') { const m = !sounds.isMuted(); sounds.setMuted(m); setMuted(m); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      unsub(); session.dispose(); socket.disconnect(); engine?.dispose();
      engineRef.current = null; sessionRef.current = null;
    };
  }, []);

  // transient notices from the session -> toast
  useEffect(() => {
    const n = state?.notice; if (!n) return;
    showToast(n.text, n.tone === 'error' ? 'kill' : n.tone === 'warn' ? 'warn' : 'info');
    sessionRef.current?.clearNotice(n.id);
  }, [state?.notice?.id]);

  // keep meeting cards in sync with engine-side player changes
  useEffect(() => { force((x) => x + 1); }, [state?.tally, state?.meeting, state?.room?.phase]);

  const session = sessionRef.current; const engine = engineRef.current;
  const phase = state?.room?.phase;
  const players: Player[] = engine ? engine.players : [];
  const inGame = !!state?.role && !!phase && phase !== 'LOBBY';
  const me = players.find((p) => p.isHuman);
  const isAssassin = state?.role?.role === 'assassin';
  const partnerNames = (state?.role?.partners ?? []).map((pid) => state?.role?.players.find((p) => p.pid === pid)?.name).filter(Boolean);
  const avatar = (color: string) => (engine ? engine.getAvatar(color) : '');
  const headshot = (p: Player) => (engine ? engine.getHeadshot(p.id, !p.isAlive) : '');

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#e9e4ff] font-sans text-slate-700 select-none">
      <div ref={hostRef} className="absolute inset-0"
        onMouseDown={() => { if (inGame && (phase === 'PLAYING' || phase === 'ROLE_REVEAL') && !lockedRef.current && me?.isAlive) engine?.requestLock(); }} />

      {fatal && <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/90 p-6 text-center"><div><h2 className="text-2xl font-bold">3D graphics unavailable</h2><p className="mt-2 text-slate-500">{fatal}</p></div></div>}

      {/* top-right: sound + leave (in game) */}
      <div className="absolute right-4 top-4 z-40 flex gap-2">
        {inGame && <button className="rounded-full bg-white/80 p-2 shadow hover:bg-white" title="Leave game" onClick={() => session?.leave()}><LogOut size={18} /></button>}
        <button className="rounded-full bg-white/80 p-2 shadow hover:bg-white" title="Toggle sound (M)" onClick={() => { const m = !muted; sounds.setMuted(m); setMuted(m); }}>
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
      </div>

      {state && session && !state.room && (
        <Hub session={session} state={state} name={name} setName={setName} onExit={onExit} inviteCode={inviteCode} />
      )}

      {state && session && state.room && phase === 'LOBBY' && <PartyRoom session={session} state={state} avatar={avatar} />}

      {inGame && phase === 'PLAYING' && hud && (
        <GameHud hud={hud} locked={locked} hitKey={hitKey} toast={toast} onResume={() => engine?.requestLock()}
          pauseNote="This is a live online match — the round keeps going while you're paused!" touch={touch} engine={engine} />
      )}

      {inGame && phase === 'ROLE_REVEAL' && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/85 text-center backdrop-blur-md">
          <div className="animate-fadeIn">
            <p className="text-sm font-bold uppercase tracking-[0.3em] text-slate-400">Your secret role</p>
            <h2 className={`mt-2 text-5xl font-black ${isAssassin ? 'text-rose-500' : 'text-teal-500'}`}>{isAssassin ? 'SECRET ASSASSIN' : 'INNOCENT PAINTER'}</h2>
            <p className="mx-auto mt-3 max-w-md text-slate-500">{isAssassin
              ? (touch ? 'Tap 💀 for your concealed lethal pistol. Anyone watching can see it in your hand — strike when no one is looking, then switch back to 🎨.'
                : 'Press [2] for your concealed lethal pistol. Anyone watching can see it in your hand — strike when no one is looking, then switch back to [1].')
              : (touch ? 'Spray paint, watch for anyone holding a dark pistol, and tap 🚨 Report near a fallen body.' : 'Spray paint, watch for anyone holding a dark pistol, and press [E] near a fallen body to call a meeting.')}</p>
            {isAssassin && partnerNames.length > 0 && <p className="mt-3 font-bold text-rose-500">Your fellow assassin: {partnerNames.join(', ')}</p>}
            <p className="mt-6 text-xs text-slate-400">{touch ? 'Tap to start' : 'Click to capture the mouse'}</p>
          </div>
        </div>
      )}

      {inGame && (phase === 'MEETING' || phase === 'VOTE_REVEAL') && state?.meeting && session && (
        <OnlineMeeting session={session} state={state} players={players} headshot={headshot} revealing={phase === 'VOTE_REVEAL' && !!state.tally} />
      )}
      {inGame && phase === 'VOTE_REVEAL' && !state?.meeting && state?.tally && session && (
        <OnlineMeeting session={session} state={{ ...state, meeting: { reason: 'Vote results', reporterPid: -1, kind: 'button', secondsLeft: 0, tieCount: state.tally.tieCount, revote: false, endsAt: 0 } }} players={players} headshot={headshot} revealing />
      )}

      {state?.ended && (phase === 'ENDED' || inGame) && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/70 p-4 backdrop-blur-md">
          <div className="w-full max-w-md animate-fadeIn rounded-3xl bg-white p-8 text-center shadow-2xl">
            {(() => {
              const won = (state.ended.winner === 'ASSASSIN') === isAssassin;
              return <h2 className={`text-3xl font-black ${won ? 'text-teal-500' : 'text-rose-500'}`}>{won ? 'VICTORY' : 'DEFEAT'} — {state.ended.winner === 'ASSASSIN' ? 'ASSASSIN WINS' : 'PAINTERS WIN'}</h2>;
            })()}
            <p className="mt-3 text-slate-500">{state.ended.reason}</p>
            <p className="mt-2 flex items-center justify-center gap-1 text-sm font-bold text-slate-600"><Crosshair size={14} />The Assassin{state.ended.assassins.length > 1 ? 's were' : ' was'} {state.ended.assassins.map((a) => a.name).join(' & ')}</p>
            <p className="mt-4 text-xs text-slate-400">Returning everyone to the party room…</p>
            <Btn kind="ghost" className="mt-4" onClick={() => session?.leave()}><LogOut size={16} />Leave party</Btn>
          </div>
        </div>
      )}

      {toast && phase !== 'PLAYING' && (
        <div className={`pointer-events-none absolute left-1/2 top-5 z-50 -translate-x-1/2 animate-fadeIn rounded-full px-5 py-2 text-sm font-bold text-white shadow-lg ${toast.tone === 'kill' ? 'bg-rose-500' : toast.tone === 'warn' ? 'bg-amber-500' : 'bg-indigo-500'}`}>{toast.text}</div>
      )}
    </div>
  );
}
