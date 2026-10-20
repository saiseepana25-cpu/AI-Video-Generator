# VideoCraft database foundation

F05 adds explicit migration `003_project_editing` for edit receipts/events. With application/worker writes stopped, run `npm.cmd run web:db:migrate`, then `npm.cmd run web:db:check`, and restart the application. Existing 001/002 checksums remain unchanged. No new credentials, provider calls or indexes are required. Never run migration commands simultaneously with app writes. Current implementation evidence is recorded in Project Status.

F03 uses the installed MongoDB Node driver (6.21.0), explicit migration tooling and MongoDB replica-set transactions. It adds no paid service or dependency. F04 project creation uses this foundation; its acceptance is tracked separately in PROJECT_STATUS.md.

F04 adds migration `002_project_library`: nullable draft voice/accent, strict typed `idempotency_records` and `activity_events`, command replay uniqueness/expiry and activity deduplication/sequence indexes. Migration 001's manifest and checksum stay unchanged. The runner applies ordered versions and checks the latest effective validator for each collection; it verifies the existing baseline before any pending upgrade. Existing application data is audited, not automatically rewritten. Runtime readiness now requires both versions.

## Configure and migrate the development database

Use a dedicated application database. Keep `MONGODB_URI` and `MONGODB_DB` in the ignored **`apps/web/.env.local`**. The CLI does not load the root prototype's environment file. It refuses the system database names `admin`, `local`, and `config`.

From the repository root, with application/worker writes stopped:

```powershell
npm.cmd run web:db:migrate
npm.cmd run web:db:check
npm.cmd run web:dev
```

Migration `001_database_foundation` audits current data before tightening validators, preserves existing records and settings, and creates:

- Strict/error validators for application-owned `workspaces`, `memberships` and `projects`. Unknown fields, malformed UUIDs, invalid enums and incorrect BSON types are rejected. Counters are nonnegative BSON Long, dates are BSON Date.
- The recent-project keyset index, unique workspace/user membership index and membership-status lookup.
- The existing five Auth.js indexes, including session TTL. Adapter-owned users/accounts/sessions retain their pinned library formats; no custom validator is imposed on those documents.
- A strict `schema_migrations` history with checksum, owner, BSON Long epoch and partial unique lock for one running migration.

The project deletion receipt is null until its later feature migration. Later jobs/media/publishing collections are added with their owning features. The project feature adds its bounded command/activity schemas in migration 002, without claiming a working activity drawer. Request validation, catalog compatibility, IANA timezones, grapheme/UTF-8 bounds, cross-record relationships and state transitions remain domain-service responsibilities. MongoDB's string ceilings are deliberately larger than the API's Telugu-aware grapheme limits.

Repeat `web:db:migrate` safely: applied matching migrations verify current contracts and return `already applied` without DDL or data writes. The runner checks existing migration history and lock-index metadata before bootstrap writes. The running-lock index can be created only during initial setup with no history; once any history exists, a missing or changed lock index is `INDEX_DRIFT` and is never silently recreated, including on explicit failed retries. A correctly validated empty history collection can finish initial bootstrap after an interruption. `web:db:check` is read-only and checks replica-set topology, checksum/history, validators, index definitions and existing row/unique-key validity. It prints no rows, emails, tokens, URI or raw database errors. Authentication startup checks the applied migration/metadata once per process/connection; requests no longer create indexes or change schemas.

## Failure and recovery

