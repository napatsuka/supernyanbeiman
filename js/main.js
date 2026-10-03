'use strict';
// 画面遷移・ゲームループ・ネットワーク同期
(() => {
  const $ = s => document.querySelector(s);
  const renderer = new Renderer($('#cv'));
  const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  Input.setupTouch();

  // mode: 'demo'（タイトル背景） | 'local'（1台2人） | 'host' | 'client'
  let mode = 'demo';
  let sim = new Sim(0);
  let remoteInput = { mask: 0, jc: 0 };
  let netEvents = [];
  let lastRecv = 0, waitToast = false;

  // ---------- 画面 ----------
  function show(id) {
    document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== id; });
  }
  function setGameUi(on) {
    $('#menuBtn').hidden = !on;
    const twoP = on && mode === 'local';
    $('#controls').hidden = !(on && isTouch);
    $('#controls2').hidden = !(twoP && isTouch);   // 1台で2人の時は右半分に2P用の操作を出す
    document.body.classList.toggle('two-p', twoP && isTouch);
    $('#keysHint').hidden = !(on && !isTouch);
    renderer.hud = on;
  }
  let toastTimer = 0;
  function toast(msg, ms = 2200) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }
  function showMsg(text, onOk) {
    $('#msgText').textContent = text;
    show('scrMsg');
    $('#msgOk').onclick = () => { onOk ? onOk() : show(null); };
  }

  function goTitle() {
    Net.close();
    mode = 'demo';
    sim = new Sim(0);
    setGameUi(false);
    show('scrTitle');
    history.replaceState(null, '', location.pathname);
  }

  let wakeLock = null;
  async function enterPlay() {
    Sfx.unlock();
    if (isTouch) {
      try { await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }); } catch {}
      try { await screen.orientation?.lock?.('landscape'); } catch {}
    }
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  }
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && mode !== 'demo' && wakeLock?.released) {
      try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
    }
  });

  function startGame(m) {
    mode = m;
    netEvents = [];
    remoteInput = { mask: 0, jc: 0 };
    lastRecv = performance.now();
    if (m !== 'client') sim = new Sim(0);
    client.reset();
    setGameUi(true);
    show(null);
    $('#keysHint').textContent = m === 'local'
      ? '1P: A D 移動 / W ジャンプ / S つかむ / E 投げる / Q ワープ　　2P: ← → / ↑ / ↓ / . 投げる / P ワープ'
      : 'A D / ← → 移動　W / ↑ / Space ジャンプ　S / ↓ / Shift つかむ　E / Enter 投げる　Q 相棒へワープ';
    if (m !== 'local') toast(m === 'host' ? '相方が来た！ あなたは 1P（黒猫）' : 'つながった！ あなたは 2P（茶トラ）', 2800);
    if (isTouch && innerHeight > innerWidth) setTimeout(() => toast('横向きにすると遊びやすいよ'), 3000);
  }

  // ---------- ズーム防止（連打や2本指押しでブラウザが拡大しないように） ----------
  const inScreen = e => e.target instanceof Element && !!e.target.closest('.screen, button');
  let lastTouchEnd = 0;
  document.addEventListener('touchstart', e => { if (e.touches.length > 1 && !inScreen(e)) e.preventDefault(); }, { passive: false });
  document.addEventListener('touchmove', e => { if (!inScreen(e) || e.touches.length > 1) e.preventDefault(); }, { passive: false });
  document.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - lastTouchEnd < 350 && !inScreen(e)) e.preventDefault(); // ダブルタップ拡大
    lastTouchEnd = now;
  }, { passive: false });
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());
  // それでも拡大されてしまった時は等倍に戻す
  const viewportMeta = document.querySelector('meta[name=viewport]');
  const VP = 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover';
  let vpFlip = false;
  window.visualViewport?.addEventListener('resize', () => {
    if (visualViewport.scale > 1.01 && document.activeElement?.tagName !== 'INPUT') {
      vpFlip = !vpFlip;
      viewportMeta.setAttribute('content', VP + (vpFlip ? ',minimum-scale=1' : ''));
    }
  });

  // ---------- ボタン ----------
  $('#btnLocal').onclick = () => { enterPlay(); startGame('local'); };

  $('#btnHost').onclick = () => {
    Sfx.unlock();
    show('scrHost');
    $('#roomCode').textContent = '····';
    $('#qr').innerHTML = '';
    $('#btnShare').disabled = true;
    $('#hostStatus').textContent = 'ルームを準備中…';
    Net.host({
      onCode(code) {
        const url = `${location.origin}${location.pathname}?room=${code}`;
        $('#roomCode').textContent = code;
        try { new QRCode($('#qr'), { text: url, width: 264, height: 264, correctLevel: QRCode.CorrectLevel.M }); } catch {}
        const btn = $('#btnShare');
        btn.disabled = false;
        btn.onclick = async () => {
          if (navigator.share) { try { await navigator.share({ title: 'ネコ・コープ', text: `ルームコード ${code}`, url }); return; } catch {} }
          try { await navigator.clipboard.writeText(url); toast('リンクをコピーしました'); } catch { toast(url, 5000); }
        };
        const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
        $('#hostStatus').textContent = local
          ? '⚠ localhost で開いています。QR はスマホから開けないので、PCのIPアドレス等で開き直してね'
          : '相方の参加を待っています…';
      },
      onConnected() { enterPlay(); startGame('host'); },
      onError(msg) { $('#hostStatus').textContent = msg; },
    });
  };

  $('#btnJoin').onclick = () => { Sfx.unlock(); show('scrJoin'); $('#joinStatus').textContent = ''; setTimeout(() => $('#joinCode').focus(), 50); };
  // 入力中（IMEの変換中）に値を書き換えると文字が重複・消失するので、確定後にだけ整える
  const normCode = v => v.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  $('#joinCode').addEventListener('compositionend', e => { e.target.value = normCode(e.target.value); });
  $('#joinCode').addEventListener('blur', e => { e.target.value = normCode(e.target.value); });
  $('#joinCode').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) $('#btnDoJoin').click(); });
  $('#btnDoJoin').onclick = () => {
    const code = normCode($('#joinCode').value);
    $('#joinCode').value = code;
    if (code.length !== 4) { $('#joinStatus').textContent = '4文字のコードを入れてね'; return; }
    Sfx.unlock();
    $('#joinCode').blur();
    $('#btnDoJoin').disabled = true;
    $('#joinStatus').textContent = '接続中…';
    Net.join(code, {
      onConnected() { $('#btnDoJoin').disabled = false; enterPlay(); startGame('client'); },
      onError(msg) { $('#btnDoJoin').disabled = false; $('#joinStatus').textContent = msg; },
    });
  };
  document.querySelectorAll('[data-back]').forEach(b => b.onclick = goTitle);

  $('#menuBtn').onclick = () => show('scrMenu');
  $('#mClose').onclick = () => show(null);
  $('#mRestart').onclick = () => {
    show(null);
    if (mode === 'client') Net.send({ t: 'r' });
    else sim.restart();
  };
  $('#mTitle').onclick = goTitle;
  // BGM のON/OFF（メニューとタイトルの両方）
  const syncBgm = () => { const t = 'BGM: ' + (Bgm.enabled ? 'ON' : 'OFF'); $('#mBgm').textContent = t; $('#tBgm').textContent = t; };
  $('#mBgm').onclick = $('#tBgm').onclick = () => { Bgm.toggle(); syncBgm(); };
  syncBgm();

  // ---------- ネットワーク ----------
  Net.onData = d => {
    lastRecv = performance.now();
    if (!d || typeof d !== 'object') return;
    if (mode === 'host') {
      if (d.t === 'i') remoteInput = { mask: d.m | 0, jc: d.j | 0, tc: d.k | 0, wc: d.w | 0 };
      else if (d.t === 'r') { sim.restart(); toast('2P がステージをやり直しました'); }
    } else if (mode === 'client') {
      if (d.t === 's') client.onSnap(d);
      else if (d.t === 'full') showMsg('このルームは満員です', goTitle);
    }
  };
  Net.onClose = () => {
    if (mode === 'host' || mode === 'client') showMsg('相方との接続が切れました', goTitle);
  };

  // クライアント：スナップショットを補間して表示
  const client = {
    snaps: [], offset: null, key: null, lv: null, lastSend: 0, lastSent: '',
    reset() { this.snaps = []; this.offset = null; this.key = null; this.lv = null; },
    onSnap(s) {
      const key = s.L + ':' + s.ep;
      if (key !== this.key) {
        this.key = key; this.snaps = []; this.offset = null;
        this.lv = buildLevel(s.L);
        renderer.setLevel(this.lv);
      }
      const now = performance.now(), est = now - s.f * STEP_MS;
      if (this.offset === null || est < this.offset) this.offset = est;
      else this.offset += (est - this.offset) * 0.01;
      this.snaps.push(s);
      if (this.snaps.length > 40) this.snaps.shift();
      for (const ev of s.e || []) handleEvent(ev, s);
    },
    state(now) {
      const S = this.snaps;
      if (!S.length) return null;
      const rf = (now - this.offset) / STEP_MS - 5; // 約 80ms 遅れで再生
      let a = S[0], b = null;
      for (const s of S) { if (s.f <= rf) a = s; else { b = s; break; } }
      if (!b || a.f > rf) return a;
      const t = (rf - a.f) / (b.f - a.f);
      const p = a.p.map((v, i) => i % 3 === 2 ? v + wrapAngle(b.p[i] - v) * t : v + (b.p[i] - v) * t);
      let g = a.g;
      if (a.g.length === b.g.length) g = a.g.map((v, i) => i % 5 === 0 ? v : v + (b.g[i] - v) * t);
      return { ...a, p, g };
    },
    sendInput(now) {
      const inp = Input.single();
      const sig = inp.mask + ':' + inp.jc + ':' + inp.tc + ':' + inp.wc;
      if (sig !== this.lastSent || now - this.lastSend > 150) {
        Net.send({ t: 'i', m: inp.mask, j: inp.jc, k: inp.tc, w: inp.wc });
        this.lastSent = sig; this.lastSend = now;
      }
    },
  };

  // ---------- イベント（効果音・パーティクル） ----------
  function handleEvent(ev, st) {
    const quiet = mode === 'demo';
    const P = st.p;
    switch (ev[0]) {
      case 'j':
        renderer.burst(P[ev[1] * 3], P[ev[1] * 3 + 1] + 28, '#fff', ev[2] ? 10 : 5, 2.5);
        if (!quiet) Sfx.jump(ev[2]);
        break;
      case 'g': if (!quiet) Sfx.grab(); break;
      case 't': if (!quiet) Sfx.throw(); break;
      case 'p':
        renderer.burst(ev[2], ev[3], '#c9a6ff', 12, 3);
        renderer.burst(ev[4], ev[5], '#c9a6ff', 14, 3);
        if (!quiet) Sfx.warp();
        break;
      case 'w': renderer.burst(ev[1], ev[2] - 40, '#c9b7a0', 5, 1.5); if (!quiet) Sfx.rattle(); break;
      case 'r': renderer.burst(ev[1], ev[2], '#ffffff', 8, 2); break;
      case 'i':
        renderer.splatter(ev[1], ev[2], ev[3]);
        if (!quiet) { Sfx.stab(); if (navigator.vibrate) navigator.vibrate([40, 30, 60]); }
        break;
      case 'd':
        renderer.burst(ev[2], ev[3] - 20, CAT_COLORS[ev[1]].puff, 18, 5);
        if (!quiet) Sfx.die();
        break;
      case 'c': if (!quiet) { Sfx.checkpoint(); toast('チェックポイント！', 1400); } break;
      case 'W': {
        const lv = renderer.level;
        if (lv) for (let i = 0; i < 4; i++) renderer.burst(lv.L.carrot[0], lv.L.carrot[1], ['#ffd23f', '#ff7aa8', '#45c9a6', '#8fd3ff'][i], 14, 7);
        if (!quiet) Sfx.clear();
        break;
      }
    }
  }

  // ---------- デモ（タイトル背景で 猫がぴょこぴょこ） ----------
  const demoAi = [0, 1].map(() => ({ dir: 0, t: 0, jc: 0, jump: 0 }));
  function demoInputs() {
    return demoAi.map((ai, i) => {
      if (--ai.t <= 0) { ai.dir = [-1, 0, 0, 1][Math.floor(Math.random() * 4)]; ai.t = 40 + Math.random() * 60; }
      const x = sim.lv.bunnies[i].body.position.x;
      if (x < -330) ai.dir = 1;
      if (x > 500) ai.dir = -1;
      if (Math.random() < 0.015) { ai.jc++; ai.jump = 14; }
      if (ai.jump > 0) ai.jump--;
      return { mask: (ai.dir < 0 ? IN_L : 0) | (ai.dir > 0 ? IN_R : 0) | (ai.jump ? IN_J : 0), jc: ai.jc };
    });
  }

  // ---------- メインループ ----------
  let last = performance.now(), acc = 0, stepCount = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(100, now - last);
    last = now;

    if (mode === 'client') {
      const st = client.state(now);
      if (st) { renderer.draw(st, 1, dt); Input.setThrowable(0, !!(st.th && st.th[1])); }
      else renderer.drawWaiting('ホストからのデータを待っています…');
      watchdog(now);
      return;
    }

    if (renderer.level !== sim.lv) renderer.setLevel(sim.lv);
    const snap = sim.snapshot();
    renderer.draw(snap, mode === 'host' ? 0 : -1, dt);
    Input.setThrowable(0, mode !== 'demo' && !!snap.th[0]);
    Input.setThrowable(1, mode === 'local' && !!snap.th[1]);
    if (mode === 'host') watchdog(now);
  }

  // 物理は描画と切り離してタイマーで進める（描画が止まっても相方へ送り続けられるように）
  let simLast = performance.now();
  function simTick() {
    const now = performance.now();
    if (mode === 'client') { simLast = now; client.sendInput(now); return; }
    acc += Math.min(250, now - simLast);
    simLast = now;
    let n = 0;
    while (acc >= STEP_MS && n < 8) {
      const inputs = mode === 'local' ? Input.local2p()
        : mode === 'host' ? [Input.single(), remoteInput]
        : demoInputs();
      sim.step(inputs);
      acc -= STEP_MS; n++;
      if (sim.events.length) {
        const st = sim.snapshot();
        for (const ev of sim.events) handleEvent(ev, st);
        if (mode === 'host') netEvents.push(...sim.events);
        sim.events = [];
      }
      if (mode === 'host' && ++stepCount % 2 === 0) {
        const s = sim.snapshot();
        s.e = netEvents; netEvents = [];
        Net.send(s);
      }
    }
    if (n === 8) acc = 0;
  }
  setInterval(simTick, 4);

  function watchdog(now) {
    const silent = now - lastRecv;
    if (silent > 3000 && !waitToast) { waitToast = true; toast('相方の応答を待っています…', 4000); }
    if (silent < 3000) waitToast = false;
    if (silent > 15000) { mode = 'demo'; showMsg('相方からの応答がありません。接続を終了しました', goTitle); Net.close(); }
  }

  // ---------- 起動 ----------
  window.__bunny = { get sim() { return sim; }, get mode() { return mode; }, renderer }; // デバッグ用
  setGameUi(false);
  const room = new URLSearchParams(location.search).get('room');
  if (room) {
    show('scrJoin');
    $('#joinCode').value = room.toUpperCase().slice(0, 4);
    $('#joinStatus').textContent = '「参加する」を押してね';
  } else {
    show('scrTitle');
  }
  requestAnimationFrame(loop);
})();
