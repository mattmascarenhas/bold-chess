import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Color, GameState, MoveOption, Pos, SceneRoomId, isSpecialKind } from '../game/types';
import { buildChessPieceMesh, createBoldRobot3D, createPieceMaterialSet, PieceMaterialSet } from './pieces';
import { CEILING_Y, RoomEnvironmentBuild, buildRoomEnvironment } from './rooms';
import {
  createBoardRimCoordTexture,
  createBoldBadgeTexture,
  createBrushedMetalBump,
  createMarbleTexture,
} from './textures';

export type CameraPreset = 'white' | 'black' | 'top';

interface ChessSceneProps {
  gameState: GameState;
  selectedSquare: Pos | null;
  legalMoves: MoveOption[];
  playerPerspective: Color;
  cameraPreset: CameraPreset;
  roomId: SceneRoomId;
  isTitleScreen: boolean;
  robotMood: 'idle' | 'happy' | 'alert' | 'excited';
  onSquareClick: (pos: Pos) => void;
}

interface PieceVisual {
  id: string;
  kind: string;
  color: Color;
  mesh: THREE.Group;
  currentPos: THREE.Vector3;
  startPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  moveProgress: number;
  isMoving: boolean;
  spawnProgress: number;
  isSpecial: boolean;
}

const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();

function squareToWorld(row: number, col: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(col - 3.5, 0, row - 3.5);
}

function getCameraCoords(
  preset: CameraPreset,
  aspect = 1.6
): { pos: THREE.Vector3; target: THREE.Vector3 } {
  const portraitScale = aspect < 1 ? Math.min(2.05, 1.05 / Math.max(aspect, 0.42)) : 1;
  if (preset === 'black') {
    return {
      pos: new THREE.Vector3(0, 10.6 * portraitScale, -10.2 * portraitScale),
      target: new THREE.Vector3(0, -0.3, -0.45),
    };
  }
  if (preset === 'top') {
    return {
      pos: new THREE.Vector3(0, 14.2 * portraitScale, 0.35),
      target: new THREE.Vector3(0, 0, 0.3),
    };
  }
  return {
    pos: new THREE.Vector3(0, 10.6 * portraitScale, 10.2 * portraitScale),
    target: new THREE.Vector3(0, -0.3, 0.45),
  };
}

