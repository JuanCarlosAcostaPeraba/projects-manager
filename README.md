# Projects Manager

Primer MVP de un gestor de proyectos y tareas inspirado en GitHub Projects, con Astro, TypeScript y PostgreSQL.

## Arranque local

Requisitos: Node.js 22.12 o posterior, pnpm y acceso a PostgreSQL. Configurar `.env` a partir de `.env.example`; las credenciales se leen únicamente en el servidor. El esquema de desarrollo es `projects_manager`.

```sh
pnpm install
pnpm db:migrate
pnpm dev --background
```

Abrir [http://localhost:4321](http://localhost:4321). El primer acceso permite crear el administrador y, opcionalmente, cargar seis tareas de ejemplo. Después: crear áreas, usuarios, permisos y proyectos.

```sh
pnpm astro dev status
pnpm astro dev logs
pnpm astro dev stop
```

Si ya hay un servidor iniciado en una terminal, sus registros estarán en esa terminal.

## Comprobaciones

```sh
pnpm check
pnpm test
pnpm build
```

Las pruebas usan la conexión del `.env`, crean un esquema temporal único y lo eliminan al terminar; necesitan permiso para crear esquemas. No modifican los datos de `projects_manager`.

Para ejecutar la versión compilada, usar `pnpm start`. `HOST` y `PORT` permiten definir la dirección del servidor. Cuando se despliegue, `APP_ORIGIN` deberá contener el dominio HTTPS antes de compilar. En un servidor con variables inyectadas y sin archivo `.env`, ejecutar directamente `node dist/server/entry.mjs`.

## Alcance y migración

[Detalle del MVP, permisos y traslado a producción](docs/mvp.md). La aplicación está preparada para pruebas locales; la publicación y el traslado de datos a producción quedan para una fase posterior.
