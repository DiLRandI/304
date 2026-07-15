import { Pool, type QueryResultRow } from "pg";

export interface Database {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[] }>;
  transaction<T>(
    callback: (transaction: Pick<Database, "query">) => Promise<T>,
  ): Promise<T>;
  health(): Promise<boolean>;
  close(): Promise<void>;
}

export function createDatabase(connectionString: string): Database {
  const pool = new Pool({
    connectionString,
    max: 12,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 3_000,
  });

  return {
    async query(text, values = []) {
      const result = await pool.query(text, values as unknown[]);
      return { rows: result.rows };
    },
    async transaction(callback) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await callback({
          async query(text, values = []) {
            const queryResult = await client.query(text, values as unknown[]);
            return { rows: queryResult.rows };
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async health() {
      try {
        await pool.query("SELECT 1");
        return true;
      } catch {
        return false;
      }
    },
    async close() {
      await pool.end();
    },
  };
}
