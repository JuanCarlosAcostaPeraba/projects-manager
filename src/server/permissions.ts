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
  const result = await db.query(
    `SELECT p.*,a.name AS area_name FROM ${table('projects')} p JOIN ${table('areas')} a ON a.id=p.area_id WHERE p.id=$1`,
    [projectId],
  );
  const project = result.rows[0];
  if (!project) throw new AppError('Proyecto no encontrado.', 404);
  const role = await requireArea(user, project.area_id, mode, db);
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
  const result = await db.query(`SELECT * FROM ${table('tasks')} WHERE id=$1`, [
    taskId,
  ]);
  if (!result.rows[0]) throw new AppError('Tarea no encontrada.', 404);
  const task = result.rows[0];
  const project = await requireProject(user, task.project_id, mode, db);
  return { task, project };
}
