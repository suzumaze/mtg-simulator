// Sound effects using Web Audio API (no external files needed)

const AudioCtx = window.AudioContext || window.webkitAudioContext;
let ctx = null;
let muted = localStorage.getItem('mtg-muted') === 'true';

function getCtx() {
  if (!ctx) ctx = new AudioCtx();
  return ctx;
}

export function isMuted() {
  return muted;
}

export function toggleMute() {
  muted = !muted;
  localStorage.setItem('mtg-muted', muted);
  return muted;
}

function playTone(freq, duration, type = 'sine', gain = 0.15) {
  if (muted) return;
  const c = getCtx();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(gain, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
  osc.connect(g);
  g.connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + duration);
}

export function playTap() {
  playTone(800, 0.06, 'square', 0.08);
}

export function playDraw() {
  playTone(600, 0.1, 'sine', 0.1);
}

export function playShuffle() {
  if (muted) return;
  for (let i = 0; i < 5; i++) {
    setTimeout(() => playTone(300 + Math.random() * 400, 0.04, 'square', 0.06), i * 30);
  }
}

export function playLifeChange() {
  playTone(440, 0.15, 'sine', 0.1);
}

export function playDice() {
  if (muted) return;
  for (let i = 0; i < 4; i++) {
    setTimeout(() => playTone(200 + Math.random() * 600, 0.05, 'triangle', 0.08), i * 40);
  }
}

export function playCoin() {
  playTone(1200, 0.12, 'sine', 0.1);
  setTimeout(() => playTone(1600, 0.08, 'sine', 0.08), 80);
}