- `MIGRATION_REQUIRED`: run the migration before starting the app.
- `TRANSACTIONS_REQUIRE_REPLICA_SET`: use the configured Atlas replica set or initialize the separate local test replica set below; standalone MongoDB does not satisfy this contract.
- `INVALID_EXISTING_ROWS` / `DUPLICATE_EXISTING_KEYS`: migration stops rather than deleting or guessing a repair. Inspect the named collection privately, identify the provenance and repair deliberately. No rows or duplicate values are printed.
- `MIGRATION_REQUIRES_EXPLICIT_RETRY`: after fixing the underlying failure, rerun `npm.cmd run web:db:migrate -- --retry-failed`. Retry keeps the original checksum and increases the ownership epoch. Already-created collections/indexes are safe to revisit; DDL is not one atomic transaction. If this failed upgrade already installed its exact new validator, explicit retry accepts that validator while still requiring the baseline indexes; unrelated validator/index drift is rejected. New rows valid under that partially installed validator are preserved.
- `MIGRATION_OWNED`: another runner is active, or a crashed process left a running record. Do not auto-expire or steal the lock. Confirm the original process is stopped, inspect its exact owner/epoch/history privately, then perform a controlled, owner-and-epoch-guarded administrative repair to mark it failed before an explicit retry. No automated force-unlock command is provided.
- `MIGRATION_CHECKSUM_MISMATCH`, `INDEX_DRIFT` or `VALIDATOR_DRIFT`: stop and investigate. An applied migration is never silently rewritten, and indexes are never dropped to hide a mismatch. Keep migration 001's manifest/schema definition immutable; introduce a new version for future contract changes.
- Generic `DATABASE_OPERATION_FAILED`: check credentials, TLS, Atlas IP access, connection limits and DDL privileges without sharing secrets. Schema/index administration should use an appropriately scoped operator identity; the runtime only checks readiness and performs application operations.

## Real local integration tests

Unit tests remain `npm.cmd run web:test`. Real database tests are explicit and **never load `.env.local` or use the application `MONGODB_URI`**. They create randomly named `videocraft_f03_test_<32 hex characters>` and `videocraft_f04_test_<32 hex characters>` databases on the loopback replica set and drop only those exact databases in cleanup. Interrupted test runs may leave disposable databases with those prefixes; inspect before manual cleanup.

This workspace already has MongoDB Community Server 8.0 installed. In a separate terminal from the repository root:

```powershell
New-Item -ItemType Directory -Force -Path .cache/mongo-f03 | Out-Null
& 'C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe' --dbpath .cache/mongo-f03 --bind_ip 127.0.0.1 --port 27028 --replSet vcF03 --oplogSize 128 --logpath .cache/mongo-f03/mongod.log --logappend
```

Adjust the executable path if your MongoDB installation differs. Keep it bound to loopback; this disposable test service does not enable authentication. Then, in another terminal:

```powershell
npm.cmd run web:db:test:init
npm.cmd run web:db:test
```

The initializer targets only `127.0.0.1:27028`, checks for the expected uninitialized/existing `vcF03` member and waits for primary election. The test URI defaults to `mongodb://127.0.0.1:27028/?replicaSet=vcF03`. An optional `MONGODB_TEST_URI` can select another loopback port but must have no credentials/database path. Stop the owned `mongod` terminal with Ctrl+C when finished. Test data/logs under `.cache` stay out of Git.

Tests exercise actual validator errors, unique indexes/TTL metadata, idempotent migrations, failed-row audit/explicit retry, competing migration owners, drift/checksum refusal, BSON Long round-trips, atomic commits/rollback and concurrent revision updates. They do not simulate full video jobs or Instagram side effects.

## Transaction helper

`apps/web/src/server/db/transactions.ts` provides `databaseTransaction(client, databaseName, callback)`. It uses primary reads, snapshot read concern, majority writes, a 15-second driver retry/operation budget and a five-second commit limit (the driver may use the remaining overall timeout when client-side timeout is active). Sessions always end in `finally`.

Prepare UUIDs, command hashes and immutable inputs before the callback. Pass its session to **every** MongoDB operation and await operations serially. The driver may retry the callback. Never call Gemini/ElevenLabs/R2/Meta, write external files, send a response, or generate a fresh command identity inside it. Domain commands must resolve an ambiguous commit by their persistent identity before repeating a side effect. This helper supplies transaction mechanics; future feature services supply their scoped guards, idempotency and transitions.

Primary references: [MongoDB transaction APIs](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/), [BSON JSON Schema](https://www.mongodb.com/docs/manual/reference/operator/query/jsonschema/), and [collMod](https://www.mongodb.com/docs/manual/reference/command/collmod/). Product field contracts remain in `DATABASE_DESIGN.md` and `API_DESIGN.md`.
