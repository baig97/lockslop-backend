import { baseUrl } from '@/lib/config';
import { requireSession, route, HttpError } from '@/lib/http';
export const runtime = 'nodejs';
export const GET = route(async request => {
  const action = new URL(request.url).pathname.split('/').pop();
  if (action === 'config') {
    if (!process.env.OAUTH_EXTENSION_CLIENT_ID) throw new HttpError(503, 'OAuth client has not been registered.');
    return Response.json({ clientId: process.env.OAUTH_EXTENSION_CLIENT_ID, issuer: `${baseUrl}/api/auth`, resource: `${baseUrl}/api/v1` });
  }
  if (action === 'session') {
    const {user} = await requireSession(request);
    return Response.json({userId:user.id,displayName:user.name});
  }
  throw new HttpError(404, 'Not found.');
});
export const OPTIONS = GET;
