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
    rattle() { for (let i = 0; i < 3; i++) tone('square', 300 + i * 40, 280 + i * 40, 0.05, 0.05, i * 0.07); },
    throw() { tone('sine', 250, 700, 0.12, 0.12); tone('triangle', 180, 120, 0.08, 0.08); },
    warp() { tone('sine', 1200, 300, 0.18, 0.1); tone('sine', 400, 1400, 0.22, 0.08, 0.08); },
    stab() {
      tone('sawtooth', 900, 120, 0.09, 0.12);
      tone('square', 160, 50, 0.3, 0.16, 0.02);
    },
    die() { tone('triangle', 500, 80, 0.4, 0.18); },
    checkpoint() { [660, 880].forEach((f, i) => tone('sine', f, f, 0.12, 0.12, i * 0.09)); },
    clear() { [523, 659, 784, 1046].forEach((f, i) => tone('triangle', f, f * 1.01, 0.22, 0.14, i * 0.11)); },
  };
})();

// BGM（ループ再生。ブラウザの制限で、最初のタップ以降に鳴り始める）
const Bgm = (() => {
  const audio = new Audio('audio/bgm.mp3');
  audio.loop = true;
  audio.volume = 0.35;
  audio.preload = 'auto';
  let enabled = true;
  try { enabled = localStorage.getItem('nekoCoopBgm') !== 'off'; } catch {}
  let started = false;

  function play() {
    if (!enabled) return;
    const p = audio.play();
    if (p) p.then(() => { started = true; }).catch(() => {});
  }
  // 最初のユーザー操作で再生開始
  const kick = () => { if (!started) play(); };
  addEventListener('pointerdown', kick, true);
  addEventListener('keydown', kick, true);
  // 画面が裏に回ったら止め、戻ったら再開
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audio.pause();
    else if (enabled && started) play();
  });

  return {
    get enabled() { return enabled; },
    get playing() { return !audio.paused; },
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem('nekoCoopBgm', enabled ? 'on' : 'off'); } catch {}
      if (enabled) play(); else audio.pause();
      return enabled;
    },
  };
})();
