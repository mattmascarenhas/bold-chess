// Camada de banco para as funcoes serverless. Postgres (Neon) em producao, PGlite nos testes.
import pg from 'pg';

export interface Queryable {
  query<R = any>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface Db extends Queryable {
  /** Executa fn numa transacao (BEGIN/COMMIT, ROLLBACK em erro). */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createPgDb(databaseUrl: string): Db {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 3, // funcoes serverless: poucas conexoes por instancia
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? undefined : { rejectUnauthorized: true },
  });
  pool.on('error', (err) => console.error('[pg] erro no pool:', err.message));
  return {
    query: (sql, params) => pool.query(sql, params as any[]) as any,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn({ query: (sql, params) => client.query(sql, params as any[]) as any });
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** PGlite: sem parametros aceita varios comandos (exec); com parametros usa o protocolo estendido. */
async function runLite(lite: any, sql: string, params?: unknown[]): Promise<{ rows: any[] }> {
  if (!params || params.length === 0) {
    const res = await lite.exec(sql);
    const last = Array.isArray(res) ? res[res.length - 1] : res;
    return { rows: last?.rows ?? [] };
  }
  return lite.query(sql, params);
}

/** Postgres em memoria (WASM) para testes e dev local. Importado dinamicamente: nao entra no bundle de producao. */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const lite = new PGlite(dataDir);
  await lite.waitReady;
  // PGlite e monousuario: serializa tudo (inclusive transacoes) numa fila.
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn, fn);
    chain = p.catch(() => undefined);
    return p;
  };
  return {
    query: (sql, params) => enqueue(() => runLite(lite, sql, params)) as any,
    tx: (fn) =>
      enqueue(async () => {
        await lite.query('BEGIN');
        try {
          const out = await fn({ query: (sql, params) => runLite(lite, sql, params) as any });
          await lite.query('COMMIT');
          return out;
        } catch (err) {
          await lite.query('ROLLBACK').catch(() => undefined);
          throw err;
        }
      }),
    close: () => lite.close(),
  };
}
