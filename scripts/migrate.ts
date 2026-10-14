import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pool, schema, table, transaction } from '../src/server/database.ts';

try {
  await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `${schema}:migrations`,
    ]);
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${table('migrations')} (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const files = (await readdir(new URL('../db/migrations/', import.meta.url)))
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const name of files) {
      const sql = await readFile(
        new URL(`../db/migrations/${name}`, import.meta.url),
        'utf8',
      );
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query(
        `SELECT checksum FROM ${table('migrations')} WHERE name=$1`,
        [name],
      );
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum)
          throw new Error(`La migración ${name} ya aplicada ha cambiado.`);
        console.log(`Ya aplicada: ${name}`);
        continue;
      }
      await client.query(sql.replaceAll('__SCHEMA__', `"${schema}"`));
      await client.query(
        `INSERT INTO ${table('migrations')} (name, checksum) VALUES ($1,$2)`,
        [name, checksum],
      );
      console.log(`Aplicada: ${name}`);
    }
  });
  console.log(`Esquema listo: ${schema}`);
} catch (error) {
  console.error(
    'No se pudo migrar:',
    error instanceof Error ? error.message : 'Error de base de datos',
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
