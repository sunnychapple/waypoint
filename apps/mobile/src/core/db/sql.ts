// The parts of SQLite the app uses. expo-sqlite (on the phone) and node:sqlite (in tests) both fit it.
export type SqlValue = string | number | null | Uint8Array;

export type RunResult = { changes: number; lastInsertRowId: number };

export type SqlDb = {
  exec(sql: string): void;
  run(sql: string, params?: SqlValue[]): RunResult;
  all<T>(sql: string, params?: SqlValue[]): T[];
  get<T>(sql: string, params?: SqlValue[]): T | null;
  transaction(task: () => void): void;
};
