import type {ClientSession, Db, MongoClient} from 'mongodb';

/** Only serial MongoDB work belongs in the callback, which may execute again.
 * Prepare IDs/hashes before calling. Never call providers/R2, send responses, or
 * perform other external side effects inside. Keep every operation on session.
 * An ambiguous commit must be resolved via the domain command's stable identity.
 */
export async function databaseTransaction<T>(
  client: MongoClient, databaseName: string,
  work: (db: Db, session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = client.startSession();
  try {
    return await session.withTransaction(
      async () => work(client.db(databaseName), session),
      {readPreference: 'primary', readConcern: {level: 'snapshot'}, writeConcern: {w: 'majority'},
        maxCommitTimeMS: 5000, timeoutMS: 15000},
    );
  } finally {
    await session.endSession();
  }
}
