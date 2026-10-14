import type { User } from './auth';
import { pool, table } from './database';
import type { PoolClient } from 'pg';
export type AreaRole = 'manager' | 'member' | 'viewer';
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function isAdmin(user: User) {
  return user.role === 'admin';
}
export function canWrite(role: AreaRole | null) {
  return role === 'manager' || role === 'member';
}
export function canManage(role: AreaRole | null) {
  return role === 'manager';
}
export async function areaRole(
  user: User,
  areaId: string,
  db: Pick<PoolClient, 'query'> = pool,
): Promise<AreaRole | null> {
  if (isAdmin(user)) return 'manager';
  const result = await db.query(
    `SELECT role FROM ${table('area_members')} WHERE area_id=$1 AND user_id=$2`,
    [areaId, user.id],
  );
  return result.rows[0]?.role || null;
}
export async function requireArea(
  user: User,
  areaId: string,
  mode: 'read' | 'write' | 'manage',
  db: Pick<PoolClient, 'query'> = pool,
) {
  const area = await db.query(
    `SELECT id FROM ${table('areas')} WHERE id=$1 AND deleted_at IS NULL ${mode === 'read' ? '' : 'FOR SHARE'}`,
    [areaId],
  );
  if (!area.rowCount) throw new AppError('Área no encontrada.', 404);
  const role = await areaRole(user, areaId, db);
  if (
    !role ||
    (mode === 'write' && !canWrite(role)) ||
    (mode === 'manage' && !canManage(role))
  )
    throw new AppError('No tienes permiso para esta acción.', 403);
  return role;
}
export async function requireProject(
  user: User,
  projectId: string,
  mode: 'read' | 'write' | 'manage',
  db: Pick<PoolClient, 'query'> = pool,
) {
  const reference = await db.query(
    `SELECT area_id FROM ${table('projects')} WHERE id=$1`,
    [projectId],
  );
  if (!reference.rowCount) throw new AppError('Proyecto no encontrado.', 404);
  const role = await requireArea(user, reference.rows[0].area_id, mode, db);
  const result = await db.query(
    `SELECT p.*,a.name AS area_name FROM ${table('projects')} p JOIN ${table('areas')} a ON a.id=p.area_id WHERE p.id=$1 AND p.deleted_at IS NULL ${mode === 'read' ? '' : 'FOR UPDATE OF p'}`,
    [projectId],
  );
  const project = result.rows[0];
  if (!project) throw new AppError('Proyecto no encontrado.', 404);
  if (mode !== 'read' && project.archived)
    throw new AppError('El proyecto está archivado.');
  return { ...project, access: role };
}
export async function requireTask(
  user: User,
  taskId: string,
  mode: 'read' | 'write',
  db: Pick<PoolClient, 'query'> = pool,
) {
  const reference = await db.query(
    `SELECT project_id FROM ${table('tasks')} WHERE id=$1`,
    [taskId],
  );
  if (!reference.rowCount) throw new AppError('Tarea no encontrada.', 404);
  const project = await requireProject(
    user,
    reference.rows[0].project_id,
    mode,
    db,
  );
  const result = await db.query(
    `SELECT * FROM ${table('tasks')} WHERE id=$1 AND deleted_at IS NULL ${mode === 'read' ? '' : 'FOR UPDATE'}`,
    [taskId],
  );
  if (!result.rows[0]) throw new AppError('Tarea no encontrada.', 404);
  const task = result.rows[0];
  return { task, project };
}
