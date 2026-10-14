import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Each run gets its own schema in the configured test database.
const testSchema = `projects_manager_test_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
process.env.DB_SCHEMA = testSchema;
const { pool, table } = await import('../src/server/database');
const { execute } = await import('../src/server/commands');
const { requireProject, requireTask, AppError } =
  await import('../src/server/permissions');
const { listProjects, myTasks } = await import('../src/server/data');
const { hashPassword, verifyPassword } = await import('../src/server/password');
const { currentUser, createSession, logout } =
  await import('../src/server/auth');
const { POST: authPost } = await import('../src/pages/api/auth');
const { rejectUnsafeRequest } = await import('../src/server/http');
import type { User } from '../src/server/auth';
const admin: User = {
  id: randomUUID(),
  name: 'Test Admin',
  email: 'admin@example.test',
  role: 'admin',
};
const member: User = {
  id: randomUUID(),
  name: 'Test Member',
  email: 'member@example.test',
  role: 'member',
};
const viewer: User = {
  id: randomUUID(),
  name: 'Test Viewer',
  email: 'viewer@example.test',
  role: 'member',
};
const outsider: User = {
  id: randomUUID(),
  name: 'Test Outsider',
  email: 'outside@example.test',
  role: 'member',
};
let areaId: string, projectId: string, taskId: string;
const password = 'Test-password-123456';
const fields = {
  title: 'Primera tarea',
  description: 'Descripción',
  status: 'todo',
  priority: 'high',
  assignee_id: member.id,
  due_date: '2026-10-30',
};
const jar = new Map<string, string>();
const cookies = {
  get: (key: string) => (jar.has(key) ? { value: jar.get(key) } : undefined),
  set: (key: string, value: string) => jar.set(key, value),
  delete: (key: string) => jar.delete(key),
};
const forbidden = (fn: () => Promise<unknown>) =>
  assert.rejects(
    fn,
    (err: unknown) => err instanceof AppError && err.status === 403,
  );
function authRequest(input: Record<string, string>) {
  const context = {
    request: new Request('http://localhost/api/auth', {
      method: 'POST',
      headers: { origin: 'http://localhost' },
      body: new URLSearchParams(input),
    }),
    cookies,
    url: new URL('http://localhost/api/auth'),
    redirect: (location: string, status = 302) =>
      new Response(null, { status, headers: { location } }),
  };
  return authPost(context as unknown as Parameters<typeof authPost>[0]);
}
before(async () => {
  execFileSync(
    process.execPath,
    ['--env-file=.env', '--experimental-strip-types', 'scripts/migrate.ts'],
    { env: process.env, stdio: 'pipe' },
  );
  const hash = await hashPassword(password);
  for (const user of [admin, member, viewer, outsider])
    await pool.query(
      `INSERT INTO ${table('users')} (id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,$5)`,
      [user.id, user.name, user.email, hash, user.role],
    );
  await execute(admin, 'area.create', {
    name: 'Área de prueba',
    description: '',
  });
  areaId = (await pool.query(`SELECT id FROM ${table('areas')}`)).rows[0].id;
  await execute(admin, 'member.save', {
    area_id: areaId,
    user_id: member.id,
    role: 'member',
  });
  await execute(admin, 'member.save', {
    area_id: areaId,
    user_id: viewer.id,
    role: 'viewer',
  });
  const destination = await execute(admin, 'project.create', {
    area_id: areaId,
    name: 'Prueba',
    key: 'TEST',
    description: '',
  });
  projectId = destination.split('/').pop()!;
  await execute(member, 'task.create', { ...fields, project_id: projectId });
  taskId = (await pool.query(`SELECT id FROM ${table('tasks')} WHERE number=1`))
    .rows[0].id;
});
after(async () => {
  assert.match(testSchema, /^projects_manager_test_[a-f0-9]{16}$/);
  try {
    await pool.query(`DROP SCHEMA "${testSchema}" CASCADE`);
  } finally {
    await pool.end();
  }
});
test('migration is repeatable and preserves data', async () => {
  execFileSync(
    process.execPath,
    ['--env-file=.env', '--experimental-strip-types', 'scripts/migrate.ts'],
    { env: process.env, stdio: 'pipe' },
  );
  assert.equal(
    (
      await pool.query(
        `SELECT count(*)::int AS count FROM ${table('migrations')}`,
      )
    ).rows[0].count,
    1,
  );
  assert.equal(
    (await pool.query(`SELECT count(*)::int AS count FROM ${table('tasks')}`))
      .rows[0].count,
    1,
  );
});
test('password hashing accepts only the correct password', async () => {
  const hash = await hashPassword(password);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword('Wrong-password', hash), false);
  assert.equal(await verifyPassword(password, 'broken'), false);
  assert.notEqual(hash, await hashPassword(password));
});
test('area boundaries protect reads, writes and assignments', async () => {
  assert.equal((await listProjects(outsider)).length, 0);
  await forbidden(() => requireProject(outsider, projectId, 'read'));
  await forbidden(() => requireTask(outsider, taskId, 'read'));
  await forbidden(() =>
    execute(outsider, 'comment.create', { task_id: taskId, body: 'Invisible' }),
  );
  await assert.rejects(
    () =>
      execute(member, 'task.create', {
        ...fields,
        assignee_id: outsider.id,
        project_id: projectId,
      }),
    /miembro activo/,
  );
});
test('viewer reads but cannot modify anything', async () => {
  assert.equal((await listProjects(viewer)).length, 1);
  assert.equal((await requireTask(viewer, taskId, 'read')).task.id, taskId);
  await forbidden(() =>
    execute(viewer, 'task.create', { ...fields, project_id: projectId }),
  );
  await forbidden(() =>
    execute(viewer, 'task.status', {
      task_id: taskId,
      status: 'done',
      version: 1,
    }),
  );
  await forbidden(() =>
    execute(viewer, 'comment.create', {
      task_id: taskId,
      body: 'No permitido',
    }),
  );
  await forbidden(() =>
    execute(viewer, 'member.save', {
      area_id: areaId,
      user_id: viewer.id,
      role: 'manager',
    }),
  );
});
test('members edit tasks but cannot create projects or users', async () => {
  await forbidden(() =>
    execute(member, 'project.create', {
      name: 'No',
      key: 'NO',
      area_id: areaId,
      description: '',
    }),
  );
  await forbidden(() =>
    execute(member, 'user.create', {
      name: 'No',
      email: 'no@example.test',
      password,
      role: 'admin',
    }),
  );
  await execute(member, 'task.update', {
    ...fields,
    task_id: taskId,
    title: 'Actualizada',
    version: 1,
  });
  const row = (
    await pool.query(`SELECT * FROM ${table('tasks')} WHERE id=$1`, [taskId])
  ).rows[0];
  assert.equal(row.title, 'Actualizada');
  assert.equal(row.version, 2);
  assert.equal(row.due_date, '2026-10-30');
  await assert.rejects(
    () =>
      execute(member, 'task.update', {
        ...fields,
        task_id: taskId,
        title: 'Desactualizada',
        version: 1,
      }),
    (error: unknown) => error instanceof AppError && error.status === 409,
  );
  assert.equal(
    (
      await pool.query(`SELECT title FROM ${table('tasks')} WHERE id=$1`, [
        taskId,
      ])
    ).rows[0].title,
    'Actualizada',
  );
});
test('parallel creation allocates unique task numbers', async () => {
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      execute(member, 'task.create', {
        ...fields,
        title: `Concurrente ${i}`,
        project_id: projectId,
      }),
    ),
  );
  const rows = (
    await pool.query(`SELECT number FROM ${table('tasks')} ORDER BY number`)
  ).rows;
  assert.deepEqual(
    rows.map((r) => r.number),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
});
test('comments persist and removed membership revokes access immediately', async () => {
  await execute(member, 'comment.create', {
    task_id: taskId,
    body: 'Comentario de prueba',
  });
  assert.equal(
    (await pool.query(`SELECT body FROM ${table('comments')}`)).rows[0].body,
    'Comentario de prueba',
  );
  assert.equal((await myTasks(member)).length, 9);
  await execute(admin, 'member.save', {
    area_id: areaId,
    user_id: member.id,
    role: 'remove',
  });
  assert.equal((await myTasks(member)).length, 0);
  await forbidden(() => requireTask(member, taskId, 'read'));
});
test('login, hashed sessions, logout and inactive accounts', async () => {
  const invalid = await authRequest({
    action: 'login',
    email: admin.email,
    password: 'bad',
  });
  assert.match(invalid.headers.get('location')!, /incorrectos/);
  const valid = await authRequest({
    action: 'login',
    email: admin.email,
    password,
  });
  assert.equal(valid.headers.get('location'), '/');
  const dbToken = (
    await pool.query(
      `SELECT token_hash FROM ${table('sessions')} WHERE user_id=$1`,
      [admin.id],
    )
  ).rows[0].token_hash;
  assert.notEqual(dbToken, jar.get('pm_session'));
  assert.equal((await currentUser(cookies as never))?.id, admin.id);
  await pool.query(`UPDATE ${table('users')} SET active=false WHERE id=$1`, [
    admin.id,
  ]);
  assert.equal(await currentUser(cookies as never), null);
  await pool.query(`UPDATE ${table('users')} SET active=true WHERE id=$1`, [
    admin.id,
  ]);
  await logout(cookies as never);
  assert.equal(await currentUser(cookies as never), null);
  await createSession(cookies as never, admin.id, false);
  await execute(admin, 'password.change', {
    current: password,
    password: 'New-test-password-123',
  });
  assert.equal(await currentUser(cookies as never), null);
});
test('repeated failed login attempts are throttled', async () => {
  for (let i = 0; i < 5; i++)
    await authRequest({
      action: 'login',
      email: viewer.email,
      password: 'bad',
    });
  const response = await authRequest({
    action: 'login',
    email: viewer.email,
    password,
  });
  assert.match(
    decodeURIComponent(response.headers.get('location')!),
    /Demasiados intentos/,
  );
});
test('bootstrap cannot run again after the first administrator', async () => {
  const response = await authRequest({
    action: 'setup',
    email: 'new@example.test',
    name: 'New Admin',
    password,
  });
  assert.match(
    decodeURIComponent(response.headers.get('location')!),
    /ya está configurada/,
  );
  assert.equal(
    (await pool.query(`SELECT count(*)::int AS count FROM ${table('users')}`))
      .rows[0].count,
    4,
  );
});
test('cross-origin requests are rejected before a mutation', async () => {
  const context = {
    request: new Request('http://localhost/api/command', {
      method: 'POST',
      headers: { origin: 'http://evil.example' },
    }),
    url: new URL('http://localhost/api/command'),
  };
  const response = rejectUnsafeRequest(context.request, context.url);
  assert.equal(response?.status, 403);
});
