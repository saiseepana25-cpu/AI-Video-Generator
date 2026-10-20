import {workspaceContext} from '@/server/auth/context';
import {providerStore} from '@/server/providers/runtime';
import {parseVoiceQuery} from '@/server/providers/catalog';
import {projectErrorResponse} from '@/server/projects/http';
import {rejectIfMatch} from '@/server/projects/validation';
import {dataResponse} from '@/server/http/envelope';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    await workspaceContext(); rejectIfMatch(request);
    return dataResponse(await providerStore().catalog(parseVoiceQuery(new URL(request.url).searchParams)));
  } catch (error) {return projectErrorResponse(error);}
}
