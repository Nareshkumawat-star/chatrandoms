/**
 * Notification sounds — synthesized with the Web Audio API so no binary
 * assets are needed. Respects browser autoplay rules: the AudioContext is
 * unlocked on the first user gesture (see initSoundUnlock).
 */

let ctx: AudioContext | null = null;
let muted = typeof localStorage !== 'undefined' && localStorage.getItem('pulse-sound') === 'off';

export function isSoundMuted(): boolean {
  return muted;
}

export function setSoundMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem('pulse-sound', value ? 'off' : 'on');
  } catch {
    /* private mode */
  }
}

function getCtx(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Call once on the first user gesture so later sounds are allowed to play. */
export function initSoundUnlock(): void {
  const unlock = () => {
    getCtx();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

function tone(freq: number, start: number, duration: number, gain: number, type: OscillatorType = 'sine') {
  const c = ctx;
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime + start);
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + duration);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(c.currentTime + start);
  osc.stop(c.currentTime + start + duration + 0.05);
}

/** Soft "pop" for an incoming private message. */
export function playMessageSound(): void {
  if (!getCtx()) return;
  tone(880, 0, 0.14, 0.09);
  tone(1245, 0.09, 0.16, 0.07);
}

/** Brighter double-chirp for Global Chat activity. */
export function playGlobalPing(): void {
  if (!getCtx()) return;
  tone(660, 0, 0.1, 0.05, 'triangle');
  tone(990, 0.08, 0.12, 0.04, 'triangle');
}

/** Small click for outgoing message confirmation. */
export function playSentTick(): void {
  if (!getCtx()) return;
  tone(520, 0, 0.06, 0.035, 'square');
}
