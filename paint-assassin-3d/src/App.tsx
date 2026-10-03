import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, RotateCcw, AlertTriangle, Crosshair, User, Palette, Globe } from 'lucide-react';
import { sounds } from './sound';
import { GameHud } from './ui/Hud';
import { isTouchDevice } from './ui/TouchControls';
import type { HudToast } from './ui/Hud';
import { Game3D, COLORS } from './game/Game3D';
import type { GamePhase, RolePref, HudState, ChatMessage, VoteRecord, Player, EngineCallbacks, MeetingInfo } from './types';

const ZONES = ['north hall', 'south hall', 'east gallery', 'west gallery', 'central rotunda'];
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const LS_NAME = 'paint_assassin_display_name';
const LS_COLOR = 'paint_assassin_player_color';
const ls = (k: string, d: string): string => {
  try { return localStorage.getItem(k) || d; } catch { return d; }
};

type Toast = HudToast;

export default function App({ onMultiplayer }: { onMultiplayer?: () => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<Game3D | null>(null);
  const phaseRef = useRef<GamePhase>('LOBBY');
  const timers = useRef<number[]>([]);
  const tieTimer = useRef<number | null>(null);
  const toastId = useRef(0);
  const lockedRef = useRef(false);

  const [fatal, setFatal] = useState<string>('');
  const [touch] = useState(isTouchDevice);
  const [phase, setPhase] = useState<GamePhase>('LOBBY');
  const [locked, setLocked] = useState(false);
  const [muted, setMuted] = useState(false);
  const [hud, setHud] = useState<HudState | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [hitKey, setHitKey] = useState<{ k: number; kind: 'hit' | 'kill' }>({ k: 0, kind: 'hit' });

  // lobby
  const [playerName, setPlayerName] = useState(() => ls(LS_NAME, 'Painter'));
  const [playerColor, setPlayerColor] = useState(() => ls(LS_COLOR, COLORS[0]));
  const [playerCount, setPlayerCount] = useState(8);
  const [rolePref, setRolePref] = useState<RolePref>('random');

  // meeting / voting
  const [meeting, setMeeting] = useState<MeetingInfo | null>(null);
  const [chatLog, setChatLog] = useState<ChatMessage[]>([]);
  const [hasVoted, setHasVoted] = useState(false);
  const [selected, setSelected] = useState<number | null | 'skip'>(null);
  const [votes, setVotes] = useState<VoteRecord[]>([]);
  const [revealing, setRevealing] = useState(false);
  const [resultTitle, setResultTitle] = useState('');
  const [resultSub, setResultSub] = useState('');
  const [ejected, setEjected] = useState<Player | null>(null);
  const [tieCount, setTieCount] = useState(0);
  const [isTie, setIsTie] = useState(false);
  const [, force] = useState(0); // re-render after players mutate

  // game over
  const [over, setOver] = useState<{ title: string; desc: string; win: boolean; assassin: string } | null>(null);

  const setBoth = (p: GamePhase) => {
    phaseRef.current = p; setPhase(p); engineRef.current?.setPhase(p);
  };
  const later = (fn: () => void, ms: number) => { const id = window.setTimeout(fn, ms); timers.current.push(id); return id; };
  const showToast = (text: string, tone: Toast['tone']) => {
    const id = ++toastId.current; setToast({ id, text, tone });
    later(() => setToast((t) => (t && t.id === id ? null : t)), 2600);
  };

  // ------------------------------------------------------------------ engine wiring
  // The engine gets one stable callback object that always forwards to the latest handlers.
  const handlers = useRef<EngineCallbacks | null>(null);
  handlers.current = {
    onHud: setHud,
    onHit: (kind) => setHitKey((h) => ({ k: h.k + 1, kind })),
    onToast: showToast,
    onMeeting: (info) => beginMeeting(info),
    onGameOver: () => finishGame('assassin'),
    onLockChange: (l) => { lockedRef.current = l; setLocked(l); },
  };

  useEffect(() => {
    const host = hostRef.current; if (!host) return;
    let g: Game3D | null = null;
    try {
      g = new Game3D(host, {
        onHud: (s) => handlers.current?.onHud(s),
        onHit: (k) => handlers.current?.onHit(k),
        onToast: (t, tone) => handlers.current?.onToast(t, tone),
        onMeeting: (i) => handlers.current?.onMeeting(i),
        onGameOver: (r) => handlers.current?.onGameOver(r),
        onLockChange: (l) => handlers.current?.onLockChange(l),
      });
      engineRef.current = g;
      g.setTouchMode(touch);
    } catch (e) {
      setFatal(e instanceof Error ? e.message : 'WebGL is not available in this browser.');
    }
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.code === 'KeyM') { const m = !sounds.isMuted(); sounds.setMuted(m); setMuted(m); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      timers.current.forEach((id) => window.clearTimeout(id)); timers.current = [];
      if (tieTimer.current) window.clearTimeout(tieTimer.current);
      g?.dispose(); engineRef.current = null;
    };
  }, []);

  // ------------------------------------------------------------------ round flow
  const startRound = () => {
    const g = engineRef.current; if (!g) return;
    const name = playerName.trim() || 'Painter';
    try { localStorage.setItem(LS_NAME, name); localStorage.setItem(LS_COLOR, playerColor); } catch { /* storage unavailable */ }
    sounds.playVote();
    if (tieTimer.current) { window.clearTimeout(tieTimer.current); tieTimer.current = null; }
    setTieCount(0); setIsTie(false); setOver(null); setMeeting(null); setToast(null);
    g.startRound({ playerCount, humanName: name, humanColor: playerColor, rolePref }); // user gesture -> pointer lock
    phaseRef.current = 'ROLE_REVEAL'; setPhase('ROLE_REVEAL');
    later(() => { if (phaseRef.current === 'ROLE_REVEAL') setBoth('PLAYING'); }, 3000);
  };

  const finishGame = (winner: 'assassin' | 'painters') => {
    const g = engineRef.current; if (!g) return;
    if (phaseRef.current === 'GAME_OVER') return;
    if (tieTimer.current) { window.clearTimeout(tieTimer.current); tieTimer.current = null; }
    const assassin = g.players.find((p) => p.isAssassin);
    const human = g.players.find((p) => p.isHuman);
    const win = !!human && ((winner === 'assassin') === human.isAssassin);
    if (win) sounds.playVictory(); else sounds.playDefeat();
    setOver(winner === 'painters'
      ? { title: win ? 'VICTORY — PAINTERS WIN!' : 'DEFEAT — YOU WERE FOOLED', desc: `The Assassin (${assassin?.name}) was caught and ejected. The studio is safe again.`, win, assassin: assassin?.name ?? '?' }
      : { title: win ? 'VICTORY — ASSASSIN WINS!' : 'DEFEAT — ASSASSIN WINS', desc: `${assassin?.name} eliminated the painters without being stopped.`, win, assassin: assassin?.name ?? '?' });
    setBoth('GAME_OVER');
  };

  const playAgain = () => {
    engineRef.current?.resetToLobby();
    setOver(null); setMeeting(null); setHud(null); setBoth('LOBBY');
  };

  // ------------------------------------------------------------------ meeting / banter
  const beginMeeting = (info: MeetingInfo) => {
    const g = engineRef.current; if (!g) return;
    if (tieTimer.current) { window.clearTimeout(tieTimer.current); tieTimer.current = null; }
    setTieCount(0); setIsTie(false); setMeeting(info); setSelected(null); setHasVoted(false);
    setVotes([]); setRevealing(false); setResultTitle(''); setResultSub(''); setEjected(null);
    setBoth('MEETING');
    setChatLog(buildBanter(g, info));
    force((n) => n + 1);
    const human = g.players.find((p) => p.isHuman);
    if (human && !human.isAlive) later(() => castVote('spectate'), 3200); // spectators watch the bots vote
  };

  const buildBanter = (g: Game3D, info: MeetingInfo): ChatMessage[] => {
    const out: ChatMessage[] = [{ senderId: -1, senderName: 'SYSTEM', senderColor: '#7c83fd', text: `🚨 ${info.reason}` }];
    const alive = g.players.filter((p) => p.isAlive);
    const accusations: Record<number, number> = {};
    for (const bot of alive.filter((p) => !p.isHuman)) {
      const say = (text: string) => out.push({ senderId: bot.id, senderName: bot.name, senderColor: bot.color, text });
      const others = alive.filter((p) => p.id !== bot.id);
      if (bot.witnessedKillerId !== null && Math.random() < 0.85) {
        const killer = g.players.find((p) => p.id === bot.witnessedKillerId);
        if (killer && killer.isAlive && killer.id !== bot.id) {
          say(`I SAW ${killer.name} pull out a lethal gun! It has to be them!`);
          accusations[killer.id] = (accusations[killer.id] || 0) + 2; continue;
        }
      }
      if (bot.isAssassin) {
        const scapegoat = pick(others.filter((p) => !p.isHuman || Math.random() < 0.5).concat(others));
        if (scapegoat && Math.random() < 0.7) {
          say(pick([
            `I saw ${scapegoat.name} walking away from the ${pick(ZONES)} right before the alarm!`,
            `${scapegoat.name} was acting really suspicious near the ${pick(ZONES)}...`,
          ]));
          accusations[scapegoat.id] = (accusations[scapegoat.id] || 0) + 1;
        } else say(pick([`I was just splatting walls in the ${pick(ZONES)}. Check my gun, it's only paint!`, `Don't look at me! I never even went near the body.`]));
        continue;
      }
      // innocent: report who they actually saw recently, and where
      const recent = others.filter((p) => bot.seen[p.id] && g.getTime() - bot.seen[p.id].t < 70);
      if (recent.length && Math.random() < 0.7) {
        const who = pick(recent);
        say(`I saw ${who.name} in the ${bot.seen[who.id].zone} just before the alarm.`);
        if (Math.random() < 0.5) accusations[who.id] = (accusations[who.id] || 0) + 0.6;
      } else if (Math.random() < 0.6) {
        say(pick([`I was practicing paint splats in the ${pick(ZONES)}, saw nothing.`, `Careful with the vote, we can't afford to lose more painters!`, `I'm skipping unless someone has real evidence.`]));
      }
    }
    // gossip shifts what the other bots believe
    for (const b of alive.filter((p) => !p.isHuman && !p.isAssassin)) {
      for (const id in accusations) if (+id !== b.id) b.suspicion[+id] = (b.suspicion[+id] || 0) + accusations[+id] * 0.5;
    }
    return out;
  };

  // ------------------------------------------------------------------ voting
  const botBallot = (bot: Player, alive: Player[]): number | null => {
    if (bot.witnessedKillerId !== null && Math.random() < 0.9 && alive.some((p) => p.id === bot.witnessedKillerId)) return bot.witnessedKillerId;
    const cands = alive.filter((p) => p.id !== bot.id);
    if (bot.isAssassin) { // blend in: follow the loudest suspicion on an innocent, or skip
      const inn = cands.filter((p) => !p.isAssassin);
      let best: Player | null = null, bs = 0.4;
      for (const p of inn) { const s = alive.reduce((a, o) => a + ((o.suspicion && !o.isAssassin ? o.suspicion[p.id] : 0) || 0), 0) + Math.random(); if (s > bs) { bs = s; best = p; } }
      return best && Math.random() < 0.8 ? best.id : null;
    }
    let best: Player | null = null, bs = 1.1;
    for (const p of cands) { const s = (bot.suspicion[p.id] || 0) + Math.random() * 0.7; if (s > bs) { bs = s; best = p; } }
    return best ? best.id : null; // null = skip
  };

  const castVote = (target: number | null | 'spectate') => {
    const g = engineRef.current; if (!g || phaseRef.current !== 'MEETING') return;
    if (target !== 'spectate') { if (hasVoted) return; setHasVoted(true); setSelected(target); sounds.playVote(); }
    else setHasVoted(true);
    const players = g.players; const alive = players.filter((p) => p.isAlive);
    const records: VoteRecord[] = [];
    if (target !== 'spectate') records.push({ voterId: 0, targetId: target });
    alive.filter((p) => !p.isHuman).forEach((bot) => records.push({ voterId: bot.id, targetId: botBallot(bot, alive) }));
    setVotes(records); setRevealing(true);

    const counts: Record<number, number> = {}; let skip = 0;
    records.forEach((r) => { if (r.targetId === null) skip++; else counts[r.targetId] = (counts[r.targetId] || 0) + 1; });
    let max = 0, topId: number | null = null, playerTie = false;
    Object.entries(counts).forEach(([k, c]) => { if (c > max) { max = c; topId = +k; playerTie = false; } else if (c === max && max > 0) playerTie = true; });
    const tie = max > 0 && (playerTie || skip === max);
    const skipped = max === 0 || (!tie && skip > max);

    later(() => {
      if (phaseRef.current !== 'MEETING') return;
      sounds.playEject();
      if (tie) {
        const n = tieCount + 1; setTieCount(n); setIsTie(true); setEjected(null);
        if (n >= 3) {
          setResultTitle('Tied 3 times — meeting cancelled!');
          setResultSub('No agreement could be reached. Everyone returns to the arena…');
          tieTimer.current = window.setTimeout(() => continueAfterVote(), 3400);
        } else {
          setResultTitle(`Tie Vote! (Tie #${n} of 3)`);
          setResultSub(`You must vote again. ${3 - n} more tie${3 - n === 1 ? '' : 's'} and the meeting is cancelled.`);
        }
      } else if (skipped) {
        setIsTie(false); setEjected(null); setResultTitle('Vote Skipped'); setResultSub('Most painters skipped. No one was ejected.');
      } else {
        setIsTie(false); setTieCount(0);
        const victim = players.find((p) => p.id === topId);
        if (victim) {
          g.ejectPlayer(victim.id); setEjected(victim);
          setResultTitle(`${victim.name} was ejected (${max} vote${max === 1 ? '' : 's'})`);
          setResultSub(victim.isAssassin ? `${victim.name} WAS the Assassin! The painters are safe!` : `${victim.name} was NOT the Assassin. The killer is still out there…`);
        }
      }
      setBoth('VOTE_REVEAL'); force((n) => n + 1);
    }, 1600);
  };

  const revote = () => {
    if (tieTimer.current) { window.clearTimeout(tieTimer.current); tieTimer.current = null; }
    const g = engineRef.current; if (!g) return;
    sounds.playVote();
    setSelected(null); setHasVoted(false); setVotes([]); setRevealing(false); setResultTitle(''); setResultSub(''); setEjected(null);
    const bots = g.players.filter((p) => !p.isHuman && p.isAlive);
    setChatLog((c) => [...c,
      { senderId: -1, senderName: 'SYSTEM', senderColor: '#f59e0b', text: `Tie #${tieCount} — revote ${tieCount + 1} of 3 begins!` },
      ...(bots.length ? [{ senderId: bots[0].id, senderName: bots[0].name, senderColor: bots[0].color, text: pick(['Tie! We need to agree on someone…', `I'm changing my vote this round.`, 'Three ties and we all go back to the killer!']) }] : []),
    ]);
    setBoth('MEETING');
    const human = g.players.find((p) => p.isHuman);
    if (human && !human.isAlive) later(() => castVote('spectate'), 2500);
  };

  const continueAfterVote = () => {
    const g = engineRef.current; if (!g) return;
    if (tieTimer.current) { window.clearTimeout(tieTimer.current); tieTimer.current = null; }
    setTieCount(0); setIsTie(false);
    const assassin = g.players.find((p) => p.isAssassin);
    const innocents = g.players.filter((p) => !p.isAssassin && p.isAlive).length;
    if (!assassin || !assassin.isAlive) { finishGame('painters'); return; }
    if (innocents <= 1) { finishGame('assassin'); return; }
    g.endMeeting(); setMeeting(null); setBoth('PLAYING'); g.requestLock();
  };

  // ------------------------------------------------------------------ view helpers
  const g = engineRef.current;
  const players = g ? g.players : [];
  const head = (p: Player): string => (g ? g.getHeadshot(p.id, !p.isAlive) : '');
  const voteCount = (id: number) => votes.filter((v) => v.targetId === id).length;
  const skipCount = votes.filter((v) => v.targetId === null).length;
  const human = players.find((p) => p.isHuman);
  const isAssassin = !!hud && hud.role === 'assassin';
  const inRound = phase === 'PLAYING' || phase === 'ROLE_REVEAL';

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#e9e4ff] font-sans text-slate-700 select-none">
      <div ref={hostRef} className="absolute inset-0" onMouseDown={() => { if (inRound && !lockedRef.current && (human?.isAlive ?? true)) engineRef.current?.requestLock(); }} />

      {fatal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/90 p-6 text-center">
          <div><h2 className="text-2xl font-bold">3D graphics unavailable</h2><p className="mt-2 text-slate-500">{fatal}</p><p className="mt-1 text-slate-500">Enable hardware acceleration / WebGL and reload.</p></div>
        </div>
      )}

      {/* ---------------- top-right: sound ---------------- */}
      <button className="absolute right-4 top-4 z-30 rounded-full bg-white/80 p-2 shadow hover:bg-white" title="Toggle sound (M)"
        onClick={() => { const m = !muted; sounds.setMuted(m); setMuted(m); }}>
        {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>

      {/* ---------------- HUD ---------------- */}
      {phase === 'PLAYING' && hud && (
        <GameHud hud={hud} locked={locked} hitKey={hitKey} toast={toast} onResume={() => engineRef.current?.requestLock()} touch={touch} engine={engineRef.current} />
      )}

      {/* ---------------- Lobby ---------------- */}
      {phase === 'LOBBY' && (
        <div className="absolute inset-0 z-30 flex items-start justify-center overflow-y-auto bg-gradient-to-b from-white/30 to-indigo-100/50 p-4 sm:items-center">
          <div className="w-full max-w-md animate-fadeIn rounded-3xl bg-white/90 p-7 shadow-2xl backdrop-blur">
            <h1 className="bg-gradient-to-r from-indigo-500 to-pink-400 bg-clip-text text-center text-4xl font-black tracking-tight text-transparent">Paint Assassin 3D</h1>
            <p className="mt-1 text-center text-sm text-slate-500">One painter's gun is secretly lethal. Find them before it's too late.</p>

            <label className="mt-5 block text-xs font-bold uppercase tracking-wide text-slate-400"><User size={12} className="mr-1 inline" />Display name</label>
            <input value={playerName} maxLength={12} onChange={(e) => setPlayerName(e.target.value)}
              className="mt-1 w-full rounded-xl border-2 border-slate-200 px-3 py-2 font-semibold outline-none focus:border-indigo-400" />

            <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-400"><Palette size={12} className="mr-1 inline" />Suit color</label>
            <div className="mt-2 grid grid-cols-6 gap-2">
              {COLORS.map((c) => (
                <button key={c} onClick={() => setPlayerColor(c)} aria-label={`Color ${c}`}
                  className={`h-8 rounded-full border-4 transition-transform hover:scale-110 ${playerColor === c ? 'scale-110 border-slate-700' : 'border-white'}`} style={{ background: c }} />
              ))}
            </div>

            <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-400">Players: <b className="text-slate-700">{playerCount}</b></label>
            <input type="range" min={4} max={12} value={playerCount} onChange={(e) => setPlayerCount(+e.target.value)} className="mt-1 w-full accent-indigo-500" />

            <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-400">Role</label>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {(['random', 'innocent', 'assassin'] as RolePref[]).map((r) => (
                <button key={r} onClick={() => setRolePref(r)} className={`rounded-xl px-2 py-2 text-sm font-bold capitalize transition ${rolePref === r ? 'bg-indigo-500 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{r}</button>
              ))}
            </div>

            <button onClick={startRound} disabled={!!fatal}
              className="mt-6 w-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 py-3 text-lg font-extrabold text-white shadow-lg transition hover:scale-[1.02] active:scale-95 disabled:opacity-50">
              Start Round
            </button>
            {onMultiplayer && (
              <button onClick={onMultiplayer}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border-2 border-indigo-200 bg-white py-2.5 font-extrabold text-indigo-600 transition hover:bg-indigo-50">
                <Globe size={18} /> Play Online with Friends
              </button>
            )}
            <p className="mt-3 text-center text-[11px] text-slate-400">{touch ? 'Phone controls: left thumb moves, right thumb looks, big button fires. Landscape works best!' : 'WASD move · Mouse look · Click fire · 1/2 or wheel switch · E report/interact · Esc pause'}</p>
          </div>
        </div>
      )}

      {/* ---------------- Role reveal ---------------- */}
      {phase === 'ROLE_REVEAL' && hud && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/85 text-center backdrop-blur-md">
          <div className="animate-fadeIn">
            <p className="text-sm font-bold uppercase tracking-[0.3em] text-slate-400">Your role</p>
            <h2 className={`mt-2 text-5xl font-black ${isAssassin ? 'text-rose-500' : 'text-teal-500'}`}>{isAssassin ? 'SECRET ASSASSIN' : 'INNOCENT PAINTER'}</h2>
            <p className="mx-auto mt-3 max-w-md text-slate-500">{isAssassin ? (touch ? 'Tap 💀 to draw your concealed lethal pistol.' : 'Press [2] to draw your concealed lethal pistol.') + ' Strike unseen, then switch back to paint and blend in. Reporting a body you caused is risky!' : 'Spray paint, stay alert, and report any fallen body with [E]. Then vote out the Assassin.'}</p>
            <p className="mt-6 text-xs text-slate-400">Click if your mouse isn't captured</p>
          </div>
        </div>
      )}

      {/* ---------------- Emergency meeting board ---------------- */}
      {(phase === 'MEETING' || phase === 'VOTE_REVEAL') && meeting && (
        <div className={`absolute inset-0 z-30 flex items-center justify-center p-3 ${phase === 'MEETING' ? 'bg-slate-900/50 backdrop-blur-sm' : 'pointer-events-none bg-slate-900/10'}`}>
          <div className={`flex max-h-full w-full max-w-5xl animate-fadeIn flex-col gap-3 rounded-3xl bg-white/95 p-4 shadow-2xl md:flex-row ${phase === 'VOTE_REVEAL' ? 'translate-y-[14vh] scale-95 opacity-95' : ''}`}>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-xl font-extrabold"><AlertTriangle className="text-rose-500" size={22} />Who is the Assassin?</h2>
                {tieCount > 0 && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">Tie #{Math.min(tieCount, 3)} of 3</span>}
              </div>
              <p className="mt-1 text-sm text-slate-500">{meeting.reason}</p>
              <div className="mt-3 grid grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4 lg:grid-cols-6">
                {players.map((p) => {
                  const canPick = phase === 'MEETING' && !hasVoted && p.isAlive && !p.isHuman && !!human?.isAlive;
                  const n = revealing ? voteCount(p.id) : 0;
                  return (
                    <button key={p.id} disabled={!canPick} onClick={() => castVote(p.id)}
                      className={`pointer-events-auto relative rounded-2xl border-2 bg-white p-2 text-center transition ${!p.isAlive ? 'opacity-45' : canPick ? 'hover:-translate-y-0.5 hover:shadow-lg' : ''} ${selected === p.id ? 'border-indigo-500' : 'border-slate-100'}`}>
                      <div className="mx-auto h-16 w-16 overflow-hidden rounded-full" style={{ background: p.color + '55' }}>
                        <img src={head(p)} alt={p.name} className="h-full w-full object-cover" draggable={false} />
                      </div>
                      <div className="mt-1 truncate text-sm font-bold">{p.isHuman ? `${p.name} (you)` : p.name}</div>
                      <div className={`text-[10px] font-bold uppercase ${p.isAlive ? 'text-emerald-500' : 'text-slate-400'}`}>{p.isAlive ? 'Alive' : 'Eliminated'}</div>
                      {n > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-white animate-scaleIn">{n}</span>}
                    </button>
                  );
                })}
              </div>
              {phase === 'MEETING' && (
                <div className="mt-3 flex items-center gap-3">
                  <button disabled={hasVoted || !human?.isAlive} onClick={() => castVote(null)}
                    className={`rounded-full px-5 py-2 text-sm font-bold ${selected === null && hasVoted ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'} disabled:opacity-50`}>Skip vote</button>
                  <span className="text-xs text-slate-400">{!human?.isAlive ? 'You are eliminated — spectating the vote…' : hasVoted ? 'Vote locked in — counting…' : 'Click a painter to vote'}{revealing && skipCount > 0 ? ` · ${skipCount} skipped` : ''}</span>
                </div>
              )}
              {phase === 'VOTE_REVEAL' && (
                <div className="pointer-events-auto mt-3 rounded-2xl bg-indigo-50 p-3">
                  <div className="text-lg font-extrabold">{resultTitle}</div>
                  <div className="text-sm text-slate-500">{resultSub}</div>
                  <div className="mt-2 flex gap-2">
                    {isTie && tieCount < 3 && <button onClick={revote} className="rounded-full bg-indigo-500 px-5 py-2 text-sm font-bold text-white shadow hover:bg-indigo-600"><RotateCcw size={14} className="mr-1 inline" />Vote again</button>}
                    {(!isTie || tieCount >= 3) && <button onClick={continueAfterVote} className="rounded-full bg-indigo-500 px-5 py-2 text-sm font-bold text-white shadow hover:bg-indigo-600">Continue</button>}
                    {ejected && <span className="self-center text-xs font-bold text-slate-400">{ejected.isAssassin ? '🎨 Assassin caught' : 'Innocent ejected'}</span>}
                  </div>
                </div>
              )}
            </div>
            <div className="flex max-h-52 min-h-0 w-full flex-col rounded-2xl bg-slate-50 p-3 md:max-h-none md:w-72">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Emergency chat</div>
              <div className="flex-1 space-y-1.5 overflow-y-auto pr-1 text-sm">
                {chatLog.map((m, i) => (
                  <div key={i} className="rounded-xl bg-white px-2.5 py-1.5 shadow-sm">
                    <span className="font-bold" style={{ color: m.senderColor }}>{m.senderName}: </span><span className="text-slate-600">{m.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Game over ---------------- */}
      {phase === 'GAME_OVER' && over && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/70 p-4 backdrop-blur-md">
          <div className="w-full max-w-md animate-fadeIn rounded-3xl bg-white p-8 text-center shadow-2xl">
            <h2 className={`text-3xl font-black ${over.win ? 'text-teal-500' : 'text-rose-500'}`}>{over.title}</h2>
            <p className="mt-3 text-slate-500">{over.desc}</p>
            <p className="mt-2 flex items-center justify-center gap-1 text-sm font-bold text-slate-600"><Crosshair size={14} />The Assassin was {over.assassin}</p>
            <button onClick={playAgain} className="mt-6 w-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 py-3 text-lg font-extrabold text-white shadow-lg transition hover:scale-[1.02] active:scale-95">Play Again</button>
          </div>
        </div>
      )}
    </div>
  );
}