export function ChessScene({
  gameState,
  selectedSquare,
  legalMoves,
  playerPerspective,
  cameraPreset,
  roomId,
  isTitleScreen,
  robotMood,
  onSquareClick,
}: ChessSceneProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  const propsRef = useRef({
    gameState,
    selectedSquare,
    legalMoves,
    playerPerspective,
    cameraPreset,
    roomId,
    isTitleScreen,
    robotMood,
    onSquareClick,
  });
  propsRef.current = {
    gameState,
    selectedSquare,
    legalMoves,
    playerPerspective,
    cameraPreset,
    roomId,
    isTitleScreen,
    robotMood,
    onSquareClick,
  };

  const syncFnRef = useRef<(() => void) | null>(null);
  const cameraFnRef = useRef<((preset: CameraPreset, focus?: Pos | null) => void) | null>(null);
  const loopFnRef = useRef<(() => void) | null>(null);
  const setRoomFnRef = useRef<((nextRoom: SceneRoomId) => void) | null>(null);
  const robotBounceRef = useRef<number>(0);

  // Detect software WebGL once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070b14);
    scene.fog = new THREE.FogExp2(0x070b14, 0.022);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 120);
    const initialCam = getCameraCoords(propsRef.current.cameraPreset, width / height);
    camera.position.copy(initialCam.pos);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(initialCam.target);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.minDistance = 5.5;
    controls.maxDistance = 22.5;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = Math.PI / 2.22;
    controls.enablePan = false;

    // Studio Environment Map (RoomEnvironment)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmremGenerator.dispose();

    // Three-Point Studio Lighting with Warm/Cool Contrast
    const hemiLight = new THREE.HemisphereLight(0xb8d4ff, 0x0d1424, 0.72);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff1dc, 2.0);
    keyLight.position.set(6, 12, 7);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -6.5;
    keyLight.shadow.camera.right = 6.5;
    keyLight.shadow.camera.top = 6.5;
    keyLight.shadow.camera.bottom = -6.5;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 28;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.95);
    rimLight.position.set(-7, 6, -8);
    scene.add(rimLight);

    const accentPoint = new THREE.PointLight(0x00e676, 1.4, 14, 2);
    accentPoint.position.set(4.8, 3.2, -1.5);
    scene.add(accentPoint);

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const darkMarbleTex = createMarbleTexture(true, maxAniso);
    const lightMarbleTex = createMarbleTexture(false, maxAniso);
    const metalBump = createBrushedMetalBump(maxAniso);
    const boldBadgeTex = createBoldBadgeTexture(maxAniso);

    const pieceMats: PieceMaterialSet = createPieceMaterialSet(metalBump, maxAniso);

    // 3D Room & Table Environment Root
    const roomRoot = new THREE.Group();
    scene.add(roomRoot);
    let currentRoomBuild: RoomEnvironmentBuild | null = null;

    const applyRoomTheme = (nextRoomId: SceneRoomId) => {
      if (currentRoomBuild) {
        roomRoot.remove(currentRoomBuild.group);
        currentRoomBuild.dispose();
        currentRoomBuild = null;
      }
      const built = buildRoomEnvironment(nextRoomId, maxAniso, isSoftwareGl);
      currentRoomBuild = built;
      roomRoot.add(built.group);

      scene.background = new THREE.Color(built.backgroundColor);
      scene.fog = new THREE.FogExp2(built.fogColor, built.fogDensity);
      hemiLight.color.setHex(built.hemiSky);
      hemiLight.groundColor.setHex(built.hemiGround);
      hemiLight.intensity = built.hemiIntensity;
      keyLight.color.setHex(built.keyColor);
      keyLight.intensity = built.keyIntensity;
      rimLight.color.setHex(built.rimColor);
      rimLight.intensity = built.rimIntensity;
      accentPoint.color.setHex(built.accentColor);
      accentPoint.intensity = built.accentIntensity;

      const hideCeiling = camera.position.y > CEILING_Y - 2.2;
      for (const obj of built.ceilingObjects) {
        obj.visible = !hideCeiling;
      }
      requestRender();
    };
    setRoomFnRef.current = applyRoomTheme;

    // Chessboard Plinth Frame
    const frameGroup = new THREE.Group();
    const outerFrameMat = new THREE.MeshPhysicalMaterial({
      color: 0x0e1626,
      metalness: 0.78,
      roughness: 0.24,
      clearcoat: 0.65,
      bumpMap: metalBump,
      bumpScale: 0.004,
    });
    const outerPlinth = new THREE.Mesh(new THREE.BoxGeometry(9.05, 0.36, 9.05), outerFrameMat);
    outerPlinth.position.y = -0.22;
    outerPlinth.receiveShadow = true;
    frameGroup.add(outerPlinth);

    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x00e676,
      emissive: 0x007a3d,
      emissiveIntensity: 0.35,
      metalness: 0.7,
      roughness: 0.25,
    });
    const innerTrim = new THREE.Mesh(new THREE.BoxGeometry(8.14, 0.06, 8.14), trimMat);
    innerTrim.position.y = -0.04;
    frameGroup.add(innerTrim);

    // Bold Solution medallion on front and back bevels
    const emblemPlaqueMat = new THREE.MeshStandardMaterial({
      map: boldBadgeTex,
      roughness: 0.22,
      metalness: 0.3,
    });
    for (const zPos of [4.53, -4.53]) {
      const plaque = new THREE.Mesh(new THREE.CircleGeometry(0.16, 24), emblemPlaqueMat);
      plaque.position.set(0, -0.22, zPos);
      if (zPos < 0) plaque.rotation.y = Math.PI;
      frameGroup.add(plaque);
    }

    // Coordinate markings along edges (a-h, 1-8)
    const files = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const coordMeshes: THREE.Mesh[] = [];
    for (let i = 0; i < 8; i++) {
      const fTex = createBoardRimCoordTexture(files[i], maxAniso);
      const fMat = new THREE.MeshBasicMaterial({ map: fTex, transparent: true });
      const fMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.38), fMat);
      fMesh.rotation.x = -Math.PI / 2;
      fMesh.position.set(i - 3.5, -0.025, 4.26);
      frameGroup.add(fMesh);
      coordMeshes.push(fMesh);

      const rTex = createBoardRimCoordTexture(String(8 - i), maxAniso);
      const rMat = new THREE.MeshBasicMaterial({ map: rTex, transparent: true });
      const rMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.38), rMat);
      rMesh.rotation.x = -Math.PI / 2;
      rMesh.position.set(-4.26, -0.025, i - 3.5);
      frameGroup.add(rMesh);
      coordMeshes.push(rMesh);
    }

    scene.add(frameGroup);

    // 64 Squares (using shared materials for light/dark marble)
    const darkSqMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: darkMarbleTex,
      roughness: 0.24,
      metalness: 0.14,
      clearcoat: 0.72,
      clearcoatRoughness: 0.15,
    });
    const lightSqMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: lightMarbleTex,
      roughness: 0.22,
      metalness: 0.12,
      clearcoat: 0.75,
      clearcoatRoughness: 0.14,
    });
    const sqGeo = new THREE.BoxGeometry(0.985, 0.08, 0.985);
    const clickables: THREE.Object3D[] = [];
    const squareHitMeshes: THREE.Mesh[][] = Array.from({ length: 8 }, () => []);

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const isDark = (r + c) % 2 === 1;
        const sq = new THREE.Mesh(sqGeo, isDark ? darkSqMat : lightSqMat);
        sq.position.set(c - 3.5, -0.04, r - 3.5);
        sq.receiveShadow = true;
        sq.userData = { square: { row: r, col: c } };
        scene.add(sq);
        clickables.push(sq);
        squareHitMeshes[r][c] = sq;
      }
    }

    // Highlight overlays group (selection, legal moves, captures, check, forbidden, last move)
    const highlightGroup = new THREE.Group();
    scene.add(highlightGroup);

    const ringGeo = new THREE.RingGeometry(0.24, 0.36, 28);
    const dotGeo = new THREE.CircleGeometry(0.16, 20);
    const sqPlaneGeo = new THREE.PlaneGeometry(0.92, 0.92);

    const selectedMat = new THREE.MeshBasicMaterial({
      color: 0x00e676,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const lastMoveMat = new THREE.MeshBasicMaterial({
      color: 0x1d6ce0,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const legalDotMat = new THREE.MeshBasicMaterial({
      color: 0x00e676,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const captureRingMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const abilityRingMat = new THREE.MeshBasicMaterial({
      color: 0xa855f7,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const checkMat = new THREE.MeshBasicMaterial({
      color: 0xff2e4c,
      transparent: true,
      opacity: 0.68,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const forbiddenMat = new THREE.MeshStandardMaterial({
      color: 0x7c3aed,
      emissive: 0x7c3aed,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    const frozenMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.6,
    });

    // Hover highlight disc
    const hoverMesh = new THREE.Mesh(
      sqPlaneGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.14,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    hoverMesh.rotation.x = -Math.PI / 2;
    hoverMesh.position.y = 0.012;
    hoverMesh.visible = false;
    scene.add(hoverMesh);

    // Convocation beam & shockwave effect
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x00e676,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const convocationBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 5.5, 24, 1, true),
      beamMat
    );
    convocationBeam.visible = false;
    scene.add(convocationBeam);
    let beamTimer = 0;

    // 3D Robôzinho da Bold Mascot beside the board
    const robotGroup = createBoldRobot3D(pieceMats, !isSoftwareGl);
    robotGroup.position.set(5.45, 1.35, -1.6);
    robotGroup.rotation.y = -0.65;
    robotGroup.scale.setScalar(1.05);
    scene.add(robotGroup);

    // Piece visuals map
    const pieceVisuals = new Map<string, PieceVisual>();
    const piecesLayer = new THREE.Group();
    scene.add(piecesLayer);

    let activeAnimUntil = 0;
    let cameraLerpTargetPos: THREE.Vector3 | null = null;
    let cameraLerpTargetLook: THREE.Vector3 | null = null;
    let cameraReturnTimer = 0;
    let cameraReturnPreset: CameraPreset = propsRef.current.cameraPreset;

    const triggerConvocationBeam = (pos: Pos) => {
      squareToWorld(pos.row, pos.col, _vec3A);
      convocationBeam.position.set(_vec3A.x, 2.75, _vec3A.z);
      convocationBeam.visible = true;
      beamTimer = 1.0;
      activeAnimUntil = Math.max(activeAnimUntil, performance.now() + 1200);
    };

    const syncBoardVisuals = () => {
      const { gameState: gs, selectedSquare: sel, legalMoves: moves } = propsRef.current;

      // Update pieces
      const seenIds = new Set<string>();
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const p = gs.board[r][c];
          if (!p) continue;
          const visualKey = `${p.id}_${p.kind}`;
          seenIds.add(visualKey);

          const targetWorld = squareToWorld(r, c);
          let vis = pieceVisuals.get(visualKey);
          if (!vis) {
            const mesh = buildChessPieceMesh(
              p.kind,
              p.color,
              pieceMats,
              !isSoftwareGl,
              maxAniso
            );
            mesh.userData = { square: { row: r, col: c } };
            mesh.traverse((child) => {
              child.userData.square = { row: r, col: c };
            });
            mesh.position.copy(targetWorld);
            piecesLayer.add(mesh);

            const isSpecial = isSpecialKind(p.kind);
            if (isSpecial && gs.history.length > 0) {
              // Entrance drop animation!
              mesh.position.y = 2.4;
              triggerConvocationBeam({ row: r, col: c });
            }

            vis = {
              id: visualKey,
              kind: p.kind,
              color: p.color,
              mesh,
              currentPos: mesh.position.clone(),
              startPos: mesh.position.clone(),
              targetPos: targetWorld.clone(),
              moveProgress: 1,
              isMoving: false,
              spawnProgress: isSpecial && gs.history.length > 0 ? 0 : 1,
              isSpecial,
            };
            pieceVisuals.set(visualKey, vis);
          } else {
            vis.mesh.userData.square = { row: r, col: c };
            vis.mesh.traverse((child) => {
              child.userData.square = { row: r, col: c };
            });
            if (vis.targetPos.distanceToSquared(targetWorld) > 0.001) {
              vis.startPos.copy(vis.currentPos);
              vis.targetPos.copy(targetWorld);
              vis.moveProgress = 0;
              vis.isMoving = true;
              activeAnimUntil = Math.max(activeAnimUntil, performance.now() + 420);
            }
          }
        }
      }

      // Remove captured/transformed pieces
      for (const [key, vis] of pieceVisuals.entries()) {
        if (!seenIds.has(key)) {
          piecesLayer.remove(vis.mesh);
          pieceVisuals.delete(key);
        }
      }

      // Rebuild highlights
      while (highlightGroup.children.length > 0) {
        highlightGroup.remove(highlightGroup.children[0]);
      }

      // Last move highlight
      if (gs.lastMove) {
        for (const sq of [gs.lastMove.from, gs.lastMove.to]) {
          const m = new THREE.Mesh(sqPlaneGeo, lastMoveMat);
          m.rotation.x = -Math.PI / 2;
          m.position.set(sq.col - 3.5, 0.015, sq.row - 3.5);
          highlightGroup.add(m);
        }
      }

      // Selected square
      if (sel) {
        const m = new THREE.Mesh(sqPlaneGeo, selectedMat);
        m.rotation.x = -Math.PI / 2;
        m.position.set(sel.col - 3.5, 0.018, sel.row - 3.5);
        highlightGroup.add(m);
      }

      // Check highlight
      if (gs.inCheck) {
        for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 8; c++) {
            const p = gs.board[r][c];
            if (p && p.color === gs.inCheck && p.kind === 'k') {
              const m = new THREE.Mesh(sqPlaneGeo, checkMat);
              m.rotation.x = -Math.PI / 2;
              m.position.set(c - 3.5, 0.02, r - 3.5);
              highlightGroup.add(m);
            }
          }
        }
      }

      // Legal move targets
      for (const mv of moves) {
        const isAbility =
          mv.kind === 'kick' ||
          mv.kind === 'arrest' ||
          mv.kind === 'decree' ||
          mv.kind === 'pass';
        const isCap = Boolean(mv.capturePos) || mv.kind === 'push';

        const geo = isCap || isAbility ? ringGeo : dotGeo;
        const mat = isAbility ? abilityRingMat : isCap ? captureRingMat : legalDotMat;
        const indicator = new THREE.Mesh(geo, mat);
        indicator.rotation.x = -Math.PI / 2;
        indicator.position.set(mv.to.col - 3.5, 0.026, mv.to.row - 3.5);
        highlightGroup.add(indicator);
      }

      // Forbidden squares (Ministro Decreto)
      for (const forb of gs.forbiddenSquares) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.45, 0.84), forbiddenMat);
        pillar.position.set(forb.col - 3.5, 0.23, forb.row - 3.5);
        highlightGroup.add(pillar);
      }

      // Frozen pieces (PM Abordagem)
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const p = gs.board[r][c];
          if (p && (p.frozenTurns ?? 0) > 0) {
            const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.05, 8), frozenMat);
            cage.position.set(c - 3.5, 0.55, r - 3.5);
            highlightGroup.add(cage);
          }
        }
      }

      let needsLoop = beamTimer > 0 || robotBounceRef.current > 0;
      for (const vis of pieceVisuals.values()) {
        if (vis.isMoving || vis.spawnProgress < 1) {
          needsLoop = true;
          break;
        }
      }
      if (needsLoop) {
        ensureLoopRunning();
      } else {
        requestRender();
      }
    };

    const setCameraTarget = (preset: CameraPreset, focusSquare?: Pos | null) => {
      cameraReturnPreset = preset;
      const aspect = camera.aspect || 1.6;
      if (focusSquare) {
        squareToWorld(focusSquare.row, focusSquare.col, _vec3A);
        const sideSign = preset === 'black' ? -1 : 1;
        cameraLerpTargetPos = new THREE.Vector3(
          _vec3A.x * 0.65,
          3.9,
          _vec3A.z + sideSign * 4.2
        );
        cameraLerpTargetLook = _vec3A.clone().setY(0.5);
        cameraReturnTimer = 1.05;
      } else {
        const cfg = getCameraCoords(preset, aspect);
        cameraLerpTargetPos = cfg.pos.clone();
        cameraLerpTargetLook = cfg.target.clone();
        cameraReturnTimer = 0;
      }
      activeAnimUntil = Math.max(activeAnimUntil, performance.now() + 1400);
      ensureLoopRunning();
    };

    syncFnRef.current = syncBoardVisuals;
    cameraFnRef.current = setCameraTarget;
    loopFnRef.current = ensureLoopRunning;

    // Raycasting (click vs drag detection)
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downX = 0;
    let downY = 0;
    let lastHoverMove = 0;

    const getHitSquare = (clientX: number, clientY: number): Pos | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const pieceHits = raycaster.intersectObjects(piecesLayer.children, true);
      if (pieceHits.length > 0 && pieceHits[0].object.userData.square) {
        return pieceHits[0].object.userData.square as Pos;
      }

      const sqHits = raycaster.intersectObjects(clickables, false);
      if (sqHits.length > 0 && sqHits[0].object.userData.square) {
        return sqHits[0].object.userData.square as Pos;
      }
      return null;
    };

    const onPointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (propsRef.current.isTitleScreen) return;
      const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (dist > 8) return; // Was orbiting camera
      const sq = getHitSquare(e.clientX, e.clientY);
      if (sq) {
        propsRef.current.onSquareClick(sq);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (propsRef.current.isTitleScreen) return;
      const now = performance.now();
      if (now - lastHoverMove < 45) return;
      lastHoverMove = now;

      const sq = getHitSquare(e.clientX, e.clientY);
      if (sq) {
        hoverMesh.position.set(sq.col - 3.5, 0.012, sq.row - 3.5);
        hoverMesh.visible = true;
        renderer.domElement.style.cursor = 'pointer';
      } else {
        hoverMesh.visible = false;
        renderer.domElement.style.cursor = 'grab';
      }
      requestRender();
    };

    const onControlStart = () => {
      cameraLerpTargetPos = null;
      cameraLerpTargetLook = null;
      cameraReturnTimer = 0;
    };

    const onControlChange = () => {
      requestRender();
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    controls.addEventListener('start', onControlStart);
    controls.addEventListener('change', onControlChange);

    // Loop & on-demand rendering
    let frameId = 0;
    let disposed = false;
    let loopRunning = false;
    let renderBusy = false;
    let renderDirty = false;
    let lastTime = performance.now();
    let elapsed = 0;

    function afterDraw(cb: () => void) {
      if (disposed) return;
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function requestRender() {
      if (disposed || loopRunning) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        renderBusy = false;
        if (disposed) return;
        controls.update();
        renderer.render(scene, camera);
        const done = () => {
          if (renderDirty) {
            renderDirty = false;
            requestRender();
          }
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    function stepAnimations(dt: number) {
      elapsed += dt;

      // Robôzinho gentle float & bounce
      if (robotBounceRef.current > 0) {
        robotBounceRef.current = Math.max(0, robotBounceRef.current - dt * 2.2);
      }
      const bounceOffset = Math.sin(robotBounceRef.current * Math.PI * 3) * robotBounceRef.current * 0.45;
      robotGroup.position.y = 1.35 + Math.sin(elapsed * 2.0) * 0.1 + bounceOffset;
      robotGroup.rotation.y = -0.65 + Math.sin(elapsed * 1.1) * 0.08;

      // Title screen smooth orbital pan inside the 3D room (showing table, computers, and Bold room)
      if (propsRef.current.isTitleScreen) {
        const angle = elapsed * 0.16 + 0.52;
        camera.position.set(Math.sin(angle) * 14.8, 6.2, Math.cos(angle) * 14.8);
        camera.lookAt(-2.6, -0.2, -0.6);
        controls.target.set(-2.6, -0.2, -0.6);
      } else {
        // Camera smooth damping toward preset/focus
        if (cameraReturnTimer > 0) {
          cameraReturnTimer -= dt;
          if (cameraReturnTimer <= 0) {
            const cfg = getCameraCoords(cameraReturnPreset, camera.aspect || 1.6);
            cameraLerpTargetPos = cfg.pos.clone();
            cameraLerpTargetLook = cfg.target.clone();
          }
        }
        if (cameraLerpTargetPos && cameraLerpTargetLook) {
          const factor = 1 - Math.exp(-5.5 * dt);
          camera.position.lerp(cameraLerpTargetPos, factor);
          controls.target.lerp(cameraLerpTargetLook, factor);
          if (
            camera.position.distanceToSquared(cameraLerpTargetPos) < 0.004 &&
            controls.target.distanceToSquared(cameraLerpTargetLook) < 0.004 &&
            cameraReturnTimer <= 0
          ) {
            camera.position.copy(cameraLerpTargetPos);
            controls.target.copy(cameraLerpTargetLook);
            cameraLerpTargetPos = null;
            cameraLerpTargetLook = null;
          }
        }
        controls.update();
      }

      // Piece glide & spawn drop animations
      let anyMoving = false;
      for (const vis of pieceVisuals.values()) {
        if (vis.spawnProgress < 1) {
          anyMoving = true;
          vis.spawnProgress = Math.min(1, vis.spawnProgress + dt * 2.2);
          const ease = 1 - Math.pow(1 - vis.spawnProgress, 3);
          vis.mesh.position.y = (1 - ease) * 2.4;
          vis.mesh.rotation.y = (1 - ease) * Math.PI * 2;
        }
        if (vis.isMoving) {
          anyMoving = true;
          vis.moveProgress = Math.min(1, vis.moveProgress + dt * 3.4);
          const t = 1 - Math.pow(1 - vis.moveProgress, 3);
          vis.currentPos.lerpVectors(vis.startPos, vis.targetPos, t);
          vis.currentPos.y = Math.sin(vis.moveProgress * Math.PI) * 0.52;
          vis.mesh.position.copy(vis.currentPos);
          if (vis.moveProgress >= 1) {
            vis.isMoving = false;
            vis.currentPos.copy(vis.targetPos);
            vis.mesh.position.copy(vis.targetPos);
          }
        }
      }

      // Convocation light beam decay
      if (beamTimer > 0) {
        anyMoving = true;
        beamTimer = Math.max(0, beamTimer - dt * 1.15);
        beamMat.opacity = beamTimer * 0.48;
        convocationBeam.scale.set(1 + (1 - beamTimer) * 0.7, 1, 1 + (1 - beamTimer) * 0.7);
        if (beamTimer <= 0) {
          convocationBeam.visible = false;
        }
      }

      return (
        anyMoving ||
        Boolean(cameraLerpTargetPos) ||
        propsRef.current.isTitleScreen ||
        robotBounceRef.current > 0
      );
    }

    function tick() {
      if (disposed) return;
      const now = performance.now();
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;
      const dt = Math.min(rawDt, 0.05);

      const keepLooping = stepAnimations(dt) || now < activeAnimUntil;
      if (currentRoomBuild) {
        const hideCeiling = camera.position.y > CEILING_Y - 2.2;
        for (const obj of currentRoomBuild.ceilingObjects) {
          obj.visible = !hideCeiling;
        }
      }
      renderer.render(scene, camera);

      if (keepLooping) {
        if (isSoftwareGl) afterDraw(tick);
        else frameId = requestAnimationFrame(tick);
      } else {
        loopRunning = false;
      }
    }

    function ensureLoopRunning() {
      if (disposed || loopRunning) return;
      loopRunning = true;
      lastTime = performance.now();
      if (isSoftwareGl) afterDraw(tick);
      else frameId = requestAnimationFrame(tick);
    }

    // ResizeObserver for crisp viewport sizing
    const ro = new ResizeObserver(() => {
      if (disposed) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (!propsRef.current.isTitleScreen && !cameraLerpTargetPos) {
        const cfg = getCameraCoords(propsRef.current.cameraPreset, w / h);
        camera.position.copy(cfg.pos);
        controls.target.copy(cfg.target);
        controls.update();
      }
      renderer.setSize(w, h);
      renderer.render(scene, camera);
    });
    ro.observe(container);

    const onContextLost = (e: Event) => {
      e.preventDefault();
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    applyRoomTheme(propsRef.current.roomId);
    syncBoardVisuals();
    stepAnimations(0.016);
    renderer.render(scene, camera);
    ensureLoopRunning();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);

      darkMarbleTex.dispose();
      lightMarbleTex.dispose();
      metalBump.dispose();
      boldBadgeTex.dispose();
      envTex.dispose();
      pieceMats.dispose();
      sqGeo.dispose();
      darkSqMat.dispose();
      lightSqMat.dispose();
      outerFrameMat.dispose();
      trimMat.dispose();
      emblemPlaqueMat.dispose();
      if (currentRoomBuild) {
        currentRoomBuild.dispose();
        currentRoomBuild = null;
      }
      coordMeshes.forEach((m) => {
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.map?.dispose();
        mat.dispose();
      });

      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Swap 3D room scenario cleanly without tearing down WebGL context
  useEffect(() => {
    setRoomFnRef.current?.(roomId);
  }, [roomId]);

  // Trigger visual board sync whenever state/selection/highlights change
  useEffect(() => {
    syncFnRef.current?.();
  }, [gameState, selectedSquare, legalMoves]);

  // Trigger camera preset damping when preset changes or returning from title
  useEffect(() => {
    if (!isTitleScreen) {
      cameraFnRef.current?.(cameraPreset, null);
    }
  }, [cameraPreset, isTitleScreen]);

  // Trigger close-up on captures or convocations + bounce robot
  useEffect(() => {
    const lm = gameState.lastMove;
    if (!lm || isTitleScreen) return;
    const lastHist = gameState.history[gameState.history.length - 1];
    if (lastHist && (lastHist.capturedKind || lastHist.kind === 'convocation' || lastHist.isCheck)) {
      robotBounceRef.current = 1;
      loopFnRef.current?.();
      if (lastHist.kind === 'convocation' || lastHist.capturedKind) {
        cameraFnRef.current?.(cameraPreset, lm.to);
      }
    }
  }, [gameState.history.length, isTitleScreen, cameraPreset, gameState.lastMove]);

  return (
    <div
      ref={mountRef}
      data-testid="chess-canvas"
      className="w-full h-full relative select-none"
    />
  );
}
