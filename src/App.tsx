import { useCallback, useEffect, useRef, useState } from 'react';
import { soundEngine } from './audio/soundEngine';
import { ConvocationModal } from './components/ConvocationModal';
import { GameHUD } from './components/GameHUD';
import { StatusModal } from './components/StatusModal';
import { TitleOverlay } from './components/TitleOverlay';
import {
  applyMove,
  createInitialState,
  getAvailableSquadSpecials,
  getLegalMoves,
  resolveConvocation,
} from './game/engine';
import {
  ClassicKind,
  Color,
  GameState,
  MEME_EMOTES,
  MoveOption,
  Pos,
  SPECIAL_BY_ID,
  SceneRoomId,
  SpecialId,
  getPieceDisplayName,
} from './game/types';
import { CameraPreset, ChessScene } from './three/ChessScene';

type AppScreenState = 'title' | 'playing' | 'paused' | 'gameover';

export default function App() {
  const isAutostart =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('autostart') === '1';

  const [screen, setScreen] = useState<AppScreenState>(isAutostart ? 'playing' : 'title');
  const [mode, setMode] = useState<'ai' | 'multiplayer'>('ai');
  const [gameState, setGameState] = useState<GameState>(() =>
    createInitialState(isAutostart)
  );
  const [selectedSquare, setSelectedSquare] = useState<Pos | null>(null);
  const [legalMoves, setLegalMoves] = useState<MoveOption[]>([]);
  const [pendingPromotionDest, setPendingPromotionDest] = useState<Pos | null>(null);
  const [playerColor, setPlayerColor] = useState<Color | 'spectator'>('w');
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('white');
  const [sceneRoom, setSceneRoom] = useState<SceneRoomId>('bold_office');
  const [aiThinking, setAiThinking] = useState(false);

  // Multiplayer room state
  const [roomId, setRoomId] = useState<string | null>(null);
  const [playersConnected, setPlayersConnected] = useState(1);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Audio & Mascot Narrator state
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const [emoteCooldownSec, setEmoteCooldownSec] = useState(0);
  const [robotSpeech, setRobotSpeech] = useState(
    'Partida pronta! Escolha suas jogadas com ousadia.'
  );
  const [robotSpeaker, setRobotSpeaker] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const aiReqIdRef = useRef(0);
  const lastHistoryLenRef = useRef(0);

  // Mirror screen & selected 3D room state to document.body.dataset
  useEffect(() => {
    document.body.dataset.state = screen;
    document.body.dataset.room = sceneRoom;
  }, [screen, sceneRoom]);

  // Load audio manifest once
  useEffect(() => {
    soundEngine.initManifest();
  }, []);

  // Emote cooldown ticker
  useEffect(() => {
    if (emoteCooldownSec <= 0) return;
    const id = window.setTimeout(() => {
      setEmoteCooldownSec((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearTimeout(id);
  }, [emoteCooldownSec]);

  // Spawn AI Web Worker
  useEffect(() => {
    const worker = new Worker(new URL('./game/aiWorker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;

    worker.onmessage = (event) => {
      const { requestId, move, nextState, convocationChoice } = event.data as {
        requestId: number;
        move?: MoveOption | null;
        nextState?: GameState;
        convocationChoice?: SpecialId | ClassicKind | 'keep_pawn';
      };
      if (requestId !== aiReqIdRef.current) return;
      setAiThinking(false);

      if (nextState) {
        setGameState(nextState);
        if (convocationChoice && convocationChoice !== 'keep_pawn' && convocationChoice in SPECIAL_BY_ID) {
          const sp = SPECIAL_BY_ID[convocationChoice as SpecialId];
          soundEngine.playConvocation(sp.id);
          setRobotSpeaker(sp.name);
          setRobotSpeech(sp.catchphrase);
        }
        return;
      }

      if (move) {
        setGameState((prev) => applyMove(prev, move));
      }
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // React to history updates for sound effects, mascot reactions, and gameover transition
  useEffect(() => {
    const histLen = gameState.history.length;
    if (histLen > lastHistoryLenRef.current) {
      const last = gameState.history[histLen - 1];
      lastHistoryLenRef.current = histLen;

      if (last.isCheckmate) {
        soundEngine.playVictory();
        setRobotSpeaker('Robôzinho da Bold');
        setRobotSpeech('XEQUE-MATE! Vitória garantida no tabuleiro da Bold!');
      } else if (gameState.winner === 'draw') {
        soundEngine.playDraw();
        setRobotSpeaker('Robôzinho da Bold');
        setRobotSpeech(
          gameState.endReason === 'insufficient_material'
            ? 'Empate! Nenhum dos jogadores tem mais como dar xeque-mate.'
            : 'Empate declarado no tabuleiro!'
        );
      } else if (last.isCheck) {
        soundEngine.playCheck();
        setRobotSpeaker('Robôzinho da Bold');
        setRobotSpeech('Olha o xeque! Proteja o rei agora!');
      } else if (last.kind === 'convocation' && last.pieceKind in SPECIAL_BY_ID) {
        const sp = SPECIAL_BY_ID[last.pieceKind as SpecialId];
        soundEngine.playConvocation(sp.id);
        setRobotSpeaker(sp.name);
        setRobotSpeech(sp.catchphrase);
      } else if (last.capturedKind) {
        soundEngine.playCapture();
        setRobotSpeaker('Robôzinho da Bold');
        setRobotSpeech(
          `${getPieceDisplayName(last.pieceKind)} capturou ${getPieceDisplayName(last.capturedKind)}!`
        );
      } else {
        soundEngine.playMove();
        setRobotSpeaker('Robôzinho da Bold');
        setRobotSpeech(
          `${last.color === 'w' ? 'Brancas jogaram' : 'Pretas jogaram'}: ${getPieceDisplayName(last.pieceKind)}.`
        );
      }
    } else if (histLen === 0) {
      lastHistoryLenRef.current = 0;
    }

    if (gameState.winner && screen === 'playing') {
      const timer = window.setTimeout(() => {
        setScreen('gameover');
      }, 550);
      return () => clearTimeout(timer);
    }
  }, [gameState, screen]);

  // Trigger AI Convocation & AI Turn when in AI mode
  useEffect(() => {
    if (mode !== 'ai' || screen !== 'playing') return;
    if (gameState.winner) return;

    // AI Pending Convocation
    if (gameState.pendingConvocation && gameState.pendingConvocation.color === 'b') {
      setAiThinking(true);
      aiReqIdRef.current += 1;
      workerRef.current?.postMessage({
        requestId: aiReqIdRef.current,
        state: gameState,
        aiColor: 'b',
        depth: 3,
      });
      return;
    }

    // AI Turn Move
    if (gameState.turn === 'b' && !gameState.pendingConvocation) {
      setAiThinking(true);
      aiReqIdRef.current += 1;
      const reqId = aiReqIdRef.current;
      const timer = window.setTimeout(() => {
        workerRef.current?.postMessage({
          requestId: reqId,
          state: gameState,
          aiColor: 'b',
          depth: 3,
        });
      }, 260);
      return () => clearTimeout(timer);
    }
  }, [mode, screen, gameState]);

  // Connect to WebSocket room
  const connectToRoom = useCallback((id: string) => {
    wsRef.current?.close();
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', roomId: id }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string) as {
        type: string;
        roomId?: string;
        sceneRoom?: SceneRoomId;
        yourColor?: Color | 'spectator';
        state?: GameState;
        playersConnected?: number;
        emoteId?: string;
        fromColor?: Color;
      };

      if (msg.type === 'joined' && msg.state) {
        setRoomId(msg.roomId ?? id);
        if (msg.sceneRoom) setSceneRoom(msg.sceneRoom);
        setMode('multiplayer');
        setPlayerColor(msg.yourColor ?? 'w');
        setCameraPreset(msg.yourColor === 'b' ? 'black' : 'white');
        setPlayersConnected(msg.playersConnected ?? 1);
        setGameState(msg.state);
        setSelectedSquare(null);
        setLegalMoves([]);
        setScreen('playing');
      } else if (msg.type === 'state' && msg.state) {
        setGameState(msg.state);
        setSelectedSquare(null);
        setLegalMoves([]);
      } else if (msg.type === 'presence' && typeof msg.playersConnected === 'number') {
        setPlayersConnected(msg.playersConnected);
      } else if (msg.type === 'emote' && msg.emoteId) {
        const em = MEME_EMOTES.find((e) => e.id === msg.emoteId);
        if (em) {
          soundEngine.playEmote(em.id);
          setRobotSpeaker(msg.fromColor === 'b' ? 'Pretas (Emote)' : 'Brancas (Emote)');
          setRobotSpeech(em.speech);
        }
      }
    };
  }, []);

  const handleStartAI = useCallback((_skipDraft = true) => {
    wsRef.current?.close();
    wsRef.current = null;
    setRoomId(null);
    setMode('ai');
    setPlayerColor('w');
    setCameraPreset('white');
    setSelectedSquare(null);
    setLegalMoves([]);
    setPendingPromotionDest(null);
    setGameState(createInitialState(true));
    setRobotSpeaker('Robôzinho da Bold');
    setRobotSpeech(
      'Partida aberta! Chegue à 6ª ou 8ª fileira para convocar especiais.'
    );
    setScreen('playing');
  }, []);

  const handleCreateRoom = useCallback(async () => {
    setIsCreatingRoom(true);
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneRoom }),
      });
      const data = (await res.json()) as { roomId: string; sceneRoom?: SceneRoomId };
      window.history.replaceState({}, '', `/?room=${data.roomId}`);
      connectToRoom(data.roomId);
    } finally {
      setIsCreatingRoom(false);
    }
  }, [connectToRoom, sceneRoom]);

  const handleJoinRoom = useCallback(
    (code: string) => {
      window.history.replaceState({}, '', `/?room=${code}`);
      connectToRoom(code);
    },
    [connectToRoom]
  );

  // Handle ?autostart=1 and ?room=XXXX query params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    const autostart = params.get('autostart');
    if (roomParam) {
      connectToRoom(roomParam.toUpperCase());
    } else if (autostart === '1') {
      handleStartAI(true);
    }
  }, [connectToRoom, handleStartAI]);

  // Keyboard shortcuts (Enter/Space on title, Esc/P to pause, M to mute)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (screen === 'title' && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        handleStartAI(false);
        return;
      }
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        if (screen === 'playing') setScreen('paused');
        else if (screen === 'paused') setScreen('playing');
      }
      if (e.key === 'm' || e.key === 'M') {
        setMuted((prev) => {
          const next = !prev;
          soundEngine.setMuted(next);
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [screen, handleStartAI]);

  const handleSquareClick = useCallback(
    (pos: Pos) => {
      if (screen !== 'playing' || gameState.draft.phase !== 'playing' || gameState.winner) return;
      if (gameState.pendingConvocation) return;

      const myTurnColor = mode === 'ai' ? 'w' : playerColor;
      if (myTurnColor === 'spectator' || gameState.turn !== myTurnColor) return;

      // Check if clicking a legal move destination for the currently selected piece
      const matchedMove = legalMoves.find(
        (m) => m.to.row === pos.row && m.to.col === pos.col
      );
      if (matchedMove) {
        if (matchedMove.kind === 'promotion') {
          setPendingPromotionDest(pos);
          return;
        }

        if (mode === 'multiplayer' && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'move', move: matchedMove }));
        } else {
          setGameState((prev) => applyMove(prev, matchedMove));
        }
        setSelectedSquare(null);
        setLegalMoves([]);
        return;
      }

      // Otherwise select friendly piece
      const clickedPiece = gameState.board[pos.row][pos.col];
      if (clickedPiece && clickedPiece.color === myTurnColor) {
        if (
          selectedSquare &&
          selectedSquare.row === pos.row &&
          selectedSquare.col === pos.col
        ) {
          setSelectedSquare(null);
          setLegalMoves([]);
          return;
        }
        const moves = getLegalMoves(gameState, pos);
        setSelectedSquare(pos);
        setLegalMoves(moves);
      } else {
        setSelectedSquare(null);
        setLegalMoves([]);
      }
    },
    [screen, gameState, mode, playerColor, legalMoves, selectedSquare]
  );

  const handleResolveConvocation = (choice: SpecialId | ClassicKind | 'keep_pawn') => {
    if (pendingPromotionDest) {
      if (choice === 'keep_pawn') return;
      const targetMove =
        legalMoves.find(
          (m) =>
            m.kind === 'promotion' &&
            m.to.row === pendingPromotionDest.row &&
            m.to.col === pendingPromotionDest.col &&
            m.promoteTo === choice
        ) ??
        legalMoves.find(
          (m) =>
            m.kind === 'promotion' &&
            m.to.row === pendingPromotionDest.row &&
            m.to.col === pendingPromotionDest.col &&
            m.promoteTo === 'q'
        );
      setPendingPromotionDest(null);
      setSelectedSquare(null);
      setLegalMoves([]);
      if (targetMove) {
        if (mode === 'multiplayer' && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'move', move: targetMove }));
        } else {
          setGameState((prev) => applyMove(prev, targetMove));
        }
      }
      return;
    }

    if (mode === 'multiplayer' && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'convocate', choice }));
    } else {
      setGameState((prev) => resolveConvocation(prev, choice));
    }
  };

  const handleSendEmote = (emoteId: string) => {
    if (emoteCooldownSec > 0) return;
    setEmoteCooldownSec(10);

    if (mode === 'multiplayer' && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'emote', emoteId }));
    } else {
      const em = MEME_EMOTES.find((e) => e.id === emoteId);
      if (em) {
        soundEngine.playEmote(em.id);
        setRobotSpeaker('Você (Emote)');
        setRobotSpeech(em.speech);
      }
    }
  };

  const handleResign = () => {
    if (mode === 'multiplayer' && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'resign' }));
    } else {
      setGameState((prev) => ({
        ...prev,
        winner: 'b',
        endReason: 'resign',
      }));
      setScreen('gameover');
    }
  };

  const handleRestart = () => {
    if (mode === 'multiplayer' && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'rematch' }));
      setScreen('playing');
    } else {
      handleStartAI(false);
    }
  };

  const handleReturnTitle = () => {
    wsRef.current?.close();
    wsRef.current = null;
    setRoomId(null);
    window.history.replaceState({}, '', '/');
    setGameState(createInitialState(false));
    setSelectedSquare(null);
    setLegalMoves([]);
    setScreen('title');
  };

  const showMyConvocation =
    gameState.pendingConvocation &&
    (mode === 'ai'
      ? gameState.pendingConvocation.color === 'w'
      : gameState.pendingConvocation.color === playerColor);

  return (
    <main className="w-screen h-screen relative overflow-hidden bg-[#070B14]">
      {/* Isolated 3D WebGL Viewport */}
      <ChessScene
        gameState={gameState}
        selectedSquare={selectedSquare}
        legalMoves={legalMoves}
        playerPerspective={playerColor === 'b' ? 'b' : 'w'}
        cameraPreset={cameraPreset}
        roomId={sceneRoom}
        isTitleScreen={screen === 'title'}
        robotMood={gameState.inCheck ? 'alert' : 'idle'}
        onSquareClick={handleSquareClick}
      />

      {/* Title Screen Overlay */}
      {screen === 'title' && (
        <TitleOverlay
          selectedRoom={sceneRoom}
          onSelectRoom={setSceneRoom}
          onStartAI={() => handleStartAI(false)}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          isCreatingRoom={isCreatingRoom}
        />
      )}

      {/* Active Match HUD */}
      {screen === 'playing' && gameState.draft.phase === 'playing' && (
        <GameHUD
          gameState={gameState}
          mode={mode}
          sceneRoom={sceneRoom}
          playerColor={playerColor}
          roomId={roomId}
          playersConnected={playersConnected}
          aiThinking={aiThinking}
          selectedSquare={selectedSquare}
          legalMoves={legalMoves}
          cameraPreset={cameraPreset}
          muted={muted}
          volume={volume}
          emoteCooldownSec={emoteCooldownSec}
          robotSpeech={robotSpeech}
          robotSpeaker={robotSpeaker}
          onCameraPreset={setCameraPreset}
          onToggleMute={() => {
            const next = !muted;
            setMuted(next);
            soundEngine.setMuted(next);
          }}
          onVolumeChange={(v) => {
            setVolume(v);
            setMuted(v === 0);
            soundEngine.setMuted(v === 0);
            soundEngine.setVolume(v);
          }}
          onSendEmote={handleSendEmote}
          onPause={() => setScreen('paused')}
          onResign={handleResign}
        />
      )}

      {/* 6th Rank Convocation / 8th Rank Promotion Modal */}
      {screen === 'playing' &&
        (showMyConvocation && gameState.pendingConvocation ? (
          <ConvocationModal
            pending={gameState.pendingConvocation}
            usedCount={gameState.usedSpecials[gameState.pendingConvocation.color].length}
            onResolve={handleResolveConvocation}
          />
        ) : pendingPromotionDest ? (
          (() => {
            const c: Color = mode === 'ai' ? 'w' : playerColor === 'b' ? 'b' : 'w';
            return (
              <ConvocationModal
                pending={{
                  color: c,
                  pos: pendingPromotionDest,
                  isLastRank: true,
                  availableSpecials: getAvailableSquadSpecials(gameState, c),
                }}
                usedCount={gameState.usedSpecials[c].length}
                onResolve={handleResolveConvocation}
              />
            );
          })()
        ) : null)}

      {/* Pause / Game Over Modal */}
      {(screen === 'paused' || screen === 'gameover') && (
        <StatusModal
          status={screen}
          gameState={gameState}
          onResume={() => setScreen('playing')}
          onRestart={handleRestart}
          onReturnTitle={handleReturnTitle}
        />
      )}
    </main>
  );
}
