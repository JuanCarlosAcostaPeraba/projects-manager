import pg from 'pg';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

if (existsSync('.env')) loadEnvFile('.env');
// Preserve calendar dates independently of the server timezone.
pg.types.setTypeParser(1082, (value) => value);

export const schema = process.env.DB_SCHEMA?.trim() || 'projects_manager';
if (
  !/^[a-z][a-z0-9_]{0,62}$/.test(schema) ||
  ['public', 'information_schema'].includes(schema) ||
  schema.startsWith('pg_')
) {
  throw new Error('DB_SCHEMA debe ser un esquema propio válido.');
}
export function table(name: string) {
  if (!/^[a-z_]+$/.test(name)) throw new Error('Nombre de tabla inválido');
  return `"${schema}"."${name}"`;
}
export const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  max: 10,
  connectionTimeoutMillis: 8000,
  idleTimeoutMillis: 30000,
});
pool.on('error', (error) =>
  console.error(
    'PostgreSQL: conexión interrumpida',
    (error as NodeJS.ErrnoException).code,
  ),
);
export async function transaction<T>(
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
