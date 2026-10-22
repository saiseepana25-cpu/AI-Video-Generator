import {authenticatedLogos} from '@/server/logos/runtime';
import {projectErrorResponse} from '@/server/projects/http';
import {ProjectError} from '@/server/projects/contracts';
import {randomUUID} from 'node:crypto';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{assetId:string}>}){
  try{const service=await authenticatedLogos();if(new URL(request.url).search)throw new ProjectError('INVALID_QUERY',400,'Logo previews do not accept query parameters.');if(request.headers.get('sec-fetch-site')==='cross-site')throw new ProjectError('CROSS_SITE_DENIED',403,'Open this logo in the studio.');const bytes=await service.preview((await context.params).assetId);return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'image/png','Content-Length':String(bytes.length),'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','X-Request-ID':randomUUID(),'Content-Disposition':'inline; filename="logo.png"','Content-Security-Policy':"default-src 'none'; sandbox"}});}catch(error){return projectErrorResponse(error);}
}
