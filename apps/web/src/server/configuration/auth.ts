export const SESSION_SECONDS = 7 * 24 * 60 * 60;

export type AuthSettings = {
  secret: string; origin: string; googleId: string; googleSecret: string;
  allowedEmails: Set<string>; mongoUri: string; databaseName: string;
  workspaceId: string; workspaceName: string;
};

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email) ? email : null;
}

// This module has no side effects. Callers must never serialize settings to a client.
export function inspectAuthSettings(env: Record<string, string | undefined>) {
  const issues: string[] = [];
  const value = (key: string) => env[key]?.trim() ?? '';
  const secret = value('AUTH_SECRET');
  if (secret.length < 32) issues.push('AUTH_SECRET');
  let origin = '';
  try {
    const url = new URL(value('AUTH_URL'));
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    origin = url.origin;
  } catch { issues.push('AUTH_URL'); }
  const googleId = value('AUTH_GOOGLE_ID');
  const googleSecret = value('AUTH_GOOGLE_SECRET');
  if (!/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(googleId)) issues.push('AUTH_GOOGLE_ID');
  if (!googleSecret || /[<>\s]/.test(googleSecret)) issues.push('AUTH_GOOGLE_SECRET');
  const entries = value('TEAM_ALLOWED_EMAILS').split(',').map(s => s.trim()).filter(Boolean);
  const allowedEmails = new Set(entries.map(normalizeEmail).filter((s): s is string => s !== null));
  if (!entries.length || entries.some(s => !normalizeEmail(s))) issues.push('TEAM_ALLOWED_EMAILS');
  const mongoUri = value('MONGODB_URI');
  if (!/^mongodb(?:\+srv)?:\/\/[^\s<>]+$/.test(mongoUri) || /[?&](?:tls|ssl)=false(?:&|$)/i.test(mongoUri)) issues.push('MONGODB_URI');
  const databaseName = value('MONGODB_DB');
  if (!/^[a-zA-Z0-9_-]{1,63}$/.test(databaseName)) issues.push('MONGODB_DB');
  const workspaceId = value('WORKSPACE_ID');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(workspaceId)) issues.push('WORKSPACE_ID');
  const workspaceName = value('WORKSPACE_NAME');
  if (!workspaceName || [...workspaceName].length > 120) issues.push('WORKSPACE_NAME');
  const settings: AuthSettings | null = issues.length ? null : {secret,origin,googleId,googleSecret,allowedEmails,mongoUri,databaseName,workspaceId,workspaceName};
  return {ready: settings !== null, issues, settings};
}
