import 'server-only';
import {inspectAuthSettings} from '../configuration/auth';
import {AccessError} from '../auth/access-policy';
import {mongoClient} from '../db/connection';
import {ProviderStore} from './store';
// Authenticated callers only. No secrets/provider IDs enter catalog projections.
export function providerStore() {
  const {settings} = inspectAuthSettings(process.env);
  if (!settings) throw new AccessError('CONNECTION_UNAVAILABLE');
  return new ProviderStore(mongoClient(settings).client.db(settings.databaseName), process.env);
}
