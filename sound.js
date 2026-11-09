'use strict';
// 효과음: 파일 없이 Web Audio로 합성한다. 첫 클릭 뒤부터 소리가 난다.
window.SFX = (() => {
  let ac = null, master = null, noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem('duel.mute') === '1'; } catch (e) { /* 저장 불가 */ }
  const last = {};

  function ensure() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.5;
    const comp = ac.createDynamicsCompressor();
    master.connect(comp); comp.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }
  window.addEventListener('pointerdown', ensure, { once: false, passive: true });
  window.addEventListener('keydown', ensure, { passive: true });

  function env(g, t0, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }
  function noise(dur, type, f0, f1, peak = 0.5, q = 1, delay = 0) {
    const t0 = ac.currentTime + delay;
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ac.createGain(); env(g, t0, 0.01, peak, dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }
  function tone(dur, type, f0, f1, peak = 0.3, delay = 0) {
    const t0 = ac.currentTime + delay;
    const o = ac.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ac.createGain(); env(g, t0, 0.005, peak, dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  const S = {
    click: () => tone(0.05, 'sine', 900, 600, 0.06),
    swing: () => noise(0.12, 'bandpass', 3200, 1200, 0.35, 1.2),
    hit: () => { tone(0.12, 'sine', 160, 60, 0.35); noise(0.06, 'highpass', 2500, 1500, 0.15); },
    crit: () => { tone(0.16, 'square', 220, 70, 0.18); noise(0.1, 'bandpass', 4000, 1500, 0.35, 2); },
    magic: () => tone(0.14, 'triangle', 700, 300, 0.12),
    thrust: () => noise(0.16, 'bandpass', 1800, 5000, 0.4, 2),
    tornado: () => { noise(0.7, 'bandpass', 400, 1600, 0.5, 3); noise(0.7, 'bandpass', 900, 2600, 0.25, 4, 0.05); },
    wall: () => noise(0.6, 'lowpass', 600, 2400, 0.35, 0.7),
    dash: () => noise(0.25, 'bandpass', 900, 3500, 0.4, 1.5),
    arrow: () => { tone(0.08, 'triangle', 800, 300, 0.12); noise(0.05, 'highpass', 5000, 3000, 0.08); },
    volley: () => { for (let i = 0; i < 4; i++) tone(0.08, 'triangle', 900 - i * 60, 320, 0.08, i * 0.018); },
    crystal: () => { tone(0.6, 'sine', 1400, 900, 0.12); tone(0.6, 'sine', 2100, 1500, 0.06, 0.02); noise(0.5, 'highpass', 6000, 3000, 0.08); },
    shatter: () => { noise(0.4, 'highpass', 3000, 7000, 0.4); tone(0.3, 'sine', 1800, 2400, 0.12); tone(0.3, 'sine', 1200, 1600, 0.1, 0.03); },
    ult: () => { tone(0.6, 'sawtooth', 110, 40, 0.2); noise(0.6, 'lowpass', 1200, 200, 0.5); },
    seal: () => { noise(0.45, 'bandpass', 600, 3000, 0.5, 2); tone(0.4, 'sawtooth', 300, 80, 0.12); },
    soul: () => { tone(0.5, 'sine', 300, 600, 0.14); tone(0.5, 'sine', 450, 900, 0.08, 0.04); },
    flash: () => { tone(0.18, 'square', 1200, 2400, 0.08); noise(0.15, 'highpass', 4000, 8000, 0.15); },
    shield: () => { tone(0.25, 'sine', 900, 1300, 0.1); tone(0.25, 'sine', 1350, 1950, 0.06, 0.03); },
    block: () => noise(0.18, 'bandpass', 2400, 600, 0.3, 2),
    hawk: () => { tone(0.25, 'sine', 1800, 2600, 0.06); tone(0.2, 'sine', 2600, 1900, 0.05, 0.12); },
    focus: () => { for (let i = 0; i < 3; i++) tone(0.12, 'triangle', 600 + i * 200, 800 + i * 200, 0.08, i * 0.05); },
    death: () => { tone(0.8, 'sawtooth', 200, 50, 0.15); noise(0.6, 'lowpass', 900, 100, 0.3); },
    round: () => { tone(0.25, 'triangle', 523, 523, 0.12); tone(0.35, 'triangle', 784, 784, 0.12, 0.14); },
    win: () => [523, 659, 784, 1046].forEach((f, i) => tone(0.4, 'triangle', f, f, 0.14, i * 0.12)),
    lose: () => [392, 330, 262].forEach((f, i) => tone(0.45, 'triangle', f, f * 0.98, 0.12, i * 0.16)),
  };

  function play(name, minGap = 0.03) {
    if (muted || !ac || !S[name]) return;
    const now = ac.currentTime;
    if (last[name] && now - last[name] < minGap) return;
    last[name] = now;
    try { S[name](); } catch (e) { /* 소리 실패는 무시 */ }
  }
  function toggle() {
    muted = !muted;
    try { localStorage.setItem('duel.mute', muted ? '1' : '0'); } catch (e) { /* 저장 불가 */ }
    if (master) master.gain.value = muted ? 0 : 0.5;
    return muted;
  }
  return { play, toggle, isMuted: () => muted, ensure };
})();
