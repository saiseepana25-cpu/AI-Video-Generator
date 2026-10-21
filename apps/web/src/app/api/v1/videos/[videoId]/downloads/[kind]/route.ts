import {videoHttp} from '@/server/videos/http';
export const runtime = 'nodejs';
type Context = {params: Promise<{videoId: string; kind: string}>};
export async function GET(request: Request, context: Context) {const {videoId, kind} = await context.params; return videoHttp(request, videoId, 'download', kind);}
export async function HEAD(request: Request, context: Context) {const {videoId, kind} = await context.params; return videoHttp(request, videoId, 'download', kind);}
