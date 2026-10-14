import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { table, transaction, schema } from '../../server/database';
import { createSession, logout } from '../../server/auth';
import { hashPassword, verifyPassword, digest } from '../../server/password';
import { parse, passwordSchema, emailSchema } from '../../server/commands';
import { AppError } from '../../server/permissions';
import { seedDemo } from '../../server/demo';

export const POST: APIRoute = async ({ request, cookies, url, redirect }) => {
  let action = 'login';
  try {
    const input = Object.fromEntries(await request.formData());
    action = String(input.action);
    if (action === 'logout') {
      await logout(cookies);
      return redirect('/login', 303);
    }
    if (action === 'setup') {
      const data = parse(
        z.object({
          name: z.string().trim().min(1).max(100),
          email: emailSchema,
          password: passwordSchema,
        }),
        input,
      );
      const id = randomUUID();
      const passwordHash = await hashPassword(data.password);
      await transaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `${schema}:bootstrap`,
        ]);
        if (
          (await client.query(`SELECT 1 FROM ${table('users')} LIMIT 1`))
            .rowCount
        )
          throw new AppError('La aplicación ya está configurada.', 403);
        await client.query(
          `INSERT INTO ${table('users')} (id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,'admin')`,
          [id, data.name, data.email, passwordHash],
        );
        if (input.demo === 'on') await seedDemo(client, id);
      });
      await createSession(cookies, id, url.protocol === 'https:');
      return redirect('/', 303);
    }
    if (action !== 'login') throw new AppError('Acción no válida.');
    const data = parse(
      z.object({ email: emailSchema, password: z.string().min(1).max(128) }),
      input,
    );
    const key = digest(data.email);
    const login = await transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${schema}:login:${key}`,
      ]);
      const attempt = (
        await client.query(
          `SELECT attempts,window_start FROM ${table('login_attempts')} WHERE key=$1`,
          [key],
        )
      ).rows[0];
      if (
        attempt &&
        Date.now() - new Date(attempt.window_start).getTime() <
          15 * 60 * 1000 &&
        attempt.attempts >= 5
      )
        return { blocked: true, user: null };
      const user = (
        await client.query(
          `SELECT * FROM ${table('users')} WHERE email=$1 AND active`,
          [data.email],
        )
      ).rows[0];
      const dummy =
        'scrypt:00000000000000000000000000000000:' + '0'.repeat(128);
      const valid = await verifyPassword(
        data.password,
        user?.password_hash || dummy,
      );
      if (!user || !valid) {
        await client.query(
          `INSERT INTO ${table('login_attempts')} (key,attempts) VALUES ($1,1) ON CONFLICT (key) DO UPDATE SET attempts=CASE WHEN ${table('login_attempts')}.window_start<now()-interval '15 minutes' THEN 1 ELSE ${table('login_attempts')}.attempts+1 END,window_start=CASE WHEN ${table('login_attempts')}.window_start<now()-interval '15 minutes' THEN now() ELSE ${table('login_attempts')}.window_start END`,
          [key],
        );
        return { blocked: false, user: null };
      }
      await client.query(
        `DELETE FROM ${table('login_attempts')} WHERE key=$1`,
        [key],
      );
      return { blocked: false, user };
    });
    if (login.blocked)
      throw new AppError(
        'Demasiados intentos. Espera 15 minutos para volver a entrar.',
        429,
      );
    if (!login.user)
      throw new AppError('Correo o contraseña incorrectos.', 401);
    await logout(cookies);
    await createSession(cookies, login.user.id, url.protocol === 'https:');
    return redirect('/', 303);
  } catch (error) {
    const message =
      error instanceof AppError
        ? error.message
        : 'No se pudo completar el acceso. Inténtalo de nuevo.';
    if (!(error instanceof AppError))
      console.error(
        'Error de acceso',
        (error as { code?: string }).code || 'internal',
      );
    return redirect(
      `${action === 'setup' ? '/setup' : '/login'}?error=${encodeURIComponent(message)}`,
      303,
    );
  }
};
