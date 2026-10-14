import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { User } from '../src/server/auth';
const testSchema = `projects_manager_test_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
process.env.DB_SCHEMA = testSchema;
const { pool, table } = await import('../src/server/database');
const { execute } = await import('../src/server/commands');
const { requireTask, AppError } = await import('../src/server/permissions');
const { listProjects, projectData, taskData, myTasks } =
  await import('../src/server/data');
const { trashItems } = await import('../src/server/lifecycle');
const { createSession, currentUser } = await import('../src/server/auth');
const users = ['admin', 'manager', 'member', 'viewer', 'outsider'].map(
  (name) =>
    ({
      id: randomUUID(),
      name,
      email: `${name}@example.test`,
      role: name === 'admin' ? 'admin' : 'member',
    }) as User,
);
const [admin, manager, member, viewer, outsider] = users;
const input = {
  title: 'Plan de trabajo',
  description: 'Contexto',
  status: 'todo',
  priority: 'medium',
  assignee_id: member.id,
  start_date: '2026-10-14',
  due_date: '2026-10-30',
};
async function fixture() {
  const areaId = randomUUID();
  await pool.query(`INSERT INTO ${table('areas')} (id,name) VALUES ($1,$2)`, [
    areaId,
    `Área ${areaId}`,
  ]);
  for (const [u, role] of [
    [manager, 'manager'],
    [member, 'member'],
    [viewer, 'viewer'],
  ] as const)
    await execute(admin, 'member.save', {
      area_id: areaId,
      user_id: u.id,
      role,
    });
  const projectId = (
    await execute(manager, 'project.create', {
      area_id: areaId,
      name: 'Proyecto',
      key: `T${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`,
      description: '',
    })
  )
    .split('/')
    .pop()!;
  await execute(member, 'task.create', { ...input, project_id: projectId });
  const task = (
    await pool.query(`SELECT * FROM ${table('tasks')} WHERE project_id=$1`, [
      projectId,
    ])
  ).rows[0];
  await execute(member, 'comment.create', {
    task_id: task.id,
    body: 'Comentario del miembro',
  });
  const comment = (
    await pool.query(`SELECT * FROM ${table('comments')} WHERE task_id=$1`, [
      task.id,
    ])
  ).rows[0];
  return { areaId, projectId, taskId: task.id, commentId: comment.id };
}
const denied = (fn: () => Promise<unknown>) =>
  assert.rejects(
    fn,
    (error: unknown) => error instanceof AppError && error.status === 403,
  );
before(async () => {
  execFileSync(
    process.execPath,
    ['--env-file=.env', '--experimental-strip-types', 'scripts/migrate.ts'],
    { env: process.env, stdio: 'pipe' },
  );
  for (const user of users)
    await pool.query(
      `INSERT INTO ${table('users')} (id,name,email,password_hash,role) VALUES ($1,$2,$3,'unused',$4)`,
      [user.id, user.name, user.email, user.role],
    );
});
after(async () => {
  assert.match(testSchema, /^projects_manager_test_[a-f0-9]{16}$/);
  try {
    await pool.query(`DROP SCHEMA "${testSchema}" CASCADE`);
  } finally {
    await pool.end();
  }
});
test('deletion permissions and stale versions protect the record', async () => {
  const f = await fixture();
  await denied(() =>
    execute(viewer, 'task.delete', { task_id: f.taskId, version: 1 }),
  );
  await denied(() =>
    execute(outsider, 'task.delete', { task_id: f.taskId, version: 1 }),
  );
  await denied(() =>
    execute(member, 'project.delete', { project_id: f.projectId }),
  );
  await denied(() => execute(manager, 'area.delete', { area_id: f.areaId }));
  await assert.rejects(
    () => execute(member, 'task.delete', { task_id: f.taskId, version: 99 }),
    (error) => error instanceof AppError && error.status === 409,
  );
  assert.equal(
    (await requireTask(member, f.taskId, 'read')).task.title,
    input.title,
  );
});
test('task deletion hides reads, counts and personal tasks; restore retains comments', async () => {
  const f = await fixture();
  await execute(member, 'task.delete', { task_id: f.taskId, version: 1 });
  await assert.rejects(
    () => requireTask(member, f.taskId, 'read'),
    /no encontrada/,
  );
  assert.equal((await projectData(member, f.projectId)).tasks.length, 0);
  assert.equal(
    (await listProjects(member)).find((p) => p.id === f.projectId).task_count,
    0,
  );
  assert.equal(
    (await myTasks(member)).some((t) => t.id === f.taskId),
    false,
  );
  assert.equal(
    (await trashItems(viewer)).some((t) => t.id === f.taskId),
    false,
  );
  assert.equal(
    (await trashItems(member)).some((t) => t.id === f.taskId),
    true,
  );
  await denied(() =>
    execute(viewer, 'trash.restore', { kind: 'task', id: f.taskId }),
  );
  await execute(member, 'trash.restore', { kind: 'task', id: f.taskId });
  assert.equal((await taskData(member, f.taskId)).comments.length, 1);
  assert.equal((await requireTask(member, f.taskId, 'read')).task.version, 3);
});
test('restoring a project preserves independently deleted tasks and comments', async () => {
  const f = await fixture();
  await execute(member, 'comment.delete', { comment_id: f.commentId });
  await execute(member, 'task.create', {
    ...input,
    title: 'Eliminada antes',
    project_id: f.projectId,
  });
  const earlier = (
    await pool.query(
      `SELECT id FROM ${table('tasks')} WHERE project_id=$1 AND number=2`,
      [f.projectId],
    )
  ).rows[0].id;
  await execute(member, 'task.delete', { task_id: earlier, version: 1 });
  await execute(manager, 'project.delete', { project_id: f.projectId });
  await assert.rejects(
    () => execute(member, 'trash.restore', { kind: 'task', id: f.taskId }),
    /no encontrado/,
  );
  await execute(manager, 'trash.restore', { kind: 'project', id: f.projectId });
  assert.equal((await projectData(member, f.projectId)).tasks.length, 1);
  assert.equal((await taskData(member, f.taskId)).comments.length, 0);
  assert.equal(
    (await trashItems(member)).some((t) => t.id === earlier),
    true,
  );
});
test('area cascade is reversible and deleted areas cannot accept projects', async () => {
  const f = await fixture();
  await execute(admin, 'area.delete', { area_id: f.areaId });
  assert.equal(
    (await listProjects(admin)).some((p) => p.id === f.projectId),
    false,
  );
  await assert.rejects(
    () =>
      execute(admin, 'project.create', {
        area_id: f.areaId,
        name: 'No',
        key: 'NO',
        description: '',
      }),
    /no encontrada/,
  );
  await assert.rejects(
    () =>
      execute(manager, 'trash.restore', { kind: 'project', id: f.projectId }),
    /no encontrada/,
  );
  await denied(() =>
    execute(manager, 'trash.restore', { kind: 'area', id: f.areaId }),
  );
  await execute(admin, 'trash.restore', { kind: 'area', id: f.areaId });
  assert.equal((await taskData(member, f.taskId)).comments.length, 1);
});
test('concurrent creation and deletion never leave active children behind', async () => {
  for (const kind of ['project', 'area'] as const) {
    const f = await fixture();
    const results = await Promise.allSettled([
      execute(member, 'task.create', { ...input, project_id: f.projectId }),
      execute(admin, `${kind}.delete`, {
        [`${kind}_id`]: kind === 'area' ? f.areaId : f.projectId,
      }),
    ]);
    assert.equal(results[1].status, 'fulfilled');
    if (results[0].status === 'rejected')
      assert.equal(results[0].reason.status, 404);
    const active = await pool.query(
      `SELECT count(*)::int AS count FROM ${table('tasks')} WHERE project_id=$1 AND deleted_at IS NULL`,
      [f.projectId],
    );
    assert.equal(active.rows[0].count, 0);
    await execute(admin, 'trash.restore', {
      kind,
      id: kind === 'area' ? f.areaId : f.projectId,
    });
    assert.equal(
      (await projectData(member, f.projectId)).tasks.length,
      results[0].status === 'fulfilled' ? 2 : 1,
    );
  }
});

test('comment authorship is enforced and responsible can moderate', async () => {
  const f = await fixture();
  const another = {
    ...member,
    id: randomUUID(),
    email: 'another@example.test',
  };
  await pool.query(
    `INSERT INTO ${table('users')} (id,name,email,password_hash) VALUES ($1,'Otro miembro',$2,'unused')`,
    [another.id, another.email],
  );
  await execute(admin, 'member.save', {
    area_id: f.areaId,
    user_id: another.id,
    role: 'member',
  });
  await denied(() =>
    execute(another, 'comment.delete', { comment_id: f.commentId }),
  );
  await execute(manager, 'comment.delete', { comment_id: f.commentId });
  await execute(member, 'trash.restore', { kind: 'comment', id: f.commentId });
  assert.equal((await taskData(member, f.taskId)).comments.length, 1);
});
test('invalid planning dates do not write partial tasks', async () => {
  const f = await fixture();
  await assert.rejects(
    () =>
      execute(member, 'task.update', {
        ...input,
        task_id: f.taskId,
        version: 1,
        start_date: '2026-11-01',
      }),
    /fecha de inicio/,
  );
  assert.equal(
    (await requireTask(member, f.taskId, 'read')).task.start_date,
    '2026-10-14',
  );
});
test('deactivation revokes sessions; self-deactivation and last-admin loss are blocked', async () => {
  const jar = new Map<string, string>();
  const cookies = {
    get: (key: string) => (jar.has(key) ? { value: jar.get(key) } : undefined),
    set: (key: string, value: string) => jar.set(key, value),
    delete: (key: string) => jar.delete(key),
  };
  await createSession(cookies as never, outsider.id, false);
  assert.equal((await currentUser(cookies as never))?.id, outsider.id);
  await denied(() =>
    execute(member, 'user.deactivate', { user_id: outsider.id }),
  );
  await assert.rejects(
    () => execute(admin, 'user.deactivate', { user_id: admin.id }),
    /propia cuenta/,
  );
  await execute(admin, 'user.deactivate', { user_id: outsider.id });
  assert.equal(await currentUser(cookies as never), null);
  await execute(admin, 'user.activate', { user_id: outsider.id });
  assert.equal(
    (
      await pool.query(`SELECT active FROM ${table('users')} WHERE id=$1`, [
        outsider.id,
      ])
    ).rows[0].active,
    true,
  );
  const otherAdmin = {
    ...admin,
    id: randomUUID(),
    email: 'second-admin@example.test',
  };
  await pool.query(
    `INSERT INTO ${table('users')} (id,name,email,password_hash,role) VALUES ($1,'Segundo admin',$2,'unused','admin')`,
    [otherAdmin.id, otherAdmin.email],
  );
  const results = await Promise.allSettled([
    execute(admin, 'user.deactivate', { user_id: otherAdmin.id }),
    execute(otherAdmin, 'user.deactivate', { user_id: admin.id }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    (
      await pool.query(
        `SELECT count(*)::int AS count FROM ${table('users')} WHERE role='admin' AND active`,
      )
    ).rows[0].count,
    1,
  );
});
