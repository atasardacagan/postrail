import { PGlite } from '@electric-sql/pglite';
import type { Database, Queryable, QueryResult } from './database.js';

/** Embedded real PostgreSQL engine for offline development and integration tests. */
export class PGliteDatabase implements Database {
  private readonly client: PGlite;
  constructor(dataDir?:string) { this.client = new PGlite(dataDir); }
  async query<T = Record<string,unknown>>(sql:string,values:unknown[]=[]): Promise<QueryResult<T>> {
    if (!values.length) {
      const results = await this.client.exec(sql);
      const last = results.at(-1);
      return {rows:(last?.rows ?? []) as T[],rowCount:last?.affectedRows || last?.rows.length || 0};
    }
    const r = await this.client.query<T>(sql,values);
    return {rows:r.rows,rowCount:r.affectedRows || r.rows.length};
  }
  async transaction<T>(fn:(tx:Queryable)=>Promise<T>): Promise<T> {
    return this.client.transaction(async transaction => fn({query:async<R>(sql:string,values:unknown[]=[])=>{
      if (!values.length) {
        const results = await transaction.exec(sql);
        const last = results.at(-1);
        return {rows:(last?.rows ?? []) as R[],rowCount:last?.affectedRows || last?.rows.length || 0};
      }
      const r = await transaction.query<R>(sql,values);
      return {rows:r.rows,rowCount:r.affectedRows || r.rows.length};
    }}));
  }
  async close(): Promise<void> { await this.client.close(); }
}
