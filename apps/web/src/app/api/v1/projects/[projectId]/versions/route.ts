import {authenticatedPlanning} from '@/server/planning/runtime';
import {dataResponse} from '@/server/http/envelope';
import {projectErrorResponse} from '@/server/projects/http';
import {authenticatedVideoHistory} from '@/server/videos/runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: {params: Promise<{projectId: string}>}) {
  try {const query = new URL(request.url).searchParams;
    const service = query.get('kind') === 'video' ? await authenticatedVideoHistory() : await authenticatedPlanning();
    return dataResponse(await service.versions((await context.params).projectId, query));}
  catch (error) {return projectErrorResponse(error);}
}
