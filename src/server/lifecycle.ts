import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { User } from './auth';
import { table, schema, pool } from './database';
import {
  AppError,
  requireArea,
  requireProject,
  requireTask,
} from './permissions';

export type TrashKind = 'area' | 'project' | 'task' | 'comment';
const tables: Record<TrashKind, string> = {
  area: 'areas',
  project: 'projects',
  task: 'tasks',
  comment: 'comments',
};
async function mark(
  client: PoolClient,
  name: string,
  predicate: string,
  params: unknown[],
  user: User,
  batch: string,
) {
  await client.query(
    `UPDATE ${table(name)} SET deleted_at=now(),deleted_by=$1,deletion_batch=$2 ${name === 'tasks' ? ',version=version+1,updated_at=now()' : ''} WHERE deleted_at IS NULL AND ${predicate}`,
    [user.id, batch, ...params],
  );
}
async function restoreBatch(client: PoolClient, name: string, batch: string) {
  await client.query(
    `UPDATE ${table(name)} SET deleted_at=NULL,deleted_by=NULL,deletion_batch=NULL ${name === 'tasks' ? ',version=version+1,updated_at=now()' : ''} WHERE deletion_batch=$1`,
    [batch],
  );
}
export async function removeEntity(
  client: PoolClient,
  user: User,
  kind: TrashKind,
  id: string,
  version?: number,
) {
  const batch = randomUUID();
  let destination = '/trash';
  if (kind === 'area') {
    if (user.role !== 'admin')
      throw new AppError('Solo un administrador puede eliminar áreas.', 403);
    await client.query(
      `SELECT id FROM ${table('areas')} WHERE id=$1 FOR UPDATE`,
      [id],
    );
    await requireArea(user, id, 'manage', client);
    await mark(client, 'areas', 'id=$3', [id], user, batch);
    await mark(client, 'projects', 'area_id=$3', [id], user, batch);
    await mark(
      client,
      'tasks',
      `project_id IN (SELECT id FROM ${table('projects')} WHERE area_id=$3)`,
      [id],
      user,
      batch,
    );
    await mark(
      client,
      'comments',
      `task_id IN (SELECT t.id FROM ${table('tasks')} t JOIN ${table('projects')} p ON p.id=t.project_id WHERE p.area_id=$3)`,
      [id],
      user,
      batch,
    );
    destination = '/areas';
  } else if (kind === 'project') {
    await requireProject(user, id, 'manage', client);
    await mark(client, 'projects', 'id=$3', [id], user, batch);
    await mark(client, 'tasks', 'project_id=$3', [id], user, batch);
    await mark(
      client,
      'comments',
      `task_id IN (SELECT id FROM ${table('tasks')} WHERE project_id=$3)`,
      [id],
      user,
      batch,
    );
    destination = '/';
  } else if (kind === 'task') {
    const { task, project } = await requireTask(user, id, 'write', client);
    if (task.version !== version)
      throw new AppError(
        'La tarea ha cambiado. Recarga antes de eliminarla.',
        409,
      );
    await mark(client, 'tasks', 'id=$3', [id], user, batch);
    await mark(client, 'comments', 'task_id=$3', [id], user, batch);
    destination = `/projects/${project.id}`;
  } else {
    const row = (
      await client.query(
        `SELECT * FROM ${table('comments')} WHERE id=$1 AND deleted_at IS NULL`,
        [id],
      )
    ).rows[0];
    if (!row) throw new AppError('Comentario no encontrado.', 404);
    const { project } = await requireTask(user, row.task_id, 'write', client);
    if (row.author_id !== user.id && project.access !== 'manager')
      throw new AppError('Solo puedes eliminar tus comentarios.', 403);
    await mark(client, 'comments', 'id=$3', [id], user, batch);
    destination = `/tasks/${row.task_id}`;
  }
  return `${destination}?notice=${encodeURIComponent('Elemento movido a la papelera. Puedes restaurarlo desde allí.')}`;
}
export async function restoreEntity(
  client: PoolClient,
  user: User,
  kind: TrashKind,
  id: string,
) {
  const row = (
    await client.query(
      `SELECT * FROM ${table(tables[kind])} WHERE id=$1 AND deleted_at IS NOT NULL`,
      [id],
    )
  ).rows[0];
  if (!row) throw new AppError('El elemento ya no está en la papelera.', 404);
  if (kind === 'area') {
    if (user.role !== 'admin')
      throw new AppError('Solo un administrador puede restaurar áreas.', 403);
    await client.query(
      `SELECT id FROM ${table('areas')} WHERE id=$1 FOR UPDATE`,
      [id],
    );
  } else if (kind === 'project') {
    await requireArea(user, row.area_id, 'manage', client);
    await client.query(
      `SELECT id FROM ${table('projects')} WHERE id=$1 FOR UPDATE`,
      [id],
    );
  } else if (kind === 'task') {
    await requireProject(user, row.project_id, 'write', client);
    await client.query(
      `SELECT id FROM ${table('tasks')} WHERE id=$1 FOR UPDATE`,
      [id],
    );
  } else {
    const { project } = await requireTask(user, row.task_id, 'write', client);
    if (row.author_id !== user.id && project.access !== 'manager')
      throw new AppError('No puedes restaurar este comentario.', 403);
  }
  // Recheck after waiting for locks; a concurrent restore may have won.
  const current = (
    await client.query(
      `SELECT deletion_batch FROM ${table(tables[kind])} WHERE id=$1 AND deleted_at IS NOT NULL`,
      [id],
    )
  ).rows[0];
  if (!current) throw new AppError('El elemento ya se ha restaurado.', 409);
  const names =
    kind === 'area'
      ? ['areas', 'projects', 'tasks', 'comments']
      : kind === 'project'
        ? ['projects', 'tasks', 'comments']
        : kind === 'task'
          ? ['tasks', 'comments']
          : ['comments'];
  for (const name of names)
    await restoreBatch(client, name, current.deletion_batch);
  return (
    '/trash?notice=' +
    encodeURIComponent(
      'Elemento restaurado. Los elementos eliminados previamente siguen en la papelera.',
    )
  );
}
export async function changeUserStatus(
  client: PoolClient,
  user: User,
  id: string,
  active: boolean,
) {
  if (user.role !== 'admin') throw new AppError('Acceso restringido.', 403);
  if (id === user.id && !active)
    throw new AppError('No puedes desactivar tu propia cuenta.');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `${schema}:administrators`,
  ]);
  const target = (
    await client.query(
      `SELECT * FROM ${table('users')} WHERE id=$1 FOR UPDATE`,
      [id],
    )
  ).rows[0];
  if (!target) throw new AppError('Usuario no encontrado.', 404);
  if (!active && target.active && target.role === 'admin') {
    const count = (
      await client.query(
        `SELECT count(*)::int AS count FROM ${table('users')} WHERE role='admin' AND active`,
      )
    ).rows[0].count;
    if (count <= 1)
      throw new AppError('Debe quedar al menos un administrador activo.');
  }
  await client.query(`UPDATE ${table('users')} SET active=$1 WHERE id=$2`, [
    active,
    id,
  ]);
  if (!active)
    await client.query(`DELETE FROM ${table('sessions')} WHERE user_id=$1`, [
      id,
    ]);
  return (
    '/admin?notice=' +
    encodeURIComponent(
      active ? 'Cuenta reactivada.' : 'Cuenta desactivada y sesiones cerradas.',
    )
  );
}
export async function trashItems(user: User) {
  const admin = user.role === 'admin';
  const areas = admin
    ? (
        await pool.query(
          `SELECT id,name AS title,deleted_at,'area' AS kind,'Área' AS context FROM ${table('areas')} WHERE deleted_at IS NOT NULL`,
        )
      ).rows
    : [];
  const projects = (
    await pool.query(
      `SELECT p.id,p.name AS title,p.deleted_at,'project' AS kind,a.name AS context FROM ${table('projects')} p JOIN ${table('areas')} a ON a.id=p.area_id WHERE p.deleted_at IS NOT NULL AND a.deleted_at IS NULL AND ($2 OR EXISTS(SELECT 1 FROM ${table('area_members')} m WHERE m.area_id=a.id AND m.user_id=$1 AND m.role='manager'))`,
      [user.id, admin],
    )
  ).rows;
  const tasks = (
    await pool.query(
      `SELECT t.id,t.title,t.deleted_at,'task' AS kind,p.key||'-'||t.number AS context FROM ${table('tasks')} t JOIN ${table('projects')} p ON p.id=t.project_id JOIN ${table('areas')} a ON a.id=p.area_id WHERE t.deleted_at IS NOT NULL AND p.deleted_at IS NULL AND a.deleted_at IS NULL AND NOT p.archived AND ($2 OR EXISTS(SELECT 1 FROM ${table('area_members')} m WHERE m.area_id=a.id AND m.user_id=$1 AND m.role IN ('manager','member')))`,
      [user.id, admin],
    )
  ).rows;
  const comments = (
    await pool.query(
      `SELECT c.id,left(c.body,100) AS title,c.deleted_at,'comment' AS kind,p.key||'-'||t.number AS context FROM ${table('comments')} c JOIN ${table('tasks')} t ON t.id=c.task_id JOIN ${table('projects')} p ON p.id=t.project_id JOIN ${table('areas')} a ON a.id=p.area_id LEFT JOIN ${table('area_members')} m ON m.area_id=a.id AND m.user_id=$1 WHERE c.deleted_at IS NOT NULL AND t.deleted_at IS NULL AND p.deleted_at IS NULL AND a.deleted_at IS NULL AND NOT p.archived AND ($2 OR m.role='manager' OR (m.role='member' AND c.author_id=$1))`,
      [user.id, admin],
    )
  ).rows;
  return [...areas, ...projects, ...tasks, ...comments].sort(
    (a, b) =>
      new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime(),
  );
}
