import {authenticatedPlanning} from '@/server/planning/runtime';
import {dataResponse} from '@/server/http/envelope';
import {projectErrorResponse} from '@/server/projects/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: {params: Promise<{projectId: string}>}) {
  try {const service = await authenticatedPlanning(); return dataResponse(await service.versions((await context.params).projectId, new URL(request.url).searchParams));}
  catch (error) {return projectErrorResponse(error);}
}
