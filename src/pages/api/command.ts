import type { APIRoute } from 'astro';
import { execute } from '../../server/commands';
import { AppError } from '../../server/permissions';
export const POST: APIRoute = async ({ request, locals, url, redirect }) => {
  if (!locals.user) return new Response('Inicia sesión.', { status: 401 });
  const input = Object.fromEntries(await request.formData());
  const json = request.headers.get('accept') === 'application/json';
  try {
    const destination = await execute(locals.user, String(input.action), input);
    if (json) return Response.json({ destination });
    return redirect(destination, 303);
  } catch (error) {
    const code = (error as { code?: string }).code;
    const message =
      error instanceof AppError
        ? error.message
        : code === '23505'
          ? 'Ya existe un registro con ese nombre, clave o correo.'
          : 'No se pudo guardar. Revisa los datos e inténtalo de nuevo.';
    if (!(error instanceof AppError))
      console.error('Error al guardar', code || 'internal');
    if (json)
      return Response.json(
        { error: message },
        { status: error instanceof AppError ? error.status : 400 },
      );
    let back = '/';
    const ref = request.headers.get('referer');
    if (ref) {
      const candidate = new URL(ref);
      if (
        candidate.origin === url.origin &&
        !candidate.pathname.startsWith('/api/')
      )
        back = candidate.pathname + candidate.search;
    }
    const destination = new URL(back, url);
    destination.searchParams.set('error', message);
    return redirect(destination.pathname + destination.search, 303);
  }
};
