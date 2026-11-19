import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { soundEngine } from './audio/soundEngine';
import { ConvocationModal } from './components/ConvocationModal';
import { GameHUD } from './components/GameHUD';
import { GameSetupModal } from './components/GameSetupModal';
import { SidePanel } from './components/SidePanel';
import { TurnBanner, TurnGlow } from './components/TurnBanner';
import { InviteToast, MatchPointsCard, inviteResultText, type IncomingInvite, type Notice } from './components/InviteToast';
import { Lobby } from './components/Lobby';
import { SpectatorBar } from './components/SpectatorBar';
import Leaderboard from './components/Leaderboard';
import { StatusModal } from './components/StatusModal';
import { TitleOverlay } from './components/TitleOverlay';
import {
  applyMove,
  createInitialState,
  getConvocationOffer,
  getLegalMoves,
  resolveConvocation,
} from './game/engine';
import { flagged, startClock, stampMove, stopClock, timeoutState, withClock } from './game/clock';
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
  TimeControl,
  getPieceDisplayName,
} from './game/types';
import { CameraPreset, ChessScene } from './three/ChessScene';
import type { SocketStatus } from './net/socket';
import { createTransport, type GameTransport } from './net/transport';
import {
  getToken,
  initWorkspace,
  notifyLocal,
  onNavigate,
  onTabActive,
  onThemeChange,
  setReady,
  setTitle,
  WorkspaceError,
} from './workspace/bridge';
import {
  ROOM_CODE_REGEX,
  type ClientMessage,
  type ErrorCode,
  type MatchResult,
  type OnlineUser,
  type PointsAward,
  type RoomSeatInfo,
  type RoomSummary,
  type Seat,
} from './shared/protocol';

type AppScreenState = 'title' | 'lobby' | 'playing' | 'paused' | 'gameover';

interface MeInfo {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

interface MatchEndInfo {
  result: MatchResult;
  reason: string;
  points: PointsAward[];
}

const ERROR_TEXT: Partial<Record<ErrorCode, string>> = {
  not_authenticated: 'Você ainda não está autenticado. Aguarde a conexão.',
  room_not_found: 'Sala não encontrada. Confira o código e tente de novo.',
  room_full: 'A sala está cheia.',
  not_your_turn: 'Não é a sua vez.',
  not_a_player: 'Espectadores não podem jogar.',
  user_offline: 'Esse jogador está offline.',
  user_busy: 'Esse jogador já está em uma partida.',
  self_challenge: 'Você não pode desafiar a si mesmo.',
  rate_limited: 'Muitas ações em pouco tempo. Aguarde um instante.',
  bad_request: 'Pedido inválido.',
};

function readRoomParam(): string | null {
  const v = new URLSearchParams(window.location.search).get('room');
  return v ? v.trim().toUpperCase() : null;
}

function writeRoomParam(code: string | null) {
  try {
    const params = new URLSearchParams(window.location.search);
    if (code) params.set('room', code);
    else params.delete('room');
    const qs = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  } catch {
    /* ambientes sem history */
  }
}

let noticeSeq = 1;

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
  const [playerColor, setPlayerColor] = useState<Seat>('w');
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('white');
  const [sceneRoom, setSceneRoom] = useState<SceneRoomId>('bold_office');
  const [aiThinking, setAiThinking] = useState(false);
  /** Escolha de modo/tempo pendente (modal antes de comecar). */
  const [setup, setSetup] = useState<null | { kind: 'ai' } | { kind: 'room' } | { kind: 'challenge'; userId: string }>(null);
  /** Peca adversaria (ou fora da vez) inspecionada so para visualizar movimentos. */
  const [inspectSquare, setInspectSquare] = useState<Pos | null>(null);
  const aiTimeRef = useRef<TimeControl | null>(null);
  const pausedAtRef = useRef<number | null>(null);

  // Workspace / conexao
  const [boot, setBoot] = useState<{ phase: 'loading' | 'ready' | 'error'; error?: WorkspaceError | Error }>({
    phase: 'loading',
  });
  const [bootNonce, setBootNonce] = useState(0);
  const [me, setMe] = useState<MeInfo | null>(null);
  const [connection, setConnection] = useState<SocketStatus>('idle');
  const socketRef = useRef<GameTransport | null>(null);

