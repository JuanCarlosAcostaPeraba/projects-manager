# Primer MVP

## Alcance disponible

- Cuentas locales: administrador inicial, alta de usuarios, inicio y cierre de sesión y cambio de contraseña.
- Áreas con responsables, miembros y lectores. Un usuario puede pertenecer a varias áreas con distintos permisos.
- Creación de proyectos con una clave única para numerar sus tareas.
- Tablero Kanban y lista; búsqueda y filtro por responsable.
- Creación y edición de tareas con descripción, estado, prioridad, responsable y fecha límite.
- Cambios de estado mediante un selector; arrastre de tarjetas como mejora de la interfaz.
- Mis tareas, comentarios e historial de cambios de las tareas.
- PostgreSQL real, migraciones transaccionales con verificación de integridad y bloqueo para evitar ejecuciones simultáneas.

Los seis ejemplos solo se crean si se marca la casilla correspondiente al configurar el primer administrador. No hay contraseñas predefinidas ni registro público una vez configurado el espacio.

## Permisos

| Acción                                | Lector | Miembro | Responsable | Administrador   |
| ------------------------------------- | ------ | ------- | ----------- | --------------- |
| Consultar proyectos y tareas del área | Sí     | Sí      | Sí          | Todas las áreas |
| Crear y editar tareas; comentar       | No     | Sí      | Sí          | Sí              |
| Crear proyectos en el área            | No     | No      | Sí          | Sí              |
| Asignar o retirar permisos del área   | No     | No      | Sí          | Sí              |
| Crear áreas y cuentas                 | No     | No      | No          | Sí              |

Los permisos se heredan del área. Todavía no hay proyectos privados dentro de un área ni permisos individuales por tarea. Retirar la pertenencia al área impide inmediatamente consultar sus proyectos y tareas, aunque alguna tarea conserve el usuario como responsable histórico. Los responsables de área pueden seleccionar personas activas por nombre para conceder acceso; el correo y la administración de cuentas están reservados al administrador.

Las comprobaciones se ejecutan en el servidor, también al solicitar una tarea directamente por su ID. Las sesiones usan un token aleatorio cuya huella se almacena en PostgreSQL. Las contraseñas usan scrypt; el acceso tiene un límite de intentos. El cambio de contraseña invalida todas las sesiones de esa cuenta. Las ediciones de tareas incluyen una versión para detectar cambios simultáneos.

## Estructura

- `src/pages`: pantallas y endpoints Astro.
- `src/server`: conexión, autenticación, consultas, permisos y operaciones de escritura.
- `db/migrations`: SQL versionado; no editar migraciones ya aplicadas, añadir una nueva.
- `scripts/migrate.ts`: aplicación de migraciones.
- `tests/integration.test.ts`: pruebas con PostgreSQL en un esquema temporal exclusivo para cada ejecución, eliminado al finalizar.

Todas las tablas se califican con el esquema configurado. El código no usa `search_path` ni requiere extensiones, superusuario o cambios en otros esquemas.

## Traslado a producción

La publicación sigue pendiente. Al preparar el entorno definitivo habrá que configurar dominio, HTTPS y proxy, usuario de base de datos, copias de seguridad y las credenciales del servidor. Crear la primera cuenta antes de exponer un espacio vacío a Internet.

Para arrancar sin datos de pruebas, configurar la nueva conexión y ejecutar `pnpm db:migrate`. Si se quieren conservar proyectos, tareas y usuarios, trasladar **solo** el esquema `projects_manager` a un destino en el que todavía no exista ese esquema:

1. Detener escrituras durante el corte definitivo y guardar una copia de seguridad.
2. Configurar las variables estándar de conexión de PostgreSQL (`PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`) para el origen, usando un archivo de contraseñas o el prompt del cliente.
3. Exportar estructura y datos, excluyendo sesiones e intentos de acceso:

```sh
pg_dump --format=custom --schema=projects_manager --exclude-table-data=projects_manager.sessions --exclude-table-data=projects_manager.login_attempts --file=projects_manager.dump
```

4. Cambiar esas variables de conexión al destino y restaurar con un usuario autorizado, conservando el nombre del esquema:

```sh
pg_restore --no-owner --no-acl --single-transaction --dbname=BASE_DESTINO projects_manager.dump
```

5. Configurar `DB_SCHEMA=projects_manager` y el resto de variables de la nueva conexión en la aplicación. Ejecutar `pnpm db:migrate` para aplicar únicamente las migraciones que falten. La tabla de migraciones forma parte del volcado.
6. Definir `APP_ORIGIN=https://dominio-definitivo` **antes de compilar**, compilar y arrancar. Con un proxy, configurar las cabeceras de host y protocolo para ese dominio. Revisar recuentos, usuarios, permisos y operaciones antes de abrir el acceso; cada usuario volverá a iniciar sesión.

El volcado contiene hashes de contraseñas y datos del equipo; guardarlo fuera del repositorio. Estas instrucciones están preparadas pero la restauración a producción no se ha ejecutado. Referencias: [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html) y [dominios permitidos de Astro](https://docs.astro.build/en/reference/configuration-reference/#securityalloweddomains).

## Próximas iteraciones

Edición y archivo de proyectos, desactivación de usuarios y recuperación de contraseña; invitaciones o SSO; etiquetas, adjuntos, subtareas, vistas guardadas, notificaciones y auditoría de permisos. Los estados son fijos en este MVP: Backlog, Por hacer, En curso, En revisión y Hecho.

## Validación realizada

Once pruebas de integración cubren migraciones repetibles, contraseñas, límites de áreas, roles, numeración concurrente, conflictos de edición, comentarios, revocación de permisos, sesiones, limitación de intentos y protección de origen. La revisión en navegador se hizo sobre el servidor compilado y un esquema temporal: acceso, creación, edición, asignación y comentarios, más la distribución móvil. El arrastre se implementó, pero no se pudo confirmar con la automatización de navegador; el selector de estado funciona y ofrece una alternativa accesible.
