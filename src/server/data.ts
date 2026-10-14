import type { User } from './auth';
import { pool, table } from './database';
import { requireProject, requireTask } from './permissions';
export const statuses = {
  backlog: 'Backlog',
  todo: 'Por hacer',
  in_progress: 'En curso',
  review: 'En revisión',
  done: 'Hecho',
} as const;
export const priorities = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  urgent: 'Urgente',
} as const;
export const roles = {
  manager: 'Responsable',
  member: 'Miembro',
  viewer: 'Lector',
} as const;
export function initials(name: string) {
  return name
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
export function dateLabel(date: Date | string | null) {
  if (!date) return 'Sin fecha';
  return new Intl.DateTimeFormat('es', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(date));
}
export async function listAreas(user: User) {
  const result = await pool.query(
    `SELECT a.*, CASE WHEN $2 THEN 'manager' ELSE m.role END AS access,
    (SELECT count(*)::int FROM ${table('projects')} p WHERE p.area_id=a.id AND NOT p.archived) AS project_count,
    (SELECT count(*)::int FROM ${table('area_members')} am WHERE am.area_id=a.id) AS member_count
    FROM ${table('areas')} a LEFT JOIN ${table('area_members')} m ON m.area_id=a.id AND m.user_id=$1
    WHERE $2 OR m.user_id IS NOT NULL ORDER BY a.name`,
    [user.id, user.role === 'admin'],
  );
  return result.rows;
}
export async function listProjects(user: User) {
  const result = await pool.query(
    `SELECT p.*,a.name AS area_name,
    count(t.id)::int AS task_count, count(t.id) FILTER (WHERE t.status='done')::int AS done_count,
    CASE WHEN $2 THEN 'manager' ELSE m.role END AS access
    FROM ${table('projects')} p JOIN ${table('areas')} a ON a.id=p.area_id
    LEFT JOIN ${table('area_members')} m ON m.area_id=a.id AND m.user_id=$1
    LEFT JOIN ${table('tasks')} t ON t.project_id=p.id
    WHERE NOT p.archived AND ($2 OR m.user_id IS NOT NULL)
    GROUP BY p.id,a.name,m.role ORDER BY p.created_at DESC`,
    [user.id, user.role === 'admin'],
  );
  return result.rows;
}
export async function listAssignable(areaId: string) {
  return (
    await pool.query(
      `SELECT u.id,u.name FROM ${table('users')} u WHERE u.active AND (u.role='admin' OR EXISTS(SELECT 1 FROM ${table('area_members')} m WHERE m.user_id=u.id AND m.area_id=$1 AND m.role IN ('manager','member'))) ORDER BY u.name`,
      [areaId],
    )
  ).rows;
}
export async function projectData(user: User, projectId: string) {
  const project = await requireProject(user, projectId, 'read');
  const tasks = (
    await pool.query(
      `SELECT t.*,u.name AS assignee_name FROM ${table('tasks')} t LEFT JOIN ${table('users')} u ON u.id=t.assignee_id WHERE t.project_id=$1 ORDER BY t.number`,
      [projectId],
    )
  ).rows;
  const members = await listAssignable(project.area_id);
  return { project, tasks, members };
}
export async function taskData(user: User, taskId: string) {
  const { task, project } = await requireTask(user, taskId, 'read');
  const comments = (
    await pool.query(
      `SELECT c.*,u.name AS author_name FROM ${table('comments')} c JOIN ${table('users')} u ON u.id=c.author_id WHERE c.task_id=$1 ORDER BY c.created_at`,
      [taskId],
    )
  ).rows;
  const activity = (
    await pool.query(
      `SELECT a.*,u.name AS actor_name FROM ${table('activity')} a JOIN ${table('users')} u ON u.id=a.actor_id WHERE a.task_id=$1 ORDER BY a.created_at DESC LIMIT 30`,
      [taskId],
    )
  ).rows;
  return {
    task,
    project,
    comments,
    activity,
    members: await listAssignable(project.area_id),
  };
}
export async function myTasks(user: User) {
  return (
    await pool.query(
      `SELECT t.*,p.key,p.name AS project_name FROM ${table('tasks')} t JOIN ${table('projects')} p ON p.id=t.project_id
    WHERE t.assignee_id=$1 AND NOT p.archived AND ($2 OR EXISTS(SELECT 1 FROM ${table('area_members')} m WHERE m.area_id=p.area_id AND m.user_id=$1))
    ORDER BY (t.status='done'),t.due_date NULLS LAST,t.updated_at DESC`,
      [user.id, user.role === 'admin'],
    )
  ).rows;
}
