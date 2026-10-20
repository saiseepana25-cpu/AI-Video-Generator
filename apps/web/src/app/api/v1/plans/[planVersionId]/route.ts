import {planningRead} from '@/server/planning/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: {params: Promise<{planVersionId: string}>}) {
  return planningRead(request, (await context.params).planVersionId, 'plan');
}
