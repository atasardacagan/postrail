import pg from 'pg';

export interface QueryResult<T> { rows: T[]; rowCount: number }
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<T>>;
}
export interface Database extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class PgDatabase implements Database {
  private readonly pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
  }
  async query<T = Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<QueryResult<T>> {
    const result = await this.pool.query(sql, values);
    const last = Array.isArray(result) ? result.at(-1) : result;
    return { rows: (last?.rows ?? []) as T[], rowCount: last?.rowCount ?? 0 };
  }
  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn({ query: async <R>(sql: string, values: unknown[] = []) => {
        const response = await client.query(sql, values);
        const last = Array.isArray(response) ? response.at(-1) : response;
        return { rows: (last?.rows ?? []) as R[], rowCount: last?.rowCount ?? 0 };
      } });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  async close(): Promise<void> { await this.pool.end(); }
}
