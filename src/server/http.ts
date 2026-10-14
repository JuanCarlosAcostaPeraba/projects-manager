export function rejectUnsafeRequest(
  request: Request,
  url: URL,
): Response | null {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return null;
  if (request.headers.get('origin') !== url.origin)
    return new Response('Origen no permitido', { status: 403 });
  if (Number(request.headers.get('content-length') || 0) > 262144)
    return new Response('Formulario demasiado grande', { status: 413 });
  return null;
}