  // Lobby / sala
  const [online, setOnline] = useState<OnlineUser[]>([]);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [seats, setSeats] = useState<RoomSeatInfo | null>(null);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [challengingUserId, setChallengingUserId] = useState<string | null>(null);
  const [invites, setInvites] = useState<IncomingInvite[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [matchEnd, setMatchEnd] = useState<MatchEndInfo | null>(null);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);

  // Espelhos em ref para handlers do socket (evita reconectar a cada render)
  const screenRef = useRef(screen);
  const modeRef = useRef(mode);
  const roomIdRef = useRef<string | null>(null);
  const meRef = useRef<MeInfo | null>(null);
  const tabActiveRef = useRef(true);
  const pendingJoinRef = useRef<string | null>(readRoomParam());
  const lastJoinRef = useRef<{ code: string; asSpectator: boolean } | null>(null);
  const firstAuthRef = useRef(true);
  const sceneRoomRef = useRef(sceneRoom);
  screenRef.current = screen;
  modeRef.current = mode;
  sceneRoomRef.current = sceneRoom;
  meRef.current = me;

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

  const pushNotice = useCallback((text: string, kind: Notice['kind'] = 'info') => {
    const id = noticeSeq++;
    setNotices((prev) => [...prev.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setNotices((prev) => prev.filter((n) => n.id !== id)), 6000);
  }, []);

  // Mirror screen & selected 3D room state to document.body.dataset
  useEffect(() => {
    document.body.dataset.state = screen;
    document.body.dataset.room = sceneRoom;
  }, [screen, sceneRoom]);

  // Vez do jogador local: usada no titulo, no brilho da borda e no banner
  const myTurnNow = useMemo(() => {
    if (screen !== 'playing' || gameState.winner || gameState.draft.phase !== 'playing') return false;
    const mine: Color | null = mode === 'ai' ? 'w' : playerColor === 'w' || playerColor === 'b' ? playerColor : null;
    if (!mine) return false;
    if (mode === 'multiplayer' && !(seats?.w && seats?.b)) return false;
    const active = gameState.pendingConvocation ? gameState.pendingConvocation.color : gameState.turn;
    return active === mine;
  }, [screen, gameState, mode, playerColor, seats]);

  // Titulo do painel no Workspace
  useEffect(() => {
    if (boot.phase === 'ready') {
      const base = roomId ? `Xadrez Bold - sala ${roomId}` : 'Xadrez Bold';
      setTitle(myTurnNow ? `▶ Sua vez · ${base}` : base);
    }
  }, [roomId, boot.phase, myTurnNow]);

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
        setGameState((prev) => stampMove(prev, nextState, Date.now()));
        if (convocationChoice && convocationChoice !== 'keep_pawn' && convocationChoice in SPECIAL_BY_ID) {
          const sp = SPECIAL_BY_ID[convocationChoice as SpecialId];
          soundEngine.playConvocation(sp.id);
          setRobotSpeaker(sp.name);
          setRobotSpeech(sp.catchphrase);
        }
        return;
      }

