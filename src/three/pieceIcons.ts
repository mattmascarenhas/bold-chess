import * as THREE from 'three';
import type { Color, SpecialId } from '../game/types';
import { buildChessPieceMesh, createPieceMaterialSet } from './pieces';
import { createBrushedMetalBump } from './textures';

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<Record<string, string>>>();

const key = (id: SpecialId, color: Color) => `${id}_${color}`;

export function getCachedSpecialIcon(id: SpecialId, color: Color): string | null {
  return cache.get(key(id, color)) ?? null;
}

/**
 * Renderiza miniaturas 3D (PNG data URL) das pecas especiais usando os mesmos modelos do jogo.
 * Usa um renderer temporario e o descarta no fim (nao deixa contexto WebGL extra aberto).
 * Resultados ficam em cache. Em falha devolve objeto sem a chave (a UI usa o emblema).
 */
export function renderSpecialIcons(ids: SpecialId[], color: Color, px = 160): Promise<Record<string, string>> {
  const missing = ids.filter((id) => !cache.has(key(id, color)));
  const result = () => Object.fromEntries(ids.filter((id) => cache.has(key(id, color))).map((id) => [id, cache.get(key(id, color))!]));
  if (missing.length === 0) return Promise.resolve(result());

  const flightKey = `${color}:${missing.slice().sort().join(',')}`;
  const running = inflight.get(flightKey);
  if (running) return running;

  const p = new Promise<Record<string, string>>((resolve) => {
    let renderer: THREE.WebGLRenderer | null = null;
    const toDispose: Array<{ dispose: () => void }> = [];
    try {
      const canvas = document.createElement('canvas');
      canvas.width = px;
      canvas.height = px;
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(px, px, false);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      const aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      const metalBump = createBrushedMetalBump(aniso);
      toDispose.push(metalBump);
      const mats = createPieceMaterialSet(metalBump, aniso);
      toDispose.push(mats);

      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 1.4));
      scene.add(new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 1.1));
      const key1 = new THREE.DirectionalLight(0xffffff, 3.2);
      key1.position.set(1.6, 2.6, 2.4);
      scene.add(key1);
      const rim = new THREE.DirectionalLight(0x7dd3fc, 1.8);
      rim.position.set(-2.2, 1.4, -1.6);
      scene.add(rim);

      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
      camera.position.set(1.7, 1.25, 3.1);
      camera.lookAt(0, 0.52, 0);

      for (const id of missing) {
        const mesh = buildChessPieceMesh(id, color, mats, false, aniso);
        // pecas brancas olham para +z, pretas para -z: gira para sempre encarar a camera
        if (color === 'b') mesh.rotation.y = Math.PI;
        mesh.rotation.y += -0.5;
        scene.add(mesh);
        renderer.render(scene, camera);
        cache.set(key(id, color), canvas.toDataURL('image/png'));
        scene.remove(mesh);
        mesh.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
        });
      }
    } catch (err) {
      console.warn('Falha ao gerar icones 3D', err);
    } finally {
      try {
        toDispose.forEach((d) => d.dispose());
        renderer?.dispose();
        renderer?.forceContextLoss();
      } catch {
        /* ignore */
      }
    }
    resolve(result());
  }).finally(() => inflight.delete(flightKey));

  inflight.set(flightKey, p);
  return p;
}
