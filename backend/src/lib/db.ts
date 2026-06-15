import type { QueryResult, QueryResultRow } from "pg";

/** Request-scoped DB wrapper (see `plugins/pg.ts`). */
export interface DbClient {
  query: <R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ) => Promise<QueryResult<R>>;
}
