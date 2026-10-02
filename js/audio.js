'use strict';
// 効果音（WebAudio で合成）
const Sfx = (() => {
  let ac = null;
  function unlock() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; } }
    if (ac.state === 'suspended') ac.resume();
  }
  function tone(type, f0, f1, dur, vol = 0.15, delay = 0) {
    if (!ac) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  return {
    unlock,
    jump(big) { tone('sine', big ? 300 : 360, big ? 900 : 720, 0.16, 0.14); },
    grab() { tone('square', 520, 260, 0.06, 0.05); },
    die() { tone('triangle', 500, 80, 0.4, 0.18); },
    checkpoint() { [660, 880].forEach((f, i) => tone('sine', f, f, 0.12, 0.12, i * 0.09)); },
    clear() { [523, 659, 784, 1046].forEach((f, i) => tone('triangle', f, f * 1.01, 0.22, 0.14, i * 0.11)); },
  };
})();
