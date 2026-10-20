import type {Adapter} from 'next-auth/adapters';
import {randomUUID} from 'node:crypto';
import {normalizeEmail, SESSION_SECONDS} from '../configuration/auth';
import {AccessError} from './access-policy';

export function restrictedAdapter(base: Adapter, allowedEmails: Set<string>, enroll: (userId: string, email: string) => Promise<void>): Adapter {
  return {
    ...base,
    async createUser(data) {
      const email = normalizeEmail(data.email);
      if (!email || !allowedEmails.has(email)) throw new AccessError('TEAM_ACCESS_DENIED');
      return base.createUser!({id:randomUUID(),email, name: typeof data.name === 'string' ? data.name.slice(0,120) : null, image:null, emailVerified:null});
    },
    async linkAccount(data) {
      if (data.provider !== 'google' || !data.providerAccountId) throw new AccessError('TEAM_ACCESS_DENIED');
      // Login requires no retained Google API/refresh/ID token or avatar URL.
      await base.linkAccount!({userId:data.userId,provider:'google',providerAccountId:data.providerAccountId,type:data.type});
    },
    async createSession(data) {
      const user = await base.getUser!(data.userId);
      const email = normalizeEmail(user?.email);
      if (!user || !email || !allowedEmails.has(email)) throw new AccessError('TEAM_ACCESS_DENIED');
      await enroll(user.id,email);
      // Store the absolute deadline; later reads cannot extend it.
      return base.createSession!({...data,expires:new Date(Math.min(data.expires.getTime(),Date.now()+SESSION_SECONDS*1000))});
    },
    async updateSession(data) {
      const existing = await base.getSessionAndUser!(data.sessionToken);
      if (!existing || existing.session.expires.getTime() <= Date.now()) return null;
      // Auth.js may refresh the browser cookie; the database expiry stays absolute.
      return existing.session;
    },
  };
}
