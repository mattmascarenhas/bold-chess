import { randomUUID } from 'node:crypto';
import type express from 'express';
import type { PlayerIdentity, PointsAward } from '../src/shared/protocol';
import { AI_POINTS, computeAiScore, computeScore, isAiLevel } from '../src/shared/scoring';
import type { FinishAiMatchInput, FinishMatchInput, Leaderboard, MatchRecord, Store } from './types';

const AI_LABEL: Record<keyof typeof AI_POINTS, string> = {
  facil: 'Fácil',
  medio: 'Médio',
  dificil: 'Difícil',
  mestre: 'Mestre',
  deus: 'Modo Deus',
};

function noCount(input: FinishMatchInput, reason: PointsAward['reason']): PointsAward[] {
  const ids = [input.white?.userId, input.black?.userId].filter((x): x is string => !!x);
  return ids.map((userId) => ({ userId, delta: 0, total: 0, counted: false, reason }));
}

export function createLeaderboard(store: Store): Leaderboard {
  return {
    async finishAiMatch(input: FinishAiMatchInput): Promise<PointsAward> {
      const { user } = input;
      const none = (reason: PointsAward['reason']): PointsAward => ({ userId: user.userId, delta: 0, total: 0, counted: false, reason });
      if (!isAiLevel(input.level)) return none('unverified');
      try {
        const [stats, today] = await Promise.all([store.getStats(user.userId), store.countAiToday(user.userId)]);
        const score = computeAiScore({
          level: input.level,
          outcome: input.outcome,
          moves: input.moves,
          gamesToday: today.games,
          pointsToday: today.points,
        });
        const result: MatchRecord['result'] = input.outcome === 'win' ? 'w' : input.outcome === 'loss' ? 'b' : 'draw';
        await store.recordMatch({
          id: randomUUID(),
          roomId: 'ia',
          white: user,
          black: { userId: `ai:${input.level}`, name: `IA ${AI_LABEL[input.level]}`, avatarUrl: null, accountId: null, workspaceId: null },
          result,
          reason: input.reason,
          moves: input.moves,
          counted: score.counted,
          whiteDelta: score.delta,
          blackDelta: 0,
          endedAt: Date.now(),
        });
        const before = stats?.points ?? 0;
        return { userId: user.userId, delta: score.delta, total: before + score.delta, counted: score.counted, reason: score.reason };
      } catch (err) {
        console.error('[leaderboard] finishAiMatch falhou:', err);
        return none(undefined);
      }
    },

    async finishMatch(input: FinishMatchInput): Promise<PointsAward[]> {
      const { white, black } = input;
      if (!white || !black) return noCount(input, 'vs_ai');
      if (white.userId === black.userId) return noCount(input, 'same_user');

      try {
        const [ws, bs, pairToday] = await Promise.all([
          store.getStats(white.userId),
          store.getStats(black.userId),
          store.countPairToday(white.userId, black.userId),
        ]);
        const wPts = ws?.points ?? 0;
        const bPts = bs?.points ?? 0;
        const score = computeScore({
          whiteId: white.userId,
          blackId: black.userId,
          result: input.result,
          whitePoints: wPts,
          blackPoints: bPts,
          moves: input.moves,
          pairMatchesToday: pairToday,
          durationMs: input.durationMs,
        });
        const rec: MatchRecord = {
          id: randomUUID(),
          roomId: input.roomId,
          white,
          black,
          result: input.result,
          reason: input.reason,
          moves: input.moves,
          counted: score.counted,
          whiteDelta: score.white,
          blackDelta: score.black,
          endedAt: Date.now(),
        };
        await store.recordMatch(rec);
        return [
          { userId: white.userId, delta: score.white, total: wPts + score.white, counted: score.counted, reason: score.reason },
          { userId: black.userId, delta: score.black, total: bPts + score.black, counted: score.counted, reason: score.reason },
        ];
      } catch (err) {
        console.error('[leaderboard] finishMatch falhou:', err);
        return [white, black].map((p) => ({ userId: p.userId, delta: 0, total: 0, counted: false }));
      }
    },
  };
}

function parseLimit(raw: unknown, def: number, max: number): number | null {
  if (raw === undefined) return def;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (n < 1 || n > max) return null;
  return n;
}

function publicIdentity(p: PlayerIdentity) {
  return { userId: p.userId, name: p.name, avatarUrl: p.avatarUrl };
}

export function registerLeaderboardRoutes(app: express.Express, store: Store): void {
  app.get('/api/leaderboard', async (req, res) => {
    const limit = parseLimit(req.query.limit, 50, 100);
    if (limit === null) return res.status(400).json({ error: 'invalid_limit' });
    try {
      res.json({ entries: await store.getTop(limit) });
    } catch (err) {
      console.error('[leaderboard] getTop falhou:', err);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  app.get('/api/leaderboard/me', async (req, res) => {
    const userId = req.query.userId;
    if (typeof userId !== 'string' || userId.length === 0 || userId.length > 200) {
      return res.status(400).json({ error: 'invalid_user_id' });
    }
    try {
      const [rank, stats] = await Promise.all([store.getRank(userId), store.getStats(userId)]);
      res.json({ rank, stats });
    } catch (err) {
      console.error('[leaderboard] me falhou:', err);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  app.get('/api/matches/recent', async (req, res) => {
    const limit = parseLimit(req.query.limit, 20, 100);
    if (limit === null) return res.status(400).json({ error: 'invalid_limit' });
    try {
      const recs = await store.recentMatches(limit);
      const matches = recs.map((m) => ({
        id: m.id,
        roomId: m.roomId,
        white: publicIdentity(m.white),
        black: publicIdentity(m.black),
        result: m.result,
        reason: m.reason,
        moves: m.moves,
        counted: m.counted,
        whiteDelta: m.whiteDelta,
        blackDelta: m.blackDelta,
        endedAt: m.endedAt,
      }));
      res.json({ matches });
    } catch (err) {
      console.error('[leaderboard] recent falhou:', err);
      res.status(500).json({ error: 'internal_error' });
    }
  });
}
