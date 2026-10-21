import {videoHttp} from '@/server/videos/http';
export const runtime = 'nodejs';
export async function GET(request: Request, context: {params: Promise<{videoId: string}>}) {return videoHttp(request, (await context.params).videoId, 'detail');}
