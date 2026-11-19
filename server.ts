import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import {
  applyMove,
  autoDraftRemaining,
  createInitialState,
  draftPick,
  resolveConvocation,
} from './src/game/engine';
import { ClassicKind, Color, GameState, MoveOption, SceneRoomId, SpecialId } from './src/game/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALID_SCENE_ROOMS: SceneRoomId[] = ['bold_office', 'bold_studio', 'bold_executive'];

interface ClientConn {
  ws: WebSocket;
  color: Color | 'spectator';
  lastEmoteAt: number;
}

interface Room {
  id: string;
  sceneRoom: SceneRoomId;
  state: GameState;
  clients: Set<ClientConn>;
  whiteTaken: boolean;
  blackTaken: boolean;
  createdAt: number;
}

const rooms = new Map<string, Room>();

function generateRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(id) ? generateRoomId() : id;
}

function getOrCreateRoom(roomId: string, sceneRoom: SceneRoomId = 'bold_office'): Room {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      sceneRoom,
      state: createInitialState(true),
      clients: new Set(),
      whiteTaken: false,
      blackTaken: false,
      createdAt: Date.now(),
    };
    rooms.set(roomId, room);
  }
  return room;
}

function broadcastRoom(room: Room, payload: unknown) {
  const msg = JSON.stringify(payload);
  for (const client of room.clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(msg);
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // Audio manifest endpoint so client never triggers 404s on optional MP3s
  app.get('/api/audio-manifest', (_req, res) => {
    const audioDir = path.resolve(__dirname, 'public/audio');
    let files: string[] = [];
    let config: unknown = null;

    if (fs.existsSync(audioDir)) {
      const entries = fs.readdirSync(audioDir);
      files = entries.filter((f) => f.endsWith('.mp3'));
      const cfgPath = path.join(audioDir, 'audio-config.json');
      if (fs.existsSync(cfgPath)) {
        try {
          config = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
        } catch {
          config = null;
        }
      }
    }
    res.json({ files, config });
  });

  app.post('/api/rooms', (req, res) => {
    const requestedRoom = (req.body as { sceneRoom?: string } | undefined)?.sceneRoom;
    const validRoom: SceneRoomId = VALID_SCENE_ROOMS.includes(requestedRoom as SceneRoomId)
      ? (requestedRoom as SceneRoomId)
      : 'bold_office';
    const id = generateRoomId();
    const room = getOrCreateRoom(id, validRoom);
    res.json({ roomId: id, sceneRoom: room.sceneRoom });
  });

  app.get('/api/rooms/:id', (req, res) => {
    const id = String(req.params.id).toUpperCase();
    const room = rooms.get(id);
    if (!room) {
      res.status(404).json({ error: 'Sala não encontrada' });
      return;
    }
    res.json({
      roomId: room.id,
      players: (room.whiteTaken ? 1 : 0) + (room.blackTaken ? 1 : 0),
      phase: room.state.draft.phase,
    });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    let joinedRoom: Room | null = null;
    let conn: ClientConn | null = null;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type: string;
          roomId?: string;
          specialId?: SpecialId;
          move?: MoveOption;
          choice?: SpecialId | ClassicKind | 'keep_pawn';
          emoteId?: string;
        };

        if (msg.type === 'join' && msg.roomId) {
          const roomId = msg.roomId.toUpperCase();
          const room = getOrCreateRoom(roomId);
          joinedRoom = room;

          let color: Color | 'spectator' = 'spectator';
          if (!room.whiteTaken) {
            color = 'w';
            room.whiteTaken = true;
          } else if (!room.blackTaken) {
            color = 'b';
            room.blackTaken = true;
          }

          conn = { ws, color, lastEmoteAt: 0 };
          room.clients.add(conn);

          ws.send(
            JSON.stringify({
              type: 'joined',
              roomId,
              sceneRoom: room.sceneRoom,
              yourColor: color,
              state: room.state,
              playersConnected: (room.whiteTaken ? 1 : 0) + (room.blackTaken ? 1 : 0),
            })
          );

          broadcastRoom(room, {
            type: 'presence',
            playersConnected: (room.whiteTaken ? 1 : 0) + (room.blackTaken ? 1 : 0),
          });
          return;
        }

        if (!joinedRoom || !conn) return;

        if (msg.type === 'draft_pick' && msg.specialId && conn.color !== 'spectator') {
          const next = draftPick(joinedRoom.state, conn.color, msg.specialId);
          if (next !== joinedRoom.state) {
            joinedRoom.state = next;
            broadcastRoom(joinedRoom, { type: 'state', state: joinedRoom.state });
          }
          return;
        }

        if (msg.type === 'auto_draft' && conn.color !== 'spectator') {
          joinedRoom.state = autoDraftRemaining(joinedRoom.state);
          broadcastRoom(joinedRoom, { type: 'state', state: joinedRoom.state });
          return;
        }

        if (msg.type === 'move' && msg.move && conn.color !== 'spectator') {
          if (joinedRoom.state.turn !== conn.color) return;
          const next = applyMove(joinedRoom.state, msg.move);
          if (next !== joinedRoom.state) {
            joinedRoom.state = next;
            broadcastRoom(joinedRoom, {
              type: 'state',
              state: joinedRoom.state,
              event: next.lastMove,
            });
          }
          return;
        }

        if (msg.type === 'convocate' && msg.choice && conn.color !== 'spectator') {
          if (joinedRoom.state.pendingConvocation?.color !== conn.color) return;
          const next = resolveConvocation(joinedRoom.state, msg.choice);
          if (next !== joinedRoom.state) {
            joinedRoom.state = next;
            broadcastRoom(joinedRoom, {
              type: 'state',
              state: joinedRoom.state,
              convocation: msg.choice,
            });
          }
          return;
        }

        if (msg.type === 'resign' && conn.color !== 'spectator') {
          if (!joinedRoom.state.winner) {
            joinedRoom.state = {
              ...joinedRoom.state,
              winner: conn.color === 'w' ? 'b' : 'w',
              endReason: 'resign',
            };
            broadcastRoom(joinedRoom, { type: 'state', state: joinedRoom.state });
          }
          return;
        }

        if (msg.type === 'rematch' && conn.color !== 'spectator') {
          joinedRoom.state = createInitialState(true);
          broadcastRoom(joinedRoom, { type: 'state', state: joinedRoom.state });
          return;
        }

        if (msg.type === 'emote' && msg.emoteId && conn.color !== 'spectator') {
          const now = Date.now();
          if (now - conn.lastEmoteAt < 10000) return; // 10s cooldown
          conn.lastEmoteAt = now;
          broadcastRoom(joinedRoom, {
            type: 'emote',
            emoteId: msg.emoteId,
            fromColor: conn.color,
          });
        }
      } catch {
        // Ignore malformed packets
      }
    });

    ws.on('close', () => {
      if (joinedRoom && conn) {
        joinedRoom.clients.delete(conn);
        if (conn.color === 'w') joinedRoom.whiteTaken = false;
        if (conn.color === 'b') joinedRoom.blackTaken = false;
        broadcastRoom(joinedRoom, {
          type: 'presence',
          playersConnected: (joinedRoom.whiteTaken ? 1 : 0) + (joinedRoom.blackTaken ? 1 : 0),
        });
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Xadrez Bold server listening on http://localhost:${PORT}`);
  });
}

startServer();
