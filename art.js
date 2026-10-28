'use strict';
// 챔피언 정보(화면 표시용)와 오리지널 토큰 그림, 스킬 아이콘
window.ART = (() => {
  const CH = {
    wind: {
      name: '질풍검객', role: '근접 · 돌진 · 투사체 차단', color: '#4fd1c5', res: 'flow',
      stats: { 체력: .78, 공격: .82, 사거리: .14, 기동: .9 },
      skills: {
        P: { n: '바람의 흐름', d: '움직이면 기류가 차고, 가득 찬 채로 맞으면 450 보호막. 치명타 확률 50%.' },
        Q: { n: '찌르기 바람', d: '앞으로 찌릅니다. 두 번 맞히면 세 번째는 적을 띄우는 회오리. 돌진 중이면 원형 베기.' },
        W: { n: '바람 장벽', d: '4초 동안 적의 화살과 투사체를 지우는 벽.' },
        E: { n: '돌파 베기', d: '가까운 적을 꿰뚫고 지나갑니다. 같은 적에게는 6초마다.' },
        R: { n: '마지막 바람', d: '공중에 뜬 적에게 순간이동해 붙잡고 내려칩니다.' },
      },
    },
    soul: {
      name: '망령검객', role: '근접 · 진입 후 복귀 · 광역 띄우기', color: '#b383f2', res: 'none',
      stats: { 체력: .76, 공격: .8, 사거리: .14, 기동: .72 },
      skills: {
        P: { n: '두 자루 검', d: '기본 공격 두 번째마다 피해 절반이 마법 피해. 치명타 확률 50%.' },
        Q: { n: '필살 찌르기', d: '앞으로 찌릅니다. 두 번 맞히면 세 번째는 돌진하며 적을 띄웁니다.' },
        W: { n: '혼 가르기', d: '부채꼴로 베어 최대 체력 비례 피해, 맞히면 보호막.' },
        E: { n: '혼 이탈', d: '5초 동안 영혼으로 싸우고 몸으로 돌아오며, 그동안 준 피해의 30%를 다시 입힙니다. E로 일찍 복귀.' },
        R: { n: '봉인참', d: '0.65초 뒤 직선을 베고 맞힌 적 뒤로 순간이동, 끌어당겨 띄웁니다.' },
      },
    },
    frost: {
      name: '서리궁수', role: '원거리 · 둔화 · 장거리 기절', color: '#8fd3ff', res: 'mana',
      stats: { 체력: .62, 공격: .8, 사거리: .95, 기동: .55 },
      skills: {
        P: { n: '서리 화살', d: '모든 공격이 2초 둔화. 치명타는 피해 대신 둔화를 두 배로.' },
        Q: { n: '연사 집중', d: '기본 공격 4회로 충전. 6초 동안 공격 속도 증가, 한 번에 다섯 발.' },
        W: { n: '부채 사격', d: '화살 아홉 발을 부채꼴로 쏴 피해와 강한 둔화.' },
        E: { n: '정찰 매', d: '매를 날려 경로와 도착 지점을 5초 동안 밝힙니다. 2회 충전.' },
        R: { n: '얼음 수정 화살', d: '맵 끝까지 날아가는 화살. 멀리서 맞힐수록 오래 기절(1~3.5초).' },
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

  // 위에서 내려다본 토큰. 단위는 게임 거리(반지름 약 34).
  function drawChamp(ctx, key, x, y, facing, o = {}) {
    const t = o.time || 0;
    const r = 34;
    const lift = o.lift || 0;
    ctx.save();
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;

    // 그림자
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(x, y + 6, r * (1 - lift / 160), r * 0.55 * (1 - lift / 160), 0, 0, Math.PI * 2);
    ctx.fill();

    // 팀 고리
    if (o.ring) {
      ctx.strokeStyle = o.ring;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.ellipse(x, y + 4, r + 9, (r + 9) * 0.62, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.translate(x, y - lift);
    const ca = Math.cos(facing), sa = Math.sin(facing);

    if (key === 'wind') {
      // 바람 리본: 몸 뒤로 휘날림
      for (let i = 0; i < 2; i++) {
        const side = i ? 1 : -1;
        const w = Math.sin(t * 7 + i * 1.7) * 9;
        ctx.strokeStyle = i ? 'rgba(168,239,230,0.75)' : 'rgba(110,200,220,0.6)';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        const bx = -ca * r * 0.6 - sa * side * 10, by = -sa * r * 0.6 + ca * side * 10;
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(bx - ca * 26 - sa * (w + side * 8), by - sa * 26 + ca * (w + side * 8), bx - ca * 52 + sa * w, by - sa * 52 - ca * w);
        ctx.stroke();
      }
    }

    // 몸통
    const pal = {
      wind: ['#5fe0d2', '#1d6f6c', '#0d3236'],
      soul: ['#9b78d0', '#41285e', '#1b1028'],
      frost: ['#e3f5ff', '#6fb4dd', '#20476a'],
    }[key];
    const g = ctx.createRadialGradient(ca * 8 - 6, sa * 8 - 10, 4, 0, 0, r);
    g.addColorStop(0, pal[0]);
    g.addColorStop(0.65, pal[1]);
    g.addColorStop(1, pal[2]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();

    // 어깨선(방향 표시)
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, facing - 1.2, facing + 1.2);
    ctx.stroke();

    // 머리
    ctx.fillStyle = key === 'frost' ? '#f4fbff' : key === 'soul' ? '#d9cbe9' : '#d7f5ef';
    ctx.beginPath();
    ctx.arc(ca * 6, sa * 6, r * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.arc(ca * 10, sa * 10, r * 0.12, 0, Math.PI * 2);
    ctx.fill();

    if (key === 'wind') {
      // 긴 외날 검 하나
      const px = -sa, py = ca;
      const hx = ca * 18 + px * 22, hy = sa * 18 + py * 22;
      const swing = o.swing || 0;
      const a2 = facing - 0.18 + swing;
      ctx.strokeStyle = '#2a2f36';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(a2) * 14, hy + Math.sin(a2) * 14); ctx.stroke();
      ctx.strokeStyle = '#e9f1f6';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(hx + Math.cos(a2) * 14, hy + Math.sin(a2) * 14); ctx.lineTo(hx + Math.cos(a2) * 82, hy + Math.sin(a2) * 82); ctx.stroke();
      ctx.strokeStyle = '#d6b25e';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(hx + Math.cos(a2) * 14 - Math.sin(a2) * 7, hy + Math.sin(a2) * 14 + Math.cos(a2) * 7); ctx.lineTo(hx + Math.cos(a2) * 14 + Math.sin(a2) * 7, hy + Math.sin(a2) * 14 - Math.cos(a2) * 7); ctx.stroke();
    } else if (key === 'soul') {
      // 양손 검: 오른손 강철, 왼손 붉은 보라 검
      const swing = o.swing || 0;
      for (let i = 0; i < 2; i++) {
        const side = i ? 1 : -1;
        const px = -sa * side, py = ca * side;
        const hx = ca * 14 + px * 24, hy = sa * 14 + py * 24;
        const a2 = facing + side * (0.32 - (i ? swing : -swing) * 0.5);
        ctx.lineCap = 'round';
        if (i === 0) { ctx.shadowColor = '#ff4f8f'; ctx.shadowBlur = 12; }
        ctx.strokeStyle = i ? '#d2d9e2' : '#e0457b';
        ctx.lineWidth = i ? 4 : 5;
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(a2) * 64, hy + Math.sin(a2) * 64); ctx.stroke();
        ctx.shadowBlur = 0;
      }
    } else if (key === 'frost') {
      // 활
      const draw = o.draw || 0;
      ctx.strokeStyle = '#eaf7ff';
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      const bx = ca * 26, by = sa * 26;
      ctx.beginPath();
      ctx.arc(bx - ca * 14, by - sa * 14, 34, facing - 1.05, facing + 1.05);
      ctx.stroke();
      const e1x = bx - ca * 14 + Math.cos(facing - 1.05) * 34, e1y = by - sa * 14 + Math.sin(facing - 1.05) * 34;
      const e2x = bx - ca * 14 + Math.cos(facing + 1.05) * 34, e2y = by - sa * 14 + Math.sin(facing + 1.05) * 34;
      const sx = ca * (6 - draw * 10), sy = sa * (6 - draw * 10);
      ctx.strokeStyle = 'rgba(220,240,255,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(e1x, e1y); ctx.lineTo(sx, sy); ctx.lineTo(e2x, e2y); ctx.stroke();
      if (draw > 0) {
        ctx.strokeStyle = '#bfe8ff';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + ca * 52, sy + sa * 52); ctx.stroke();
      }
      // 등 뒤 화살통
      ctx.fillStyle = '#20476a';
      ctx.fillRect(-ca * 22 - 5, -sa * 22 - 5, 10, 10);
    }
    ctx.restore();
  }

  function portrait(canvas, key, ringColor) {
    const ctx = canvas.getContext('2d');
    const s = canvas.width / 150;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(s, s);
    drawChamp(ctx, key, 66, 84, -0.6, { ring: ringColor, time: 0.4 });
    ctx.restore();
  }

  return { CH, icon, drawChamp, portrait };
})();
