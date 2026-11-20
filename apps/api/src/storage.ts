// The parts of D1 this Worker uses. D1Database satisfies this type.
export type DbStatement = {
  bind(...values: unknown[]): DbStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
};

export type Db = { prepare(query: string): DbStatement };

export type SqlValue = string | number | null | ArrayBuffer;

// The parts of Durable Object storage this Worker uses. DurableObjectStorage satisfies this type.
export type SqlStore = {
  sql: { exec(query: string, ...bindings: SqlValue[]): { toArray(): Record<string, SqlValue>[] } };
  transactionSync<T>(fn: () => T): T;
};

// D1 with batch: the statements run in one transaction; if one fails, none is applied. Each result has the
// statement's change count. D1Database satisfies this type.
export type BatchDb = Db & { batch(statements: DbStatement[]): Promise<{ meta: { changes: number } }[]> };
