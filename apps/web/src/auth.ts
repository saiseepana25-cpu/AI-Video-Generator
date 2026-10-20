import 'server-only';
import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import {MongoDBAdapter} from '@auth/mongodb-adapter';
import {inspectAuthSettings, SESSION_SECONDS} from '@/server/configuration/auth';
import {googleIdentityApproved, safeReturnPath} from '@/server/auth/access-policy';
import {restrictedAdapter} from '@/server/auth/restricted-adapter';
import {authDatabase, enrollMember, mongoClient, prepareAuthDatabase, type Membership} from '@/server/db/auth-store';

export const {handlers, auth, signIn, signOut} = NextAuth(async () => {
  const {settings} = inspectAuthSettings(process.env);
  if (!settings) throw new Error('Authentication configuration unavailable');
  // Require the explicit migration before adapter writes; requests never run DDL.
  await prepareAuthDatabase(settings);
  const adapter = MongoDBAdapter(() => mongoClient(settings).client, {databaseName:settings.databaseName});
  return {
    secret:settings.secret,
    trustHost:true, // Requests are checked against the explicit AUTH_URL in our handlers.
    adapter:restrictedAdapter(adapter,settings.allowedEmails,(userId,email)=>enrollMember(settings,userId,email)),
    session:{strategy:'database',maxAge:SESSION_SECONDS,updateAge:SESSION_SECONDS},
    providers:[Google({clientId:settings.googleId,clientSecret:settings.googleSecret,allowDangerousEmailAccountLinking:false,authorization:{params:{scope:'openid email profile',prompt:'select_account'}}})],
    pages:{signIn:'/sign-in',error:'/sign-in'},
    callbacks:{
      async signIn({account,profile,user}) {
        if (!googleIdentityApproved({provider:account?.provider,subject:account?.providerAccountId,profile,userEmail:user.email},settings.allowedEmails)) return false;
        if (user.id && /^[a-f0-9]{24}$/.test(user.id)) {
          const member = await (await authDatabase(settings)).collection<Membership>('memberships').findOne({workspaceId:settings.workspaceId,userId:user.id});
          if (member?.status === 'disabled') return false;
        }
        return true;
      },
      async session({session,user}) {
        return {expires:session.expires, user:{id:user.id,name:user.name ?? 'Team member',email:user.email,image:null}};
      },
      async redirect({url}) {
        try {
          const target = new URL(url,settings.origin);
          return settings.origin + (target.origin === settings.origin ? safeReturnPath(target.pathname) : '/projects');
        } catch { return settings.origin + '/projects'; }
      },
    },
    logger:{
      // Library errors can contain provider tokens/URI details in their causes.
      error(error) {
        const known = ['CallbackRouteError','OAuthCallbackError','OAuthAccountNotLinked','AdapterError','AccessDenied','InvalidCheck','OAuthSignInError','Configuration'];
        const authError = error as Error & {type?:string;cause?:{err?:unknown}};
        const type = authError.type && known.includes(authError.type) ? authError.type : 'AuthenticationError';
        console.error(`[auth] ${type}; details redacted.`);
        const cause = authError.cause?.err;
        if (cause instanceof Error) {
          const allowedNames = ['TypeError','ReferenceError','OperationProcessingError','ResponseBodyError','MongoServerError'];
          const category = allowedNames.includes(cause.name) ? cause.name : 'Error';
          const code = 'code' in cause && typeof cause.code === 'string' && /^(OAUTH|ERR)_[A-Z_]+$/.test(cause.code) ? cause.code : 'UNCLASSIFIED';
          console.error(`[auth] cause=${category} code=${code}; details redacted.`);
          const oauthError = 'error' in cause ? cause.error : undefined;
          if (typeof oauthError === 'string' && ['invalid_client','invalid_grant','redirect_uri_mismatch','unauthorized_client','access_denied'].includes(oauthError)) console.error(`[auth] oauth=${oauthError}; details redacted.`);
        }
      },
      warn() { console.warn('[auth] Authentication warning; details redacted.'); },
      debug() {},
    },
  };
});