      if (move) {
        setGameState((prev) => stampMove(prev, applyMove(prev, move), Date.now()));
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

  // ---------- Relogio local (modo contra a IA) ----------
  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;

  // Tempo esgotado contra a IA
  useEffect(() => {
    if (mode !== 'ai' || screen !== 'playing' || !gameState.clock) return;
    const id = window.setInterval(() => {
      const cur = gameStateRef.current;
      const loser = flagged(cur, Date.now());
      if (loser) setGameState(timeoutState(cur, loser));
    }, 250);
    return () => window.clearInterval(id);
  }, [mode, screen, !!gameState.clock, gameState.winner]);

  // Pausa congela o relogio local; ao retomar, empurra o inicio do turno pelo tempo parado
  useEffect(() => {
    if (mode !== 'ai') return;
    if (screen === 'paused') {
      pausedAtRef.current = Date.now();
    } else if (pausedAtRef.current !== null) {
      const stoppedFor = Date.now() - pausedAtRef.current;
      pausedAtRef.current = null;
      if (screen === 'playing' && stoppedFor > 0) {
        setGameState((prev) =>
          prev.clock && prev.clock.turnStartedAt !== null
            ? { ...prev, clock: { ...prev.clock, turnStartedAt: prev.clock.turnStartedAt + stoppedFor } }
            : prev
        );
      }
    }
  }, [screen, mode]);

  // A selecao de inspecao some quando o jogo anda
  useEffect(() => {
    setInspectSquare(null);
  }, [gameState.history.length]);

  // ---------- Sala: helpers ----------
  /** Sai da sala so no estado local (o servidor ja sabe ou nao precisa saber). */
  const resetRoomLocal = useCallback((nextScreen: AppScreenState) => {
    roomIdRef.current = null;
    setRoomId(null);
    setSeats(null);
    setMatchEnd(null);
    setIsCreatingRoom(false);
    setPlayerColor('w');
    setCameraPreset('white');
    setSelectedSquare(null);
    setLegalMoves([]);
    setPendingPromotionDest(null);
    setGameState(createInitialState(false));
    writeRoomParam(null);
    setMode('ai');
    setScreen(nextScreen);
  }, []);

  const joinRoom = useCallback((code: string, asSpectator = false) => {
    const clean = code.trim().toUpperCase();
    if (!ROOM_CODE_REGEX.test(clean)) {
      pushNotice('Código de sala inválido. Use 6 caracteres (letras e números).', 'error');
      return;
    }
    lastJoinRef.current = { code: clean, asSpectator };
    socketRef.current?.send({ type: 'join', roomId: clean, asSpectator: asSpectator || undefined });
  }, [pushNotice]);

  const leaveRoom = useCallback(() => {
    if (roomIdRef.current) socketRef.current?.send({ type: 'leave' });
    resetRoomLocal('lobby');
  }, [resetRoomLocal]);

  // ---------- Boot: Workspace + WebSocket ----------
  useEffect(() => {
    let cancelled = false;
    const cleanups: Array<() => void> = [];
    setBoot({ phase: 'loading' });
    firstAuthRef.current = true;

    (async () => {
      try {
        const init = await initWorkspace();
        if (cancelled) return;
        setMe(init.identity);
        meRef.current = init.identity;

        cleanups.push(onThemeChange(() => {}));
        const applyActive = () => {
          const eff = tabActiveRef.current && !document.hidden;
          document.body.dataset.tabActive = eff ? '1' : '0';
          socketRef.current?.setActive?.(eff);
        };
        cleanups.push(
          onTabActive((active) => {
            tabActiveRef.current = active;
            applyActive();
          })
        );
        document.addEventListener('visibilitychange', applyActive);
        cleanups.push(() => document.removeEventListener('visibilitychange', applyActive));
        cleanups.push(
          onNavigate((path) => {
            try {
              const target = new URL(path, window.location.origin);
              const code = (target.searchParams.get('room') ?? '').toUpperCase();
              if (code && code !== roomIdRef.current) {
                pendingJoinRef.current = code;
                joinRoom(code);
              } else if (!code && roomIdRef.current && modeRef.current === 'multiplayer') {
                leaveRoom();
              }
            } catch {
              /* rota invalida: ignora */
            }
          })
        );

        const socket = createTransport({ getToken });
        socketRef.current = socket;
        socket.setActive?.(tabActiveRef.current && !document.hidden);
        cleanups.push(() => {
          socket.close();
          if (socketRef.current === socket) socketRef.current = null;
        });

        socket.on('status', (st) => setConnection(st));

        socket.on('auth_ok', (msg) => {
          const ws = meRef.current;
          setMe({
            userId: msg.me.userId,
            name: ws?.name || msg.me.name,
            avatarUrl: ws?.avatarUrl ?? msg.me.avatarUrl,
          });
          setBoot({ phase: 'ready' });
          setReady();
          socket.send({ type: 'lobby_list' });
          if (firstAuthRef.current) {
            firstAuthRef.current = false;
            const target = pendingJoinRef.current ?? msg.resumeRoomId;
            pendingJoinRef.current = null;
            if (target && !socket.roomId) joinRoom(target);
          }
        });

        socket.on('auth_error', (msg) => {
          if (msg.code === 'invalid_token') {
            setBoot({
              phase: 'error',
              error: new Error('Sua sessão do Workspace não é válida. Recarregue ou entre novamente.'),
            });
          } else if (msg.code === 'auth_unavailable') {
            pushNotice('Autenticação indisponível no momento. Tentando de novo...', 'error');
          }
        });

        socket.on('lobby', (msg) => {
          setOnline(msg.online);
          setRooms(msg.rooms);
        });

        socket.on('room_created', (msg) => {
          setIsCreatingRoom(false);
          // O servidor pode ou nao entrar o criador automaticamente: garante a entrada.
          window.setTimeout(() => {
            if (roomIdRef.current !== msg.roomId) joinRoom(msg.roomId);
          }, 300);
        });

        socket.on('joined', (msg) => {
          roomIdRef.current = msg.roomId;
          lastJoinRef.current = null;
          pendingJoinRef.current = null;
          setRoomId(msg.roomId);
          setSceneRoom(msg.sceneRoom);
          setMode('multiplayer');
          setPlayerColor(msg.yourSeat);
          setCameraPreset(msg.yourSeat === 'b' ? 'black' : 'white');
          setSeats(msg.seats);
          setGameState(msg.state);
          setSelectedSquare(null);
          setLegalMoves([]);
          setPendingPromotionDest(null);
          setIsCreatingRoom(false);
          setChallengingUserId(null);
          if (!msg.resumed) setMatchEnd(null);
          writeRoomParam(msg.roomId);
          setScreen('playing');
        });

        socket.on('seats', (msg) => setSeats(msg.seats));

        socket.on('left', () => {
          if (roomIdRef.current) resetRoomLocal('lobby');
        });

        socket.on('state', (msg) => {
          setGameState(msg.state);
          setSelectedSquare(null);
          setLegalMoves([]);
          if (!msg.state.winner && screenRef.current === 'gameover' && modeRef.current === 'multiplayer') {
            setMatchEnd(null);
            setScreen('playing');
          }
        });

        socket.on('emote', (msg) => {
          const em = MEME_EMOTES.find((e) => e.id === msg.emoteId);
          if (em) {
            soundEngine.playEmote(em.id);
            setRobotSpeaker(msg.fromColor === 'b' ? 'Pretas (Emote)' : 'Brancas (Emote)');
            setRobotSpeech(em.speech);
          }
        });

        socket.on('invite', (msg) => {
          setInvites((prev) =>
            prev.some((i) => i.inviteId === msg.inviteId)
              ? prev
              : [...prev, { inviteId: msg.inviteId, from: msg.from, roomId: msg.roomId, expiresAt: msg.expiresAt, time: msg.time ?? null }]
          );
          if (!tabActiveRef.current) notifyLocal('Xadrez Bold', `${msg.from.name} te desafiou para uma partida`);
        });

        socket.on('invite_result', (msg) => {
          setChallengingUserId(null);
          setInvites((prev) => prev.filter((i) => i.inviteId !== msg.inviteId));
          const t = inviteResultText(msg.status);
          pushNotice(t.text, t.kind);
          if (msg.status === 'accepted' && msg.roomId && roomIdRef.current !== msg.roomId) {
            joinRoom(msg.roomId);
          }
        });

        socket.on('match_ended', (msg) => {
          setMatchEnd({ result: msg.result, reason: msg.reason, points: msg.points });
        });

        socket.on('error', (msg) => {
          setIsCreatingRoom(false);
          const text = msg.message || ERROR_TEXT[msg.code] || 'Algo deu errado.';
          if (msg.code === 'room_not_found') {
            pushNotice(text, 'error');
            lastJoinRef.current = null;
            if (!roomIdRef.current) {
              writeRoomParam(null);
              setScreen((s) => (s === 'playing' || s === 'gameover' ? 'lobby' : s === 'title' ? 'lobby' : s));
            }
            return;
          }
          if (msg.code === 'room_full' && lastJoinRef.current && !lastJoinRef.current.asSpectator) {
            const { code } = lastJoinRef.current;
            lastJoinRef.current = { code, asSpectator: true };
            socket.send({ type: 'join', roomId: code, asSpectator: true });
            pushNotice('Sala cheia: entrando como espectador.', 'info');
            return;
          }
          if (msg.code === 'user_busy' || msg.code === 'user_offline') setChallengingUserId(null);
          pushNotice(text, 'error');
        });

        socket.connect();
      } catch (err) {
        if (cancelled) return;
        setBoot({ phase: 'error', error: err instanceof Error ? err : new Error(String(err)) });
      }
    })();

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootNonce]);

  // Deep link com a conexao pronta, vindo da URL: lobby se nao ha ?room (tela inicial fica como esta)
  // Lobby: atualiza lista periodicamente enquanto aberto
  useEffect(() => {
    if (screen !== 'lobby' || connection !== 'ready') return;
    socketRef.current?.send({ type: 'lobby_list' });
    const id = window.setInterval(() => socketRef.current?.send({ type: 'lobby_list' }), 8000);
    return () => window.clearInterval(id);
  }, [screen, connection]);

  // Timeout de seguranca para estados "aguardando"
  useEffect(() => {
    if (!challengingUserId) return;
    const id = window.setTimeout(() => setChallengingUserId(null), 65_000);
    return () => clearTimeout(id);
  }, [challengingUserId]);
  useEffect(() => {
    if (!isCreatingRoom) return;
    const id = window.setTimeout(() => setIsCreatingRoom(false), 6000);
    return () => clearTimeout(id);
  }, [isCreatingRoom]);

  const handleStartAI = useCallback((_skipDraft = true, time?: TimeControl | null) => {
    if (time !== undefined) aiTimeRef.current = time;
    if (roomIdRef.current) socketRef.current?.send({ type: 'leave' });
    roomIdRef.current = null;
    setRoomId(null);
    setSeats(null);
    setMatchEnd(null);
    writeRoomParam(null);
    setMode('ai');
    setPlayerColor('w');
    setCameraPreset('white');
    setSelectedSquare(null);
    setLegalMoves([]);
    setPendingPromotionDest(null);
    setGameState(withClock(createInitialState(true), aiTimeRef.current, aiTimeRef.current ? Date.now() : null));
    setInspectSquare(null);
    setRobotSpeaker('Robôzinho da Bold');
    setRobotSpeech(
      'Partida aberta! Chegue à 6ª ou 8ª fileira para convocar especiais.'
    );
    setScreen('playing');
  }, []);

  const handleCreateRoom = useCallback((time: TimeControl | null) => {
    if (!socketRef.current) return;
    setIsCreatingRoom(true);
    socketRef.current.send({ type: 'create_room', sceneRoom, time });
  }, [sceneRoom]);

  const handleChallenge = useCallback(
    (userId: string, time: TimeControl | null) => {
      setChallengingUserId(userId);
      socketRef.current?.send({ type: 'challenge', targetUserId: userId, sceneRoom, time });
      pushNotice('Desafio enviado. Aguardando resposta...', 'info');
    },
    [sceneRoom, pushNotice]
  );

  const handleInviteResponse = useCallback((inviteId: string, accept: boolean) => {
    socketRef.current?.send({ type: 'invite_response', inviteId, accept });
    setInvites((prev) => prev.filter((i) => i.inviteId !== inviteId));
  }, []);

  const handleInviteExpire = useCallback((inviteId: string) => {
    setInvites((prev) => prev.filter((i) => i.inviteId !== inviteId));
  }, []);

  // Autostart legado (?autostart=1) sem sala
  useEffect(() => {
    if (isAutostart && !readRoomParam()) handleStartAI(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts (Enter/Space on title, Esc/P to pause, M to mute)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (screen === 'title' && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        setSetup((cur) => cur ?? { kind: 'ai' });
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
  }, [screen]);

  const isSpectator = mode === 'multiplayer' && playerColor === 'spectator';

  /** Envia acao de jogo ao servidor; false se bloqueada (espectador/offline). */
  const sendGameAction = useCallback(
    (msg: ClientMessage): boolean => {
      if (playerColor === 'spectator') {
        pushNotice('Você está assistindo: espectadores não podem jogar.', 'info');
        return false;
      }
      const sock = socketRef.current;
      if (!sock || connection !== 'ready') {
        pushNotice('Sem conexão com o servidor. Reconectando...', 'error');
        return false;
      }
      sock.send(msg);
      return true;
    },
    [playerColor, connection, pushNotice]
  );

  const handleSquareClick = useCallback(
    (pos: Pos) => {
      if (screen !== 'playing' || gameState.draft.phase !== 'playing' || gameState.winner) return;
      if (gameState.pendingConvocation) return;

      const clickedAny = gameState.board[pos.row][pos.col];
      const sameAsInspect = !!inspectSquare && inspectSquare.row === pos.row && inspectSquare.col === pos.col;
      const myTurnColor = mode === 'ai' ? 'w' : playerColor;
      if (myTurnColor === 'spectator' || gameState.turn !== myTurnColor) {
        // Fora da vez (ou espectador): so visualiza os movimentos da peca clicada.
        setSelectedSquare(null);
        setLegalMoves([]);
        setInspectSquare(clickedAny && !sameAsInspect ? pos : null);
        return;
      }

      // Check if clicking a legal move destination for the currently selected piece
      const matchedMove = legalMoves.find(
        (m) => m.to.row === pos.row && m.to.col === pos.col
      );
      if (matchedMove) {
        if (matchedMove.kind === 'promotion') {
          setPendingPromotionDest(pos);
          return;
        }

        if (mode === 'multiplayer') {
          sendGameAction({ type: 'move', move: matchedMove });
        } else {
          setGameState((prev) => stampMove(prev, applyMove(prev, matchedMove), Date.now()));
        }
        setSelectedSquare(null);
        setLegalMoves([]);
        setInspectSquare(null);
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
        setInspectSquare(null);
        setSelectedSquare(pos);
        setLegalMoves(moves);
      } else {
        // Peca adversaria: mostra como ela se move (so visualizacao).
        setSelectedSquare(null);
        setLegalMoves([]);
        setInspectSquare(clickedAny && !sameAsInspect ? pos : null);
      }
    },
    [screen, gameState, mode, playerColor, legalMoves, selectedSquare, inspectSquare, sendGameAction]
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
        if (mode === 'multiplayer') {
          sendGameAction({ type: 'move', move: targetMove });
        } else {
          setGameState((prev) => stampMove(prev, applyMove(prev, targetMove), Date.now()));
        }
      }
      return;
    }

    if (mode === 'multiplayer') {
      sendGameAction({ type: 'convocate', choice });
    } else {
      setGameState((prev) => stampMove(prev, resolveConvocation(prev, choice), Date.now()));
    }
  };

  const handleSendEmote = (emoteId: string) => {
    if (emoteCooldownSec > 0) return;

    if (mode === 'multiplayer') {
      if (!sendGameAction({ type: 'emote', emoteId })) return;
      setEmoteCooldownSec(10);
    } else {
      setEmoteCooldownSec(10);
      const em = MEME_EMOTES.find((e) => e.id === emoteId);
      if (em) {
        soundEngine.playEmote(em.id);
        setRobotSpeaker('Você (Emote)');
        setRobotSpeech(em.speech);
      }
    }
  };

  const handleResign = () => {
    if (mode === 'multiplayer') {
      sendGameAction({ type: 'resign' });
    } else {
      setGameState((prev) =>
        stopClock({
          ...prev,
          winner: 'b',
          endReason: 'resign',
        })
      );
      setScreen('gameover');
    }
  };

  const handleRestart = () => {
    if (mode === 'multiplayer') {
      if (isSpectator) {
        leaveRoom();
        return;
      }
      if (sendGameAction({ type: 'rematch' })) {
        setMatchEnd(null);
        setScreen('playing');
      }
    } else {
      handleStartAI(false);
    }
  };

  const handleReturnTitle = () => {
    if (mode === 'multiplayer') {
      leaveRoom();
      return;
    }
    setGameState(createInitialState(false));
    setSelectedSquare(null);
    setLegalMoves([]);
    setScreen('title');
  };

  const openLobby = () => {
    if (boot.phase === 'error') return;
    setScreen('lobby');
  };

  const showMyConvocation =
    gameState.pendingConvocation &&
    (mode === 'ai'
      ? gameState.pendingConvocation.color === 'w'
      : gameState.pendingConvocation.color === playerColor);

  const inAiPlay = mode === 'ai' && screen === 'playing';

  const focusSquare = selectedSquare ?? inspectSquare;
  const inspectMoves = useMemo<MoveOption[]>(() => {
    if (!inspectSquare || selectedSquare) return [];
    const piece = gameState.board[inspectSquare.row]?.[inspectSquare.col];
    if (!piece) return [];
    try {
      return getLegalMoves({ ...gameState, turn: piece.color }, inspectSquare);
    } catch {
      return [];
    }
  }, [gameState, inspectSquare, selectedSquare]);
  const focusMoves = selectedSquare ? legalMoves : inspectMoves;

  return (
    <main className="w-screen h-screen relative overflow-hidden bg-[#070B14]">
      {/* Isolated 3D WebGL Viewport */}
      <ChessScene
        gameState={gameState}
        selectedSquare={focusSquare}
        legalMoves={focusMoves}
        playerPerspective={playerColor === 'b' ? 'b' : 'w'}
        cameraPreset={cameraPreset}
        roomId={sceneRoom}
        isTitleScreen={screen === 'title' || screen === 'lobby'}
        robotMood={gameState.inCheck ? 'alert' : 'idle'}
        onSquareClick={handleSquareClick}
      />

      {/* Title Screen Overlay */}
      {screen === 'title' && (
        <TitleOverlay
          selectedRoom={sceneRoom}
          onSelectRoom={setSceneRoom}
          onStartAI={() => setSetup({ kind: 'ai' })}
          onOpenLobby={openLobby}
          user={me}
          connection={connection}
        />
      )}

      {/* Lobby */}
      {screen === 'lobby' && me && (
        <Lobby
          me={me}
          online={online}
          rooms={rooms}
          connection={connection}
          challengingUserId={challengingUserId}
          creatingRoom={isCreatingRoom}
          sceneRoom={sceneRoom}
          onSelectSceneRoom={setSceneRoom}
          onChallenge={(userId) => setSetup({ kind: 'challenge', userId })}
          onCreateRoom={() => setSetup({ kind: 'room' })}
          onJoinRoom={(code, asSpectator) => joinRoom(code, asSpectator)}
          onStartAI={() => setSetup({ kind: 'ai' })}
          onOpenLeaderboard={() => setLeaderboardOpen(true)}
          onBack={() => setScreen('title')}
        />
      )}

      {/* Barra de sala / espectadores */}
      {mode === 'multiplayer' && roomId && seats && (screen === 'playing' || screen === 'paused') && (
        <SpectatorBar
          roomId={roomId}
          seats={seats}
          yourSeat={playerColor}
          connection={connection}
          onLeave={leaveRoom}
        />
      )}

      {/* Vez em destaque, relogios, painel de lances e peca */}
      {(screen === 'playing' || screen === 'paused') && gameState.draft.phase === 'playing' && (
        <>
          <TurnGlow active={myTurnNow && screen === 'playing'} />
          <div
            className={`fixed z-10 pointer-events-none flex justify-center ${
              mode === 'multiplayer' ? 'top-[3.75rem]' : 'top-3'
            } left-2 right-2 md:left-[19rem] md:right-[11rem]`}
          >
            <TurnBanner
              gameState={gameState}
              mode={mode}
              playerColor={playerColor}
              seats={seats}
              myName={me?.name ?? 'Você'}
              aiThinking={aiThinking}
            />
          </div>
          <div className="fixed z-10 pointer-events-none right-3 top-[4.5rem] bottom-24 flex items-start justify-end">
            <SidePanel
              gameState={gameState}
              focusSquare={focusSquare}
              focusMoves={focusMoves}
              focusIsPlayable={!!selectedSquare}
              defaultCollapsed={typeof window !== 'undefined' && window.innerWidth < 1100}
            />
          </div>
        </>
      )}

      {/* Active Match HUD */}
      {screen === 'playing' && gameState.draft.phase === 'playing' && (
        <GameHUD
          gameState={gameState}
          mode={mode}
          sceneRoom={sceneRoom}
          playerColor={playerColor}
          roomId={roomId}
          playersConnected={seats ? (seats.w ? 1 : 0) + (seats.b ? 1 : 0) : 1}
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
                  availableSpecials: getConvocationOffer(gameState, c),
                }}
                usedCount={gameState.usedSpecials[c].length}
                onResolve={handleResolveConvocation}
              />
            );
          })()
        ) : null)}

      {/* Escolha de modo (livre / com tempo) antes de comecar */}
      {setup && (
        <GameSetupModal
          title={
            setup.kind === 'ai' ? 'Jogar contra o Robôzinho' : setup.kind === 'room' ? 'Criar sala' : 'Desafiar jogador'
          }
          subtitle={
            setup.kind === 'challenge'
              ? `Quem for desafiado vê o modo e aceita ou recusa. Desafio para ${online.find((u) => u.userId === setup.userId)?.name ?? 'o jogador'}.`
              : setup.kind === 'room'
                ? 'Quem entrar na sala joga com o modo que você escolher.'
                : 'Escolha como será a partida.'
          }
          confirmLabel={setup.kind === 'ai' ? 'Começar' : setup.kind === 'room' ? 'Criar sala' : 'Enviar desafio'}
          onCancel={() => setSetup(null)}
          onConfirm={(tc) => {
            const s = setup;
            setSetup(null);
            if (s.kind === 'ai') handleStartAI(false, tc);
            else if (s.kind === 'room') handleCreateRoom(tc);
            else handleChallenge(s.userId, tc);
          }}
        />
      )}

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

      {/* Pontos ganhos ao fim da partida */}
      {matchEnd && me && mode === 'multiplayer' && (
        <MatchPointsCard
          meUserId={me.userId}
          result={matchEnd.result}
          reason={matchEnd.reason}
          points={matchEnd.points}
          myColor={playerColor}
          onOpenLeaderboard={() => setLeaderboardOpen(true)}
          onClose={() => setMatchEnd(null)}
        />
      )}

      {leaderboardOpen && me && (
        <div className="fixed inset-0 z-[70]">
          <Leaderboard meUserId={me.userId} onClose={() => setLeaderboardOpen(false)} />
        </div>
      )}

      {/* Convites e avisos */}
      <InviteToast
        invites={invites}
        notices={notices}
        onRespond={handleInviteResponse}
        onExpire={handleInviteExpire}
        onDismissNotice={(id) => setNotices((prev) => prev.filter((n) => n.id !== id))}
      />

      {/* Erro de inicializacao (bridge/sessao): amigavel e com nova tentativa */}
      {boot.phase === 'error' && !inAiPlay && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-[#050811]/90">
          <div
            role="alert"
            className="w-full max-w-sm bg-[#0B1222] border border-slate-700/80 rounded-2xl p-6 text-center shadow-2xl"
          >
            <h2 className="font-display font-bold text-lg text-white mb-2">Não foi possível conectar</h2>
            <p className="text-sm text-slate-300 mb-4">
              {boot.error instanceof WorkspaceError && boot.error.code === 'login_required'
                ? 'Entre no Bold Workspace para jogar. Redirecionando para o login...'
                : (boot.error?.message ?? 'Erro desconhecido.')}
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  setBootNonce((n) => n + 1);
                }}
                className="px-4 py-2.5 rounded-xl bg-[#00E676] hover:bg-[#00d16b] text-slate-950 font-bold text-sm cursor-pointer"
              >
                Tentar de novo
              </button>
              <button
                type="button"
                onClick={() => {
                  setBoot({ phase: 'loading' });
                  handleStartAI(false);
                }}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-sm cursor-pointer"
              >
                Jogar contra a IA (offline)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Estado de conexao (nao bloqueia) enquanto joga */}
      {boot.phase !== 'error' && connection !== 'ready' && screen !== 'title' && screen !== 'lobby' && mode === 'multiplayer' && (
        <div
          role="status"
          className="fixed bottom-2 left-2 z-50 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs"
        >
          {connection === 'closed' ? 'Desconectado' : 'Reconectando ao servidor...'}
        </div>
      )}
    </main>
  );
}
