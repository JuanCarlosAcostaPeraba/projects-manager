import { randomBytes } from 'node:crypto';
import type { AstroCookies } from 'astro';
import { pool, table } from './database';
import { digest } from './password';
export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'member';
}
export const sessionCookie = 'pm_session';
export async function currentUser(cookies: AstroCookies): Promise<User | null> {
  const token = cookies.get(sessionCookie)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const result = await pool.query(
    `SELECT u.id,u.name,u.email,u.role FROM ${table('users')} u JOIN ${table('sessions')} s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active`,
    [digest(token)],
  );
  return result.rows[0] || null;
}
export async function createSession(
  cookies: AstroCookies,
  userId: string,
  secure: boolean,
) {
  const token = randomBytes(32).toString('hex');
  await pool.query(`DELETE FROM ${table('sessions')} WHERE expires_at<now()`);
  await pool.query(
    `INSERT INTO ${table('sessions')} (token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '7 days')`,
    [digest(token), userId],
  );
  cookies.set(sessionCookie, token, {
    path: '/',
    httpOnly: true,
    secure,
    sameSite: 'strict',
    maxAge: 604800,
  });
}
export async function logout(cookies: AstroCookies) {
  const token = cookies.get(sessionCookie)?.value;
  if (token)
    await pool.query(`DELETE FROM ${table('sessions')} WHERE token_hash=$1`, [
      digest(token),
    ]);
  cookies.delete(sessionCookie, { path: '/' });
}
