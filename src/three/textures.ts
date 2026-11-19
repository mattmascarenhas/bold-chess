import * as THREE from 'three';
import { Color, SPECIAL_BY_ID, SpecialId } from '../game/types';

function createCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

export function createMarbleTexture(dark: boolean, maxAniso: number): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512);

  if (dark) {
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, 512, 512);
    // Subtle dark slate clouding
    for (let i = 0; i < 18; i++) {
      const g = ctx.createRadialGradient(
        Math.random() * 512,
        Math.random() * 512,
        10,
        Math.random() * 512,
        Math.random() * 512,
        180
      );
      g.addColorStop(0, 'rgba(30, 41, 59, 0.35)');
      g.addColorStop(1, 'rgba(15, 23, 42, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 512, 512);
    }
    // Delicate cobalt & silver marble veins
    for (let v = 0; v < 9; v++) {
      ctx.beginPath();
      let x = Math.random() * 512;
      let y = Math.random() * 512;
      ctx.moveTo(x, y);
      for (let s = 0; s < 14; s++) {
        x += (Math.random() - 0.35) * 65;
        y += (Math.random() - 0.35) * 65;
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = v % 3 === 0 ? 'rgba(0, 229, 195, 0.14)' : 'rgba(148, 163, 184, 0.12)';
      ctx.lineWidth = 0.8 + Math.random() * 1.4;
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = '#dce4ef';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 16; i++) {
      const g = ctx.createRadialGradient(
        Math.random() * 512,
        Math.random() * 512,
        12,
        Math.random() * 512,
        Math.random() * 512,
        170
      );
      g.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
      g.addColorStop(1, 'rgba(203, 213, 225, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 512, 512);
    }
    for (let v = 0; v < 7; v++) {
      ctx.beginPath();
      let x = Math.random() * 512;
      let y = Math.random() * 512;
      ctx.moveTo(x, y);
      for (let s = 0; s < 12; s++) {
        x += (Math.random() - 0.4) * 60;
        y += (Math.random() - 0.4) * 60;
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(100, 116, 139, 0.16)';
      ctx.lineWidth = 0.7 + Math.random() * 1.2;
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  return tex;
}

export function createBrushedMetalBump(maxAniso: number): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(256);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 256, 256);

  for (let y = 0; y < 256; y++) {
    const shade = 116 + Math.floor(Math.random() * 24);
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    ctx.fillRect(0, y, 256, 1);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAniso;
  return tex;
}

export function createBoldBadgeTexture(maxAniso: number): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(256);
  ctx.clearRect(0, 0, 256, 256);

  // Subtle metallic circular crest
  ctx.fillStyle = '#071326';
  ctx.beginPath();
  ctx.arc(128, 128, 116, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#00E676';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(128, 128, 108, 0, Math.PI * 2);
  ctx.stroke();

  // "bold" wordmark inspired by Bold Solution brand
  ctx.fillStyle = '#1D6CE0';
  ctx.font = '800 72px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('bold', 128, 118);

  // Circuit accent line
  ctx.strokeStyle = '#00E676';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(64, 154);
  ctx.lineTo(118, 148);
  ctx.lineTo(148, 172);
  ctx.lineTo(192, 136);
  ctx.stroke();

  const dots = [
    [64, 154],
    [118, 148],
    [148, 172],
    [192, 136],
  ];
  ctx.fillStyle = '#00E5C3';
  for (const [dx, dy] of dots) {
    ctx.beginPath();
    ctx.arc(dx, dy, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

export function createSpecialEmblemTexture(
  specialId: SpecialId,
  side: Color,
  maxAniso: number
): THREE.CanvasTexture {
  const meta = SPECIAL_BY_ID[specialId];
  const [canvas, ctx] = createCanvas(256);

  ctx.fillStyle = side === 'w' ? '#0f172a' : '#060a12';
  ctx.fillRect(0, 0, 256, 256);

  // Outer shield ring
  ctx.strokeStyle = meta.accentColor;
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(128, 128, 104, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = meta.accentColor;
  ctx.font = '800 94px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(meta.emblemChar, 128, 120);

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '700 26px Outfit, sans-serif';
  ctx.fillText(meta.name.toUpperCase().slice(0, 10), 128, 198);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

export function createBoardRimCoordTexture(label: string, maxAniso: number): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(128);
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = 'rgba(203, 213, 225, 0.72)';
  ctx.font = '600 60px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 64, 64);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

export function createPorcelainTileTexture(
  variant: 'white' | 'dark' | 'limestone',
  maxAniso: number
): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512);
  const base =
    variant === 'white'
      ? '#eceff4'
      : variant === 'dark'
        ? '#121926'
        : '#d6d1c7';
  const grout =
    variant === 'white'
      ? '#cbd5e1'
      : variant === 'dark'
        ? '#080c14'
        : '#b8b0a2';

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);

  // Subtle tile variation across 2x2 tiles in the texture repeat cell
  const tile = 256;
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const delta = (tx + ty) % 2 === 0 ? 4 : -4;
      ctx.fillStyle =
        variant === 'white'
          ? `rgba(${245 + delta}, ${247 + delta}, ${250}, 0.45)`
          : variant === 'dark'
            ? `rgba(${20 + delta}, ${28 + delta}, ${42}, 0.45)`
            : `rgba(${214 + delta}, ${209 + delta}, ${198}, 0.45)`;
      ctx.fillRect(tx * tile + 2, ty * tile + 2, tile - 4, tile - 4);
    }
  }

  // Crisp tile grout lines
  ctx.strokeStyle = grout;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(512, 0);
  ctx.moveTo(0, 256);
  ctx.lineTo(512, 256);
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 512);
  ctx.moveTo(256, 0);
  ctx.lineTo(256, 512);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(11, 11);
  tex.anisotropy = maxAniso;
  return tex;
}

export function createWoodDeskTexture(maxAniso: number): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512);
  ctx.fillStyle = '#4a3222';
  ctx.fillRect(0, 0, 512, 512);

  for (let y = 0; y < 512; y += 2) {
    const wave = Math.sin(y * 0.045) * 12;
    const tone = 62 + Math.floor(Math.sin(y * 0.09) * 10 + Math.random() * 8);
    ctx.fillStyle = `rgb(${tone + 18}, ${Math.floor(tone * 0.72)}, ${Math.floor(tone * 0.46)})`;
    ctx.fillRect(0, y, 512, 2);
    if (y % 18 === 0) {
      ctx.strokeStyle = 'rgba(28, 16, 10, 0.28)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.quadraticCurveTo(256, y + wave, 512, y);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  tex.anisotropy = maxAniso;
  return tex;
}

export function createBoldWallSignTexture(
  darkMode: boolean,
  maxAniso: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = darkMode ? '#0b1426' : '#f1f5f9';
  ctx.fillRect(0, 0, 1024, 512);

  // Subtle architectural panel seam shadow
  ctx.strokeStyle = darkMode ? 'rgba(56, 189, 248, 0.16)' : 'rgba(15, 23, 42, 0.08)';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, 1004, 492);

  // "bold" giant geometric wordmark matching Photo 1 (image_c6ff4f0b.png)
  ctx.save();
  ctx.fillStyle = darkMode ? '#1e6df2' : '#003b99';
  ctx.font = '900 265px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('bold', 512, 230);
  ctx.restore();

  // Green circuit nodes and trace through bold counters
  const nodes: [number, number, number][] = [
    [245, 258, 28],
    [422, 250, 36],
    [548, 344, 18],
    [682, 240, 32],
  ];

  ctx.strokeStyle = darkMode ? '#00e676' : '#16b83a';
  ctx.lineWidth = 18;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(nodes[0][0], nodes[0][1]);
  ctx.lineTo(nodes[1][0], nodes[1][1]);
  ctx.lineTo(nodes[2][0], nodes[2][1]);
  ctx.lineTo(nodes[3][0], nodes[3][1]);
  ctx.stroke();

  ctx.fillStyle = darkMode ? '#00e676' : '#16b83a';
  for (const [nx, ny, nr] of nodes) {
    ctx.beginPath();
    ctx.arc(nx, ny, nr, 0, Math.PI * 2);
    ctx.fill();
  }

  // "SOLUTION" subtitle aligned under "ld"
  ctx.fillStyle = darkMode ? '#93c5fd' : '#003b99';
  ctx.font = '800 42px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('S   L U T I O N', 676, 344);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

export function createProjectionScreenTexture(
  darkMode: boolean,
  maxAniso: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 576;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = darkMode ? '#0c162b' : '#f8fafc';
  ctx.fillRect(0, 0, 1024, 576);

  // Subtle inner slide frame matching Photo 2
  ctx.fillStyle = darkMode ? '#111e38' : '#ffffff';
  ctx.fillRect(58, 46, 908, 484);

  // Bold faint circle decoration
  ctx.strokeStyle = darkMode ? 'rgba(0, 230, 118, 0.14)' : 'rgba(0, 59, 153, 0.08)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(760, 220, 110, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = darkMode ? '#e2e8f0' : '#0f172a';
  ctx.font = '700 54px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(darkMode ? 'Xadrez Bold · Torneio' : 'Custos & Benefícios', 512, 265);

  ctx.fillStyle = darkMode ? '#00e676' : '#003b99';
  ctx.font = '800 32px Outfit, sans-serif';
  ctx.fillText('bold solution', 512, 435);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

export function createWhiteboardTexture(maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Frosted pale mint-glass whiteboard matching Photo 2 & Photo 4
  ctx.fillStyle = '#dde9e8';
  ctx.fillRect(0, 0, 768, 512);

  // Faint Bold watermark in background
  ctx.fillStyle = 'rgba(0, 59, 153, 0.08)';
  ctx.font = '800 138px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('bold', 384, 240);

  // Strategy mind-map diagram drawn in blue marker (Photo 4)
  ctx.strokeStyle = 'rgba(29, 108, 224, 0.55)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(330, 250, 74, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(29, 108, 224, 0.65)';
  ctx.font = '700 30px Outfit, sans-serif';
  ctx.fillText('BOLD', 330, 260);

  const satelliteNodes: [number, number, string][] = [
    [150, 150, 'IDEIAS'],
    [520, 150, 'PRODUTO'],
    [160, 380, 'TIME'],
    [520, 380, 'XADREZ'],
  ];
  for (const [sx, sy, label] of satelliteNodes) {
    ctx.beginPath();
    ctx.moveTo(330, 250);
    ctx.lineTo(sx, sy);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx, sy, 42, 0, Math.PI * 2);
    ctx.fillStyle = '#e5f0ef';
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(29, 108, 224, 0.72)';
    ctx.font = '600 16px Outfit, sans-serif';
    ctx.fillText(label, sx, sy + 5);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

export function createLaptopScreenTexture(
  variant: number,
  maxAniso: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 320;
  const ctx = canvas.getContext('2d')!;

  // Dark IDE / dashboard screen matching Photo 4
  ctx.fillStyle = variant % 2 === 0 ? '#0d1424' : '#0f172a';
  ctx.fillRect(0, 0, 512, 320);

  // Top IDE/app bar
  ctx.fillStyle = '#18243d';
  ctx.fillRect(0, 0, 512, 28);
  ctx.fillStyle = '#00e676';
  ctx.fillRect(14, 9, 10, 10);
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(30, 9, 10, 10);
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(46, 9, 10, 10);

  if (variant % 3 === 0) {
    // Left file tree + syntax-highlighted code lines
    ctx.fillStyle = '#131d33';
    ctx.fillRect(0, 28, 105, 292);
    const colors = ['#38bdf8', '#00e676', '#a78bfa', '#e2e8f0', '#fbbf24'];
    for (let i = 0; i < 14; i++) {
      const indent = (i % 4) * 16 + 124;
      const w = 65 + ((i * 47) % 195);
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(indent, 46 + i * 18, w, 7);
    }
  } else if (variant % 3 === 1) {
    // Bold analytics dashboard cards & bar chart
    ctx.fillStyle = '#16233b';
    ctx.fillRect(22, 46, 220, 92);
    ctx.fillRect(264, 46, 226, 92);
    ctx.fillRect(22, 156, 468, 140);

    const bars = [48, 72, 95, 64, 108, 86, 118, 92];
    bars.forEach((h, idx) => {
      ctx.fillStyle = idx % 2 === 0 ? '#1d6ce0' : '#00e676';
      ctx.fillRect(44 + idx * 54, 280 - h, 34, h);
    });
  } else {
    // Split terminal + chess board preview
    ctx.fillStyle = '#111b2e';
    ctx.fillRect(18, 44, 230, 254);
    ctx.fillRect(264, 44, 230, 254);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#1e293b' : '#cbd5e1';
        ctx.fillRect(300 + c * 38, 94 + r * 38, 38, 38);
      }
    }
    ctx.fillStyle = '#00e676';
    for (let i = 0; i < 8; i++) {
      ctx.fillRect(34, 66 + i * 24, 140 - (i % 3) * 28, 7);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

