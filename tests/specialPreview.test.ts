import test from 'node:test';
import assert from 'node:assert/strict';
import { SPECIAL_PREVIEW } from '../src/game/specialPreview';
import { SPECIAL_ROSTER } from '../src/game/types';

const ok = ([r, c]: readonly [number, number]) => r >= 0 && r < 8 && c >= 0 && c < 8;

test('toda peca especial tem cena de demonstracao valida', () => {
  for (const sp of SPECIAL_ROSTER) {
    const scenes = SPECIAL_PREVIEW[sp.id];
    assert.ok(scenes && scenes.length >= 2, `${sp.id} sem cenas`);
    scenes.forEach((s, i) => {
      assert.ok(ok(s.from) && ok(s.to), `${sp.id}[${i}] fora do tabuleiro`);
      assert.ok(s.targets.every(ok), `${sp.id}[${i}] alvo fora do tabuleiro`);
      assert.ok(s.targets.some(([r, c]) => r === s.to[0] && c === s.to[1]), `${sp.id}[${i}] destino nao esta nos alvos`);
      assert.ok(!s.targets.some(([r, c]) => r === s.from[0] && c === s.from[1]), `${sp.id}[${i}] origem esta nos alvos`);
      const next = scenes[(i + 1) % scenes.length];
      assert.deepEqual(next.from, s.to, `${sp.id}[${i}] cena seguinte nao continua do destino`);
    });
  }
});
