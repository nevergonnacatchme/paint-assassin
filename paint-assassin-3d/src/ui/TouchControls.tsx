// On-screen controls for phones/tablets: left-side floating joystick, right-side drag-to-look,
// a Fire button you can also drag to aim, a context Report/Meeting button, hotbar slots and pause.
import { useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import { Pause } from 'lucide-react';
import type { Game3D } from '../game/Game3D';
import type { HudState } from '../types';

export const isTouchDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  try { return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0; } catch { return false; }
};

const R = 56; // joystick radius in px

interface Props { engine: Game3D | null; hud: HudState }

export function TouchControls({ engine, hud }: Props) {
  const joy = useRef<{ id: number; ox: number; oy: number } | null>(null);
  const look = useRef<{ id: number; x: number; y: number } | null>(null);
  const fireId = useRef<number | null>(null);
  const [stick, setStick] = useState<{ ox: number; oy: number; kx: number; ky: number } | null>(null);
  const [firing, setFiring] = useState(false);

  const capture = (e: RPointerEvent) => { try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ } };

  // background: left 45% of the screen = joystick, the rest = look
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault(); capture(e);
    if (e.clientX < window.innerWidth * 0.45 && !joy.current) {
      joy.current = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      setStick({ ox: e.clientX, oy: e.clientY, kx: 0, ky: 0 });
    } else if (!look.current) look.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onMove = (e: RPointerEvent<HTMLElement>) => {
    const j = joy.current;
    if (j && e.pointerId === j.id) {
      let dx = e.clientX - j.ox, dy = e.clientY - j.oy;
      const d = Math.hypot(dx, dy); if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      engine?.setTouchMove(dx / R, -dy / R);
      setStick({ ox: j.ox, oy: j.oy, kx: dx, ky: dy });
      return;
    }
    const l = look.current;
    if (l && e.pointerId === l.id) { engine?.addLook(e.clientX - l.x, e.clientY - l.y); l.x = e.clientX; l.y = e.clientY; }
  };
  const onUp = (e: RPointerEvent<HTMLElement>) => {
    if (joy.current && e.pointerId === joy.current.id) { joy.current = null; setStick(null); engine?.setTouchMove(0, 0); }
    if (look.current && e.pointerId === look.current.id) look.current = null;
    if (fireId.current === e.pointerId) { fireId.current = null; setFiring(false); engine?.setFire(false); }
  };

  // fire button: hold to shoot, drag the same thumb to aim
  const onFireDown = (e: RPointerEvent<HTMLButtonElement>) => {
    e.preventDefault(); e.stopPropagation(); capture(e);
    fireId.current = e.pointerId; setFiring(true); engine?.setFire(true);
    if (!look.current) look.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const tap = (fn: () => void) => (e: RPointerEvent<HTMLButtonElement>) => { e.preventDefault(); e.stopPropagation(); fn(); };

  const assassin = hud.role === 'assassin';
  const interact = hud.nearBody ? 'Report' : hud.nearButton && hud.buttonCooldown <= 0 ? 'Meeting' : null;
  const btn = 'pointer-events-auto flex select-none items-center justify-center rounded-full font-black text-white shadow-lg active:scale-95';

  return (
    <div className="absolute inset-0 z-[25] touch-none select-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      onContextMenu={(e) => e.preventDefault()}>
      {/* joystick */}
      {stick ? (
        <div className="pointer-events-none absolute" style={{ left: stick.ox - R, top: stick.oy - R }}>
          <div className="rounded-full border-4 border-white/50 bg-white/15" style={{ width: R * 2, height: R * 2 }} />
          <div className="absolute rounded-full bg-white/80 shadow" style={{ width: 48, height: 48, left: R - 24 + stick.kx, top: R - 24 + stick.ky }} />
        </div>
      ) : (
        <div className="pointer-events-none absolute bottom-10 left-8 flex h-28 w-28 items-center justify-center rounded-full border-4 border-dashed border-white/40 text-[11px] font-bold text-white/70">MOVE</div>
      )}

      {/* right-hand buttons */}
      <div className="pointer-events-none absolute bottom-6 right-5 flex flex-col items-end gap-3">
        {interact && (
          <button onPointerDown={tap(() => engine?.pressInteract())} onPointerMove={onMove} onPointerUp={onUp}
            className={`${btn} h-16 w-28 animate-scaleIn bg-rose-500 text-sm`}>{interact === 'Report' ? '🚨 Report' : '🔴 Meeting'}</button>
        )}
        <div className="flex items-end gap-3">
          {assassin && (
            <div className="flex flex-col gap-2">
              {([0, 1] as const).map((i) => (
                <button key={i} onPointerDown={tap(() => engine?.selectSlot(i))}
                  className={`${btn} h-12 w-12 border-[3px] text-xl ${hud.activeSlot === i ? 'border-white bg-black/55' : 'border-white/30 bg-black/30'}`}>{i === 0 ? '🎨' : '💀'}</button>
              ))}
            </div>
          )}
          <button onPointerDown={onFireDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            className={`${btn} h-24 w-24 border-4 text-base ${firing ? 'scale-95 border-white bg-indigo-600' : 'border-white/70 bg-indigo-500/80'}`}>
            {hud.activeSlot === 1 ? (hud.killCooldown > 0 ? `${Math.ceil(hud.killCooldown)}s` : 'SHOOT') : 'PAINT'}
          </button>
        </div>
      </div>

      <button onPointerDown={tap(() => engine?.exitLock())} className={`${btn} absolute left-1/2 top-3 h-10 w-10 -translate-x-1/2 bg-black/35`} aria-label="Pause">
        <Pause size={18} />
      </button>
    </div>
  );
}
