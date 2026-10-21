import {generationHttp} from '@/server/generation/http';
export const runtime = 'nodejs';
export async function GET(request: Request, context: {params: Promise<{projectId: string}>}) {return generationHttp(request, (await context.params).projectId, false);}
export async function POST(request: Request, context: {params: Promise<{projectId: string}>}) {return generationHttp(request, (await context.params).projectId, true);}
