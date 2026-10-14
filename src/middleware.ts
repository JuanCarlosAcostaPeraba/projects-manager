import { defineMiddleware } from 'astro:middleware';
import { currentUser } from './server/auth';
import { rejectUnsafeRequest } from './server/http';

export const onRequest = defineMiddleware(async (context, next) => {
  const rejected = rejectUnsafeRequest(context.request, context.url);
  if (rejected) return rejected;
  context.locals.user = await currentUser(context.cookies);
  const publicPath = ['/login', '/setup', '/api/auth'].includes(
    context.url.pathname,
  );
  if (!context.locals.user && !publicPath) return context.redirect('/login');
  const response = await next();
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'same-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  return response;
});
