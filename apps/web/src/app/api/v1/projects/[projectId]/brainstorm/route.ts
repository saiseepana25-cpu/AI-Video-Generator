import {planningCommand} from '@/server/planning/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: {params: Promise<{projectId: string}>}) {
  return planningCommand(request, (await context.params).projectId, 'brainstorm');
}
