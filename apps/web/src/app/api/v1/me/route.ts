import {preferenceView} from '@/server/preferences/service';
import {workspaceContext} from '@/server/auth/context';
import {dataResponse,authErrorResponse} from '@/server/http/envelope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const {identity,member,workspace} = await workspaceContext();
    const {language,targetSeconds,preferredAccentId,preferredVoiceCatalogId} = workspace.defaults;
    const preferencesRevision = member.preferencesRevision.toNumber();
    if (!Number.isSafeInteger(preferencesRevision)) throw new Error('Invalid revision');
    return dataResponse({
      user:{id:identity.userId,name:identity.name,email:identity.email},
      workspace:{id:workspace._id,name:workspace.name,timezone:workspace.timezone},
      preferences:preferenceView({...member}).preferences,preferencesRevision,
      defaults:{language,targetSeconds,preferredAccentId,preferredVoiceCatalogId},
      capabilities:{
        planning:{enabled:false,reasonCode:'FEATURE_NOT_IMPLEMENTED'},
        generation:{enabled:false,reasonCode:'FEATURE_NOT_IMPLEMENTED'},
        publishing:{enabled:false,reasonCode:'INTEGRATION_NOT_CONFIGURED'},
        scheduling:{enabled:false,reasonCode:'ALWAYS_ON_HOST_UNVERIFIED'},
      },
    });
  } catch (error) { return authErrorResponse(error); }
}
