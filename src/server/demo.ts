import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { table } from './database';
export async function seedDemo(client: PoolClient, userId: string) {
  const areaId = randomUUID(),
    projectId = randomUUID();
  await client.query(
    `INSERT INTO ${table('areas')} (id,name,description) VALUES ($1,'Producto y desarrollo','Espacio de ejemplo para probar el gestor. Puedes crear tus propias áreas y proyectos.')`,
    [areaId],
  );
  await client.query(
    `INSERT INTO ${table('area_members')} (area_id,user_id,role) VALUES ($1,$2,'manager')`,
    [areaId, userId],
  );
  await client.query(
    `INSERT INTO ${table('projects')} (id,area_id,name,key,description,created_by,next_task_number) VALUES ($1,$2,'Nuestro primer MVP','MVP','De la idea a una primera versión que podamos usar. Estas tareas son ejemplos editables.',$3,7)`,
    [projectId, areaId, userId],
  );
  const examples = [
    ['Definir el alcance de la primera versión', 'done', 'high'],
    ['Diseñar el tablero de proyectos', 'review', 'medium'],
    ['Probar la gestión de tareas con el equipo', 'in_progress', 'high'],
    ['Organizar las áreas y sus responsables', 'todo', 'medium'],
    ['Recoger feedback del primer uso', 'todo', 'low'],
    ['Preparar el despliegue a producción', 'backlog', 'medium'],
  ];
  for (const [index, [title, status, priority]] of examples.entries()) {
    await client.query(
      `INSERT INTO ${table('tasks')} (id,project_id,number,title,status,priority,created_by,assignee_id,description) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,'Tarea de ejemplo. Edita sus detalles para empezar a probar el flujo de trabajo.')`,
      [randomUUID(), projectId, index + 1, title, status, priority, userId],
    );
  }
}
