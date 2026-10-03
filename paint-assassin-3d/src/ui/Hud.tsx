// In-game HUD shared by solo and online modes: role banner, crosshair + hit marker, prompts, hotbar, toasts, pause.
import { Skull, Palette } from 'lucide-react';
import type { HudState } from '../types';
import type { Game3D } from '../game/Game3D';
import { TouchControls } from './TouchControls';

export interface HudToast { id: number; text: string; tone: 'info' | 'kill' | 'warn' }

interface Props {
  hud: HudState;
  locked: boolean;
  hitKey: { k: number; kind: 'hit' | 'kill' };
  toast: HudToast | null;
  onResume: () => void;
  /** online: extra line for the pause card (e.g. "the round keeps going") */
  pauseNote?: string;
  /** phone/tablet: on-screen controls replace mouse + keyboard */
  touch?: boolean;
  engine?: Game3D | null;
}

export function GameHud({ hud, locked, hitKey, toast, onResume, pauseNote, touch = false, engine = null }: Props) {
  const isAssassin = hud.role === 'assassin';
  return (
    <>
      <div className="pointer-events-none absolute left-3 top-3 z-20 w-52 rounded-2xl bg-white/80 p-2.5 shadow-lg backdrop-blur sm:left-4 sm:top-4 sm:w-72 sm:p-3">
        <div className={`flex items-center gap-2 text-sm font-extrabold tracking-wide ${isAssassin ? 'text-rose-500' : 'text-teal-600'}`}>
          {isAssassin ? <Skull size={16} /> : <Palette size={16} />}{isAssassin ? 'SECRET ASSASSIN' : 'INNOCENT PAINTER'}
        </div>
        <p className="mt-1 text-xs leading-snug text-slate-500">
          {isAssassin ? (touch ? 'Tap 💀 for your hidden lethal pistol. Strike lone painters, then blend in.' : 'Press [2] for your hidden lethal pistol. Strike lone painters, then blend in.') : 'Paint the studio, stay in groups and find the Assassin.'}
        </p>
        {isAssassin && (
          <div className="mt-2">
            <div className="flex justify-between text-[11px] font-bold">
              <span>Lethal pistol</span><span className={hud.killCooldown > 0 ? 'text-amber-600' : 'text-emerald-600'}>{hud.killCooldown > 0 ? `${Math.ceil(hud.killCooldown)}s` : 'READY'}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-rose-400 transition-[width]" style={{ width: `${(1 - hud.killCooldown / hud.killCooldownMax) * 100}%` }} /></div>
          </div>
        )}
      </div>
      <div className="pointer-events-none absolute right-16 top-4 z-20 rounded-full bg-white/80 px-4 py-2 text-sm font-bold shadow backdrop-blur">
        Alive {hud.aliveCount}/{hud.totalCount}
      </div>

      {/* crosshair + hit marker */}
      {hud.humanAlive && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
          <div className="relative h-8 w-8">
            <span className="absolute left-1/2 top-0 h-2.5 w-[2px] -translate-x-1/2 bg-white shadow-[0_0_2px_#000]" />
            <span className="absolute bottom-0 left-1/2 h-2.5 w-[2px] -translate-x-1/2 bg-white shadow-[0_0_2px_#000]" />
            <span className="absolute left-0 top-1/2 h-[2px] w-2.5 -translate-y-1/2 bg-white shadow-[0_0_2px_#000]" />
            <span className="absolute right-0 top-1/2 h-[2px] w-2.5 -translate-y-1/2 bg-white shadow-[0_0_2px_#000]" />
            <span className="absolute left-1/2 top-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_2px_#000]" />
          </div>
          {hitKey.k > 0 && (
            <div key={hitKey.k} className="hit-marker absolute left-1/2 top-1/2" style={{ color: hitKey.kind === 'kill' ? '#ff3b5c' : '#ffffff' }}>
              <i style={{ transform: 'rotate(45deg) translate(7px,0)' }} /><i style={{ transform: 'rotate(135deg) translate(7px,0)' }} />
              <i style={{ transform: 'rotate(225deg) translate(7px,0)' }} /><i style={{ transform: 'rotate(315deg) translate(7px,0)' }} />
            </div>
          )}
        </div>
      )}

      {/* proximity prompt */}
      {hud.humanAlive && (hud.nearBody || hud.nearButton) && (
        <div className="pointer-events-none absolute left-1/2 top-[58%] z-20 -translate-x-1/2 rounded-xl bg-black/60 px-4 py-2 text-sm font-bold text-white shadow-lg">
          {hud.nearBody ? <>{!touch && <kbd className="rounded bg-white px-1.5 py-0.5 text-slate-800">E</kbd>} Report Fallen Body</>
            : hud.buttonCooldown > 0 ? <>Emergency button recharging… {hud.buttonCooldown}s</>
            : <>{!touch && <kbd className="rounded bg-white px-1.5 py-0.5 text-slate-800">E</kbd>} Emergency Meeting</>}
        </div>
      )}

      {!hud.humanAlive && (
        <div className="pointer-events-none absolute bottom-8 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/60 px-5 py-2 text-sm font-bold text-white">
          You were eliminated — spectating
        </div>
      )}

      {/* Minecraft-style hotbar */}
      {hud.humanAlive && (
        <div className={`pointer-events-none absolute ${touch ? 'bottom-3 scale-75' : 'bottom-5'} left-1/2 z-20 flex -translate-x-1/2 gap-1 rounded-sm border-[3px] border-black/50 bg-black/40 p-1 backdrop-blur-sm`}>
          {(isAssassin ? [0, 1] : [0]).map((i) => {
            const active = hud.activeSlot === i;
            const cd = i === 1 && hud.killCooldown > 0;
            return (
              <div key={i} className={`relative flex h-14 w-14 items-center justify-center border-[3px] bg-[#8b8b8b]/45 text-2xl transition-transform ${active ? 'z-10 scale-110 border-white' : 'border-[#3b3b3b]/80'}`}>
                <span className="drop-shadow">{i === 0 ? '🎨' : '💀'}</span>
                <span className="absolute left-1 top-0 text-[10px] font-bold text-white drop-shadow-[0_1px_0_#000]">{i + 1}</span>
                {cd && (<>
                  <div className="absolute inset-x-0 bottom-0 bg-black/65" style={{ height: `${(hud.killCooldown / hud.killCooldownMax) * 100}%` }} />
                  <span className="absolute text-sm font-extrabold text-white drop-shadow-[0_1px_1px_#000]">{Math.ceil(hud.killCooldown)}</span>
                </>)}
              </div>
            );
          })}
        </div>
      )}

      {toast && (
        <div className={`pointer-events-none absolute left-1/2 top-16 z-30 -translate-x-1/2 animate-fadeIn rounded-full px-5 py-2 text-sm font-bold text-white shadow-lg ${toast.tone === 'kill' ? 'bg-rose-500' : toast.tone === 'warn' ? 'bg-amber-500' : 'bg-indigo-500'}`}>
          {toast.text}
        </div>
      )}

      {touch && locked && hud.humanAlive && <TouchControls engine={engine} hud={hud} />}

      {/* paused / pointer unlocked */}
      {!locked && hud.humanAlive && (
        <div className="absolute inset-0 z-40 flex cursor-pointer items-center justify-center bg-slate-900/45 backdrop-blur-sm"
          onClick={onResume}>
          <div className="rounded-3xl bg-white/95 px-10 py-8 text-center shadow-2xl">
            <h2 className="text-2xl font-extrabold">Paused</h2>
            <p className="mt-1 text-slate-500">{touch ? 'Tap anywhere to resume' : 'Click anywhere to capture the mouse and resume'}</p>
            {pauseNote && <p className="mt-1 text-sm font-semibold text-amber-600">{pauseNote}</p>}
            <p className="mt-4 text-xs text-slate-400">{touch ? 'Left thumb: move · Right thumb: look · PAINT/SHOOT: fire (drag to aim) · 🚨 report' : 'WASD move · Mouse look · Click fire · 1/2 or wheel switch · E report/interact · M mute'}</p>
          </div>
        </div>
      )}
    </>
  );
}
