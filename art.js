'use strict';
// 챔피언 정보(화면 표시용), 탑뷰 토큰 그림, 스킬 아이콘
// 토큰은 원작 일러스트를 따라 그리지 않은 오리지널 디자인이다.
window.ART = (() => {
  const CH = {
    wind: {
      name: '야스오', role: '근접 · 돌진 · 투사체 차단', color: '#4fd1c5', res: 'flow',
      stats: { 체력: .78, 공격: .82, 사거리: .14, 기동: .9 },
      skills: {
        P: { n: '낭인의 길', d: '움직이면 기류가 차고, 가득 찬 채로 챔피언에게 맞으면 1초 동안 450 보호막. 치명타 확률 2배(50%), 치명타 피해 180%.' },
        Q: { n: '강철 폭풍', d: '앞으로 검을 찌릅니다. 맞히면 6초 동안 1회 중첩, 2회 중첩이면 세 번째는 적을 1초 띄우는 회오리. 질풍검 돌진 중에 쓰면 원형으로 벱니다.', cd: '4초 (공속 비례 감소)' },
        W: { n: '바람 장막', d: '4초 동안 적의 모든 투사체(평타 화살, 일제 사격, 수정화살)를 지우는 바람의 벽.', cd: '21초' },
        E: { n: '질풍검', d: '사거리 안의 적을 뚫고 지나가며 마법 피해. 쓸 때마다 다음 돌진 피해 25%씩 증가(최대 100%). 같은 적에게는 6초마다.', cd: '0.5초' },
        R: { n: '최후의 숨결', d: '공중에 뜬 적에게 순간이동해 1초 붙잡고 내려칩니다. 기류가 가득 차고, 15초 동안 치명타가 방어력 일부를 무시.', cd: '40초' },
      },
    },
    soul: {
      name: '요네', role: '근접 · 진입 후 복귀 · 광역 띄우기', color: '#b383f2', res: 'none',
      stats: { 체력: .76, 공격: .8, 사거리: .14, 기동: .72 },
      skills: {
        P: { n: '사냥꾼의 길', d: '기본 공격 두 번째마다 피해 절반이 마법 피해. 치명타 확률 2배(50%), 치명타 피해 180%.' },
        Q: { n: '필멸의 검', d: '앞으로 검을 내지릅니다. 2회 중첩되면 세 번째는 전방으로 돌진하며 돌풍으로 적을 띄웁니다.', cd: '4초 (공속 비례 감소)' },
        W: { n: '영혼 가르기', d: '전방 부채꼴을 베어 최대 체력 비례 피해. 맞히면 1.5초 보호막.', cd: '14초 (공속 비례 감소)' },
        E: { n: '영혼해방', d: '5초 동안 영혼이 되어 이동 속도가 점점 빨라집니다. 끝나거나 E를 다시 누르면 몸으로 돌아오며, 그동안 준 피해의 25%를 다시 입힙니다.', cd: '16초' },
        R: { n: '운명봉인', d: '0.65초 뒤 직선 경로를 베고, 맞힌 적 뒤로 순간이동하며 끌어당겨 띄웁니다. 시전 중에는 군중 제어에 걸리지 않습니다.', cd: '60초' },
      },
    },
    frost: {
      name: '애쉬', role: '원거리 · 둔화 · 장거리 기절', color: '#8fd3ff', res: 'mana',
      stats: { 체력: .64, 공격: .82, 사거리: .95, 기동: .55 },
      skills: {
        P: { n: '서리 화살', d: '기본 공격과 스킬이 2초 동안 둔화. 치명타는 피해 대신 둔화를 두 배로 하고, 치명타 확률만큼 기본 공격이 항상 강해집니다.' },
        Q: { n: '궁사의 집중', d: '기본 공격 4회로 충전. 6초 동안 공격 속도가 오르고 한 번에 화살 5발.', cd: '마나 30' },
        W: { n: '일제 사격', d: '화살 11발을 부채꼴로 발사. 치명타 판정이라 둔화 두 배. 관통하지 않습니다.', cd: '7.5초 · 마나 60' },
        E: { n: '매 날리기', d: '매를 날려 지나간 길과 도착 지점을 5초 동안 밝힙니다. 2회 충전.', cd: '충전 35초' },
        R: { n: '마법의 수정화살', d: '맵 끝까지 날아가는 화살. 멀리서 맞힐수록 기절이 길어집니다(1~3.5초).', cd: '60초 · 마나 100' },
      },
    },
  };

  const ICON = {
    'wind.Q': '<path d="M7 25 L24 8"/><path d="M21 6.5 L26 6 L25.5 11"/><path d="M8.5 18.5 l5 5"/>',
    'wind.W': '<path d="M10 4c3 4-3 8 0 12s-3 8 0 12"/><path d="M16 4c3 4-3 8 0 12s-3 8 0 12"/><path d="M22 4c3 4-3 8 0 12s-3 8 0 12"/>',
    'wind.E': '<path d="M5 9l7 7-7 7"/><path d="M13 9l7 7-7 7"/><path d="M21 9l6 7-6 7"/>',
    'wind.R': '<path d="M6 26L26 6"/><path d="M6 6l20 20" opacity=".55"/><circle cx="16" cy="16" r="5"/>',
    'soul.Q': '<path d="M6 26L24 8"/><path d="M21 6.5 L26 6 L25.5 11"/><path d="M12 27l12-12" opacity=".5"/>',
    'soul.W': '<path d="M4 22 A14 14 0 0 1 28 22"/><path d="M8 27 A10 10 0 0 1 24 27"/><path d="M16 4v7"/>',
    'soul.E': '<circle cx="11" cy="18" r="6" opacity=".5"/><circle cx="20" cy="13" r="6"/><path d="M15.5 22.5l-3 4.5"/>',
    'soul.R': '<path d="M4 25L28 7"/><circle cx="16" cy="16" r="9.5" stroke-dasharray="3 3"/>',
    'frost.Q': '<path d="M5 10h17M5 16h20M5 22h17"/><path d="M19 7l4 3-4 3M22 13l4 3-4 3M19 19l4 3-4 3"/>',
    'frost.W': '<path d="M5 27L27 5M5 27L28 17M5 27L15 4M5 27L28 27M5 27L4 4"/>',
    'frost.E': '<path d="M3 15c5-5 9-5 13 1 4-6 8-6 13-1"/><path d="M16 16v7l-3 3M16 23l3 3"/>',
    'frost.R': '<path d="M16 3l8 13-8 13-8-13z"/><path d="M16 3v26M8 16h16" opacity=".5"/>',
    'F': '<path d="M16 3v7M16 22v7M3 16h7M22 16h7M7 7l4.5 4.5M20.5 20.5L25 25M25 7l-4.5 4.5M7 25l4.5-4.5"/>',
  };
  const icon = id => `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICON[id] || ''}</svg>`;

  const PAL = {
    wind:  { cloak: ['#2c6f73', '#163a40'], body: ['#7ee6da', '#2b8a86', '#0f3c3e'], trim: '#d6b25e', skin: '#e9d7c3', hair: '#2a2f3a' },
    soul:  { cloak: ['#3b2a57', '#1a1128'], body: ['#b494e6', '#563a86', '#20132f'], trim: '#c9c3d6', skin: '#d9cfe0', hair: '#e8e6f0' },
    frost: { cloak: ['#5c8fbf', '#22476b'], body: ['#eaf7ff', '#86c3ea', '#28557c'], trim: '#e7f4ff', skin: '#f2e6dc', hair: '#f4f8fc' },
  };

  // 위에서 내려다본 토큰. 단위는 게임 거리(반지름 약 34).
  function drawChamp(ctx, key, x, y, facing, o = {}) {
    const t = o.time || 0;
    const r = 34;
    const lift = o.lift || 0;
    const p = PAL[key];
    const walk = o.walk || 0;
    const bob = Math.sin(walk * 11) * 2.2;
    ctx.save();
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;

    // 그림자
    const sh = 1 - Math.min(0.45, lift / 160);
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.beginPath();
    ctx.ellipse(x, y + 8, r * 1.05 * sh, r * 0.6 * sh, 0, 0, Math.PI * 2);
    ctx.fill();

    // 팀 고리 (롤처럼 발밑 원)
    if (o.ring) {
      ctx.strokeStyle = o.ring;
      ctx.globalAlpha *= 0.9;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(x, y + 6, r + 12, (r + 12) * 0.64, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    }

    ctx.translate(x, y - lift + bob * 0.3);
    const ca = Math.cos(facing), sa = Math.sin(facing);
    const px = -sa, py = ca; // 오른쪽 방향

    // 망토: 등 뒤로 늘어지는 물방울 모양
    const sway = Math.sin(t * 3 + walk * 6) * 6 + (o.moving ? -8 : 0);
    const tailX = -ca * (r * 1.55) + px * sway, tailY = -sa * (r * 1.55) + py * sway;
    const cg = ctx.createLinearGradient(ca * 10, sa * 10, tailX, tailY);
    cg.addColorStop(0, p.cloak[0]);
    cg.addColorStop(1, p.cloak[1]);
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.moveTo(px * r * 0.86 + ca * 4, py * r * 0.86 + sa * 4);
    ctx.quadraticCurveTo(px * r * 1.05 - ca * r * 0.9, py * r * 1.05 - sa * r * 0.9, tailX, tailY);
    ctx.quadraticCurveTo(-px * r * 1.05 - ca * r * 0.9, -py * r * 1.05 - sa * r * 0.9, -px * r * 0.86 + ca * 4, -py * r * 0.86 + sa * 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (key === 'wind') {
      // 몸을 감도는 바람 줄기
      for (let i = 0; i < 2; i++) {
        const a0 = t * 4 + i * Math.PI;
        ctx.strokeStyle = `rgba(190,250,242,${0.35 + 0.15 * i})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(0, 0, r + 10, (r + 10) * 0.55, a0 * 0.2, a0, a0 + 1.6);
        ctx.stroke();
      }
    }

    // 어깨 보호대
    for (const side of [-1, 1]) {
      const sx = px * side * r * 0.78, sy = py * side * r * 0.78;
      const g = ctx.createRadialGradient(sx - 3, sy - 4, 1, sx, sy, 14);
      g.addColorStop(0, p.body[0]);
      g.addColorStop(1, p.body[2]);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sx, sy, 13, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = p.trim; ctx.lineWidth = 1.6; ctx.stroke();
    }

    // 몸통
    const g = ctx.createRadialGradient(ca * 6 - 6, sa * 6 - 10, 4, 0, 0, r * 0.9);
    g.addColorStop(0, p.body[0]);
    g.addColorStop(0.6, p.body[1]);
    g.addColorStop(1, p.body[2]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.78, r * 0.7, facing, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.stroke();
    // 허리띠
    ctx.strokeStyle = p.trim;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(-ca * 2, -sa * 2, r * 0.6, r * 0.52, facing, Math.PI * 0.6, Math.PI * 1.4);
    ctx.stroke();

    // 머리
    const hx = ca * 7, hy = sa * 7;
    ctx.fillStyle = p.hair;
    ctx.beginPath(); ctx.arc(hx - ca * 3, hy - sa * 3, r * 0.36, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.skin;
    ctx.beginPath(); ctx.arc(hx + ca * 3, hy + sa * 3, r * 0.24, facing - 1.4, facing + 1.4); ctx.closePath(); ctx.fill();
    if (key === 'frost') {
      // 서리 깃 장식
      ctx.strokeStyle = '#d6f0ff';
      ctx.lineWidth = 2;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(hx + px * side * 9, hy + py * side * 9);
        ctx.lineTo(hx + px * side * 17 - ca * 6, hy + py * side * 17 - sa * 6);
        ctx.stroke();
      }
    }

    const swing = o.swing || 0;
    ctx.lineCap = 'round';
    if (key === 'wind') {
      // 외날 장검 하나
      const hx2 = ca * 16 + px * 24, hy2 = sa * 16 + py * 24;
      const a2 = facing - 0.25 + swing * 1.6;
      ctx.strokeStyle = '#2a2f36'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(hx2, hy2); ctx.lineTo(hx2 + Math.cos(a2) * 14, hy2 + Math.sin(a2) * 14); ctx.stroke();
      const bx0 = hx2 + Math.cos(a2) * 14, by0 = hy2 + Math.sin(a2) * 14;
      const bx1 = hx2 + Math.cos(a2) * 86, by1 = hy2 + Math.sin(a2) * 86;
      ctx.strokeStyle = '#eef5fa'; ctx.lineWidth = 4.5;
      ctx.beginPath(); ctx.moveTo(bx0, by0); ctx.quadraticCurveTo((bx0 + bx1) / 2 + px * 4, (by0 + by1) / 2 + py * 4, bx1, by1); ctx.stroke();
      ctx.strokeStyle = 'rgba(160,250,240,0.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(bx0, by0); ctx.lineTo(bx1, by1); ctx.stroke();
      ctx.strokeStyle = p.trim; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(bx0 - Math.sin(a2) * 7, by0 + Math.cos(a2) * 7); ctx.lineTo(bx0 + Math.sin(a2) * 7, by0 - Math.cos(a2) * 7); ctx.stroke();
    } else if (key === 'soul') {
      // 양손 검: 강철 검 + 영혼 검
      for (let i = 0; i < 2; i++) {
        const side = i ? 1 : -1;
        const hx2 = ca * 12 + px * side * 26, hy2 = sa * 12 + py * side * 26;
        const a2 = facing + side * (0.38 - (i ? swing : -swing) * 0.7);
        if (i === 0) { ctx.shadowColor = '#c08cff'; ctx.shadowBlur = 14; }
        ctx.strokeStyle = i ? '#d8dee6' : '#c9a2ff';
        ctx.lineWidth = i ? 4 : 5;
        ctx.beginPath(); ctx.moveTo(hx2, hy2); ctx.lineTo(hx2 + Math.cos(a2) * 66, hy2 + Math.sin(a2) * 66); ctx.stroke();
        ctx.shadowBlur = 0;
      }
    } else if (key === 'frost') {
      // 얼음 활
      const draw = o.draw || 0;
      const bx = ca * 24, by = sa * 24;
      const g2 = ctx.createLinearGradient(bx + px * 34, by + py * 34, bx - px * 34, by - py * 34);
      g2.addColorStop(0, '#ffffff'); g2.addColorStop(0.5, '#9fd8ff'); g2.addColorStop(1, '#ffffff');
      ctx.strokeStyle = g2;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(bx - ca * 16, by - sa * 16, 36, facing - 1.0, facing + 1.0);
      ctx.stroke();
      const e1x = bx - ca * 16 + Math.cos(facing - 1.0) * 36, e1y = by - sa * 16 + Math.sin(facing - 1.0) * 36;
      const e2x = bx - ca * 16 + Math.cos(facing + 1.0) * 36, e2y = by - sa * 16 + Math.sin(facing + 1.0) * 36;
      const sx = ca * (4 - draw * 12), sy = sa * (4 - draw * 12);
      ctx.strokeStyle = 'rgba(220,240,255,0.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(e1x, e1y); ctx.lineTo(sx, sy); ctx.lineTo(e2x, e2y); ctx.stroke();
      if (draw > 0) {
        ctx.shadowColor = '#bfe8ff'; ctx.shadowBlur = 10;
        ctx.strokeStyle = '#e6f6ff';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + ca * 56, sy + sa * 56); ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }

    // 맞았을 때 하얗게 번쩍임
    if (o.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,255,255,${0.45 * o.flash})`;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  function portrait(canvas, key, ringColor) {
    const ctx = canvas.getContext('2d');
    const s = canvas.width / 150;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(s, s);
    drawChamp(ctx, key, 72, 80, -0.75, { ring: ringColor, time: 0.4 });
    ctx.restore();
  }

  return { CH, icon, drawChamp, portrait };
})();
