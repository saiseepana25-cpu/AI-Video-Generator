import type {NextRequest} from 'next/server';
import {handlers} from '@/auth';
import {inspectAuthSettings} from '@/server/configuration/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: NextRequest) {
  const {settings} = inspectAuthSettings(process.env);
  if (!settings) return Response.json({error:'AUTH_NOT_CONFIGURED'},{status:503,headers:{'Cache-Control':'no-store'}});
  if (new URL(request.url).host !== new URL(settings.origin).host || (request.method === 'POST' && request.headers.get('origin') !== settings.origin)) {
    return Response.json({error:'ORIGIN_NOT_ALLOWED'},{status:403,headers:{'Cache-Control':'no-store'}});
  }
  try {
    const response = await (request.method === 'POST' ? handlers.POST(request) : handlers.GET(request));
    response.headers.set('Cache-Control','private, no-store');
    return response;
  } catch {
    return Response.json({error:'AUTH_UNAVAILABLE'},{status:503,headers:{'Cache-Control':'no-store'}});
  }
}
export const GET = handle;
export const POST = handle;
