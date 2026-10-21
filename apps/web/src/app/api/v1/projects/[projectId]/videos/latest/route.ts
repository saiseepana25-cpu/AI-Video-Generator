import {videoHttp} from '@/server/videos/http';
export const runtime = 'nodejs';
export async function GET(request: Request, context: {params: Promise<{projectId: string}>}) {return videoHttp(request, (await context.params).projectId, 'latest');}
