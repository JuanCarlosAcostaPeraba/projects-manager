import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { User } from './auth';
import type { PoolClient } from 'pg';
import { table, transaction } from './database';
import { removeEntity, restoreEntity, changeUserStatus } from './lifecycle';
import { hashPassword, verifyPassword } from './password';
import {
  AppError,
  requireArea,
  requireProject,
  requireTask,
} from './permissions';
import { statuses } from './data';
const uuid = z.uuid();
const name = z.string().trim().min(1).max(100);
export const passwordSchema = z
  .string()
  .min(12, 'La contraseña debe tener al menos 12 caracteres.')
  .max(128);
export const emailSchema = z.email().trim().toLowerCase().max(254);
const taskFields = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10000),
  status: z.enum(['backlog', 'todo', 'in_progress', 'review', 'done']),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  assignee_id: z.union([uuid, z.literal('')]).transform((v) => v || null),
  start_date: z
    .union([z.iso.date(), z.literal('')])
    .optional()
    .transform((v) => v || null),
  due_date: z.union([z.iso.date(), z.literal('')]).transform((v) => v || null),
});
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new AppError(
      parsed.error.issues[0]?.message || 'Revisa los datos del formulario.',
    );
  return parsed.data;
}
async function checkAssignee(
  client: Parameters<Parameters<typeof transaction>[0]>[0],
  userId: string | null,
  areaId: string,
) {
  if (!userId) return;
  const result = await client.query(
    `SELECT id FROM ${table('users')} u WHERE u.id=$1 AND u.active AND (u.role='admin' OR EXISTS(SELECT 1 FROM ${table('area_members')} m WHERE m.user_id=u.id AND m.area_id=$2 AND m.role IN ('manager','member')))`,
    [userId, areaId],
  );
  if (!result.rowCount)
    throw new AppError('El responsable debe ser un miembro activo del área.');
}
export async function execute(
  user: User,
  action: string,
  input: Record<string, unknown>,
): Promise<string> {
  return transaction((client) => executeCommand(user, action, input, client));
}
async function executeCommand(
  user: User,
  action: string,
  input: Record<string, unknown>,
  client: PoolClient,
): Promise<string> {
  if (
    ['area.delete', 'project.delete', 'task.delete', 'comment.delete'].includes(
      action,
    )
  ) {
    const kind = action.split('.')[0] as
      'area' | 'project' | 'task' | 'comment';
    const id = parse(uuid, input[`${kind}_id`]);
    const version =
      kind === 'task'
        ? parse(z.coerce.number().int().positive(), input.version)
        : undefined;
    return removeEntity(client, user, kind, id, version);
  }
  if (action === 'trash.restore') {
    const data = parse(
      z.object({
        kind: z.enum(['area', 'project', 'task', 'comment']),
        id: uuid,
      }),
      input,
    );
    return restoreEntity(client, user, data.kind, data.id);
  }
  if (action === 'user.deactivate' || action === 'user.activate') {
    return changeUserStatus(
      client,
      user,
      parse(uuid, input.user_id),
      action === 'user.activate',
    );
  }
  if (action === 'area.create') {
    if (user.role !== 'admin')
      throw new AppError('Solo el administrador puede crear áreas.', 403);
    const data = parse(
      z.object({ name, description: z.string().trim().max(2000) }),
      input,
    );
    await client.query(
      `INSERT INTO ${table('areas')} (id,name,description) VALUES ($1,$2,$3)`,
      [randomUUID(), data.name, data.description],
    );
    return '/areas';
  }
  if (action === 'project.create') {
    const data = parse(
      z.object({
        area_id: uuid,
        name: z.string().trim().min(1).max(120),
        key: z
          .string()
          .trim()
          .toUpperCase()
          .regex(
            /^[A-Z][A-Z0-9]{1,9}$/,
            'La clave necesita entre 2 y 10 letras o números y debe empezar por una letra.',
          ),
        description: z.string().trim().max(5000),
      }),
      input,
    );
    await requireArea(user, data.area_id, 'manage', client);
    const id = randomUUID();
    await client.query(
      `INSERT INTO ${table('projects')} (id,area_id,name,key,description,created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, data.area_id, data.name, data.key, data.description, user.id],
    );
    return `/projects/${id}`;
  }
  if (action === 'task.create' || action === 'task.update') {
    const fields = parse(taskFields, input);
    if (
      fields.start_date &&
      fields.due_date &&
      fields.start_date > fields.due_date
    )
      throw new AppError(
        'La fecha de inicio debe ser anterior o igual a la fecha límite.',
      );
    const id = parse(
      uuid,
      input[action === 'task.create' ? 'project_id' : 'task_id'],
    );
    const version =
      action === 'task.update'
        ? parse(z.coerce.number().int().positive(), input.version)
        : 0;
    const context =
      action === 'task.update'
        ? await requireTask(user, id, 'write', client)
        : null;
    const project =
      context?.project || (await requireProject(user, id, 'write', client));
    await checkAssignee(client, fields.assignee_id, project.area_id);
    const values = [
      fields.title,
      fields.description,
      fields.status,
      fields.priority,
      fields.assignee_id,
      fields.due_date,
      fields.start_date,
    ];
    if (context) {
      const result = await client.query(
        `UPDATE ${table('tasks')} SET title=$1,description=$2,status=$3,priority=$4,assignee_id=$5,due_date=$6,start_date=$7,version=version+1,updated_at=now() WHERE id=$8 AND version=$9 RETURNING id`,
        [...values, id, version],
      );
      if (!result.rowCount)
        throw new AppError(
          'Otra persona ha actualizado esta tarea. Recarga la página antes de guardar.',
          409,
        );
      const description =
        context.task.status !== fields.status
          ? `Cambió el estado a ${statuses[fields.status]}`
          : 'Actualizó la tarea';
      await client.query(
        `INSERT INTO ${table('activity')} (task_id,actor_id,description) VALUES ($1,$2,$3)`,
        [id, user.id, description],
      );
      return `/tasks/${id}`;
    }
    const number = (
      await client.query(
        `UPDATE ${table('projects')} SET next_task_number=next_task_number+1 WHERE id=$1 RETURNING next_task_number-1 AS number`,
        [project.id],
      )
    ).rows[0].number;
    const taskId = randomUUID();
    await client.query(
      `INSERT INTO ${table('tasks')} (title,description,status,priority,assignee_id,due_date,start_date,id,project_id,number,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [...values, taskId, project.id, number, user.id],
    );
    await client.query(
      `INSERT INTO ${table('activity')} (task_id,actor_id,description) VALUES ($1,$2,'Creó la tarea')`,
      [taskId, user.id],
    );
    return `/projects/${project.id}`;
  }
  if (action === 'task.status') {
    const data = parse(
      z.object({
        task_id: uuid,
        status: z.enum(['backlog', 'todo', 'in_progress', 'review', 'done']),
        version: z.coerce.number().int().positive(),
      }),
      input,
    );
    const { project } = await requireTask(user, data.task_id, 'write', client);
    const result = await client.query(
      `UPDATE ${table('tasks')} SET status=$1,version=version+1,updated_at=now() WHERE id=$2 AND version=$3`,
      [data.status, data.task_id, data.version],
    );
    if (!result.rowCount)
      throw new AppError('La tarea ha cambiado. Recarga la página.', 409);
    await client.query(
      `INSERT INTO ${table('activity')} (task_id,actor_id,description) VALUES ($1,$2,$3)`,
      [data.task_id, user.id, `Cambió el estado a ${statuses[data.status]}`],
    );
    return `/projects/${project.id}`;
  }
  if (action === 'comment.create') {
    const data = parse(
      z.object({ task_id: uuid, body: z.string().trim().min(1).max(5000) }),
      input,
    );
    await requireTask(user, data.task_id, 'write', client);
    await client.query(
      `INSERT INTO ${table('comments')} (id,task_id,author_id,body) VALUES ($1,$2,$3,$4)`,
      [randomUUID(), data.task_id, user.id, data.body],
    );
    return `/tasks/${data.task_id}`;
  }
  if (action === 'user.create') {
    if (user.role !== 'admin')
      throw new AppError('Solo el administrador puede crear usuarios.', 403);
    const data = parse(
      z.object({
        name,
        email: emailSchema,
        password: passwordSchema,
        role: z.enum(['admin', 'member']),
      }),
      input,
    );
    await client.query(
      `INSERT INTO ${table('users')} (id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,$5)`,
      [
        randomUUID(),
        data.name,
        data.email,
        await hashPassword(data.password),
        data.role,
      ],
    );
    return '/admin';
  }
  if (action === 'member.save') {
    const data = parse(
      z.object({
        area_id: uuid,
        user_id: uuid,
        role: z.enum(['manager', 'member', 'viewer', 'remove']),
      }),
      input,
    );
    await requireArea(user, data.area_id, 'manage', client);
    if (data.role === 'remove')
      await client.query(
        `DELETE FROM ${table('area_members')} WHERE area_id=$1 AND user_id=$2`,
        [data.area_id, data.user_id],
      );
    else
      await client.query(
        `INSERT INTO ${table('area_members')} (area_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT (area_id,user_id) DO UPDATE SET role=excluded.role`,
        [data.area_id, data.user_id, data.role],
      );
    return '/areas';
  }
  if (action === 'password.change') {
    const data = parse(
      z.object({ current: z.string().max(128), password: passwordSchema }),
      input,
    );
    const row = (
      await client.query(
        `SELECT password_hash FROM ${table('users')} WHERE id=$1`,
        [user.id],
      )
    ).rows[0];
    if (!(await verifyPassword(data.current, row.password_hash)))
      throw new AppError('La contraseña actual no es correcta.');
    await client.query(
      `UPDATE ${table('users')} SET password_hash=$1 WHERE id=$2`,
      [await hashPassword(data.password), user.id],
    );
    await client.query(`DELETE FROM ${table('sessions')} WHERE user_id=$1`, [
      user.id,
    ]);
    return '/login?changed=1';
  }
  throw new AppError('Acción no válida.');
}
