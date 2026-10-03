// Chooses between solo play (bots) and online multiplayer. An invite link (?code=XXXXXX) opens online mode directly.
import { useState } from 'react';
import App from './App';
import OnlineApp from './online/OnlineApp';

const readCode = (): string | null => {
  try { const c = new URLSearchParams(window.location.search).get('code'); return c ? c.toUpperCase().slice(0, 6) : null; } catch { return null; }
};

export default function Root() {
  const [invite] = useState<string | null>(readCode);
  const [mode, setMode] = useState<'solo' | 'online'>(invite ? 'online' : 'solo');
  if (mode === 'online') {
    return <OnlineApp inviteCode={invite} onExit={() => { try { window.history.replaceState(null, '', window.location.pathname); } catch { /* ignore */ } setMode('solo'); }} />;
  }
  return <App onMultiplayer={() => setMode('online')} />;
}
