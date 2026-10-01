import { Pool, types, type PoolClient } from "pg";

types.setTypeParser(20, (value) => (value === null ? null : Number(value)));
types.setTypeParser(1082, (value) => value);
types.setTypeParser(1700, (value) => (value === null ? null : Number(value)));

const globalPool = globalThis as unknown as { daftarPool?: Pool };

export function getPool() {
  if (!globalPool.daftarPool) {
    globalPool.daftarPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
    });
  }
  return globalPool.daftarPool;
}

export async function withUser<T>(userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
