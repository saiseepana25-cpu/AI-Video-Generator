import {normalizeEmail} from '../configuration/auth';

export class AccessError extends Error {
  constructor(public readonly code: 'AUTHENTICATION_REQUIRED' | 'SESSION_EXPIRED' | 'TEAM_ACCESS_DENIED' | 'CONNECTION_UNAVAILABLE') {
    super(code);
    this.name = 'AccessError';
  }
}

export function googleIdentityApproved(input: {provider?: string; subject?: unknown; profile?: {sub?: unknown; email?: unknown; email_verified?: unknown}; userEmail?: unknown}, allowed: Set<string>) {
  const email = normalizeEmail(input.profile?.email);
  return input.provider === 'google' && typeof input.subject === 'string' && input.subject.length > 0 && input.subject === input.profile?.sub && input.profile?.email_verified === true && email !== null && email === normalizeEmail(input.userEmail) && allowed.has(email);
}

export type SessionIdentity = {user?: {id?: string; name?: string | null; email?: string | null}; expires?: string} | null;
export type AccessMembership = {userId: string; workspaceId: string; normalizedEmail: string; status: string};

export function authorizeIdentity(session: SessionIdentity, allowed: Set<string>, now = Date.now()) {
  if (!session?.user?.id || !/^[a-f0-9]{24}$/.test(session.user.id)) throw new AccessError('AUTHENTICATION_REQUIRED');
  if (!session.expires || !Number.isFinite(Date.parse(session.expires)) || Date.parse(session.expires) <= now) throw new AccessError('SESSION_EXPIRED');
  const email = normalizeEmail(session.user.email);
  if (!email || !allowed.has(email)) throw new AccessError('TEAM_ACCESS_DENIED');
  return {userId:session.user.id, email, name:session.user.name || 'Team member'};
}

export function authorizeMembership(member: AccessMembership | null, userId: string, email: string, workspaceId: string) {
  if (!member || member.status !== 'active' || member.userId !== userId || member.workspaceId !== workspaceId || member.normalizedEmail !== email) throw new AccessError('TEAM_ACCESS_DENIED');
}

// No external redirects or user-provided query strings survive authentication.
export function safeReturnPath(value: unknown): string {
  if (typeof value !== 'string') return '/projects';
  if (['/projects', '/calendar', '/settings'].includes(value)) return value;
  return /^\/projects\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value) ? value : '/projects';
}
