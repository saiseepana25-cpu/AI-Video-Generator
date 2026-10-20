# VideoCraft — Project Status

Last updated: 20 October 2026.

This is the source of truth for **development progress**: what exists, what was verified, limitations, and the next feature. Requirements remain in [PRD.md](PRD.md); technical contracts remain in [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md), [API_DESIGN.md](API_DESIGN.md), and [DATABASE_DESIGN.md](DATABASE_DESIGN.md). If implementation differs, record the decision here and update the affected contract before extending it.

## Current focus

**F02 — Individual Google sign-in and shared workspace access: complete for the revised V1 scope.** Google login, MongoDB-backed user/workspace/session creation, authenticated `/api/v1/me`, persistence across refresh, and sign-out/protected-page denial were exercised successfully on 20 October 2026. The user explicitly deferred second-account sharing and additional live unapproved/disabled/expiry checks beyond V1. Those scenarios remain unverified live; existing access controls and unit coverage remain in place. This scope decision does not claim those checks passed.

**F03 — Application database validators, indexes and transaction foundation: complete.** The explicit foundation migration was tested on an isolated local replica set, applied to the configured development database, checked, and rerun successfully without schema changes. Strict workspaces/memberships/projects validators, named indexes, migration ownership/checksum checks and bounded transactions are implemented. Sixteen unit tests, twelve real database integration tests, TypeScript checking and the production build passed. The existing signed-in Projects page still opens after restart. Later feature collections receive their own migrations when implemented; no project UI/API is included in F03.

**F04 — Shared projects: complete.** API-04/05/06 and the approved dashboard now create, list, search and reopen real shared drafts, with signed keyset pagination, strict bounded inputs, same-origin request protection and transactional replay/activity. Twenty-three unit tests, twenty-two real database tests, TypeScript and the final production build passed. Two browser-created English/Telugu test drafts remain available for review. Migration 002 was applied/checked/rerun safely; migration 001's checksum is preserved. Voice/accent can be null in drafts; no AI generation is enabled by saving a project.

Next: **F06 — Provider capability/usage catalog and free-experiment gates**. Verify available compatible voices and provider allowances before enabling voice/accent choices or accepting AI work. Rename/duplicate/delete remain F14.

**F05 — complete for current draft-editing scope.** API-07 brief/settings replacement, expected-revision CAS and transactional replay/activity are implemented. The editor provides roughly two-second serialized autosave, retained later keystrokes, explicit conflict comparison/review/save, retry/copy and scoped tab recovery. The create composer also recovers local drafts/pending requests. Migration 003 was applied/checked/rerun; 001/002 manifests remain unchanged. All 27 unit and 29 real DB tests, TypeScript and the final production build passed. Live browser checks covered English/Telugu editing, reload persistence, two-tab conflict/review, pending-save recovery after connection interruption, composer recovery and responsive overflow/controls. Voice/accent remain separate unavailable controls until F06. No planning, rendering, rename or publishing is included. Detailed evidence and remaining limits follow below.

**Review fix: migration-lock drift — complete.** Recorded migration history now requires the existing exact running-lock index before any bootstrap writes. Missing/changed lock metadata is refused with INDEX_DRIFT; only empty initial setup can create the index. Real command monitoring verified zero DDL/data writes on already-applied reruns and drift failures. All 23 unit tests, 25 real DB tests and TypeScript checks passed. No product feature, manifest/checksum change or configured development schema change is included.

## Working agreement

- Deliver one small feature at a time. Only the current feature is authorized by this milestone; this list is a sequence, not a claim that everything is implemented.
- Before coding, record scope and acceptance criteria. Before calling it complete, link the code and record checks actually run, outcomes, and remaining limits.
- Update this document in the same change whenever code behavior changes. Reopen a completed feature if a regression is discovered.
- Use `Planned`, `In progress`, `Blocked`, or `Complete`. Partial implementation stays in progress. Record blockers with the specific missing input.
- Mockups, stubs, configured environment variables, and provider metadata are not evidence of working integrations.
- Keep credentials, account tokens, raw provider responses, and personal data out of this document and browser bundles.
- Initial experiments remain zero spend. No paid voice fallback or silent provider upgrade.
- GitHub checkpoint rule: after each completed milestone or reviewable development step, update this ledger, inspect the diff for secrets/private/generated files, run appropriate checks, commit and push to `dev` at [AI-Video-Generator](https://github.com/saiseepana25-cpu/AI-Video-Generator). Routine milestone commits/pushes are authorized. Do not force-push or merge to another branch without a separate instruction. If publishing is blocked, keep the checkpoint marked pending and remind the user at handoff.

## GitHub checkpoints

Repository: [saiseepana25-cpu/AI-Video-Generator](https://github.com/saiseepana25-cpu/AI-Video-Generator). Development branch: `dev` (explicit user choice).

| Checkpoint | Scope | Publication status |
|---|---|---|
| Initial baseline + F01 | Existing video prototype, approved requirements/contracts/design references, Next.js scaffold, status ledger and milestone push instructions | Published to `origin/dev` on 20 October 2026: [`05b4395`](https://github.com/saiseepana25-cpu/AI-Video-Generator/commit/05b4395879a1e235ac58feb9520ba06c4e1bef1a). Push succeeded and remote `refs/heads/dev` matched the full local commit hash |
| F02a — authentication foundation | Server authorization, Google/MongoDB adapter wiring, sign-in states, setup guide, access-policy tests | Published to `origin/dev`: [`80346bd`](https://github.com/saiseepana25-cpu/AI-Video-Generator/commit/80346bd8b3f9ffbfeaa0db73c7025c1ee56ba693), 20 October 2026; remote hash verified. F02 live OAuth/database acceptance remains pending |

The initial commit establishes the previously uncommitted project baseline. Its commit hash is recorded by Git rather than embedded in its own content. Future checkpoint rows identify the feature and verification; final handoffs report the actual pushed commit. A successful push and read-back of the remote ref are required to call a checkpoint published.

Public-source preparation: reviewed all 57 initial staged files (about 817 KB), checked for credential patterns and exact matches against configured local secrets without printing their values, and found no matches. `.env.local`, other configured environment variants, caches, dependencies, generated media and Next.js build output are excluded. Only the key-free `.env.example` is included. Staged whitespace checks passed. This checkpoint adds repository/workflow documentation and ignore rules; application behavior and the F01 verification results below are unchanged. `dev` now tracks `origin/dev`; future milestone commits continue there.

## Feature roadmap

| ID | Small feature | Status | Completion evidence required |
|---|---|---|---|
| F01 | Next.js scaffold, Midnight Frame tokens, responsive shell and route placeholders | Complete | Production build and both typechecks passed; desktop/mobile/keyboard/HTTP checks passed; 15 prototype tests passed. Details below |
| F02 | Google sign-in, operator allowlist, one shared workspace, sign-out | Complete | Primary live flow and 14 unit tests passed; user deferred additional multi-account/denied/disabled/expiry live checks beyond V1; no public signup |
| F03 | MongoDB connection, schema validation, index/bootstrap tooling and transaction foundation | Complete | 12 real local replica-set tests, 16 unit tests, TypeScript/build passed; configured development database migrated, checked and safely rerun; details below |
| F04 | Shared projects: create/list/detail, cursor pagination and real empty/search states | Complete | 23 unit + 22 real DB tests; final TypeScript/build; live browser English/Telugu create/reopen/search and authenticated API pagination; details below |
| F05 | Saved brief: language/duration, autosave and conflict recovery; voice/accent gated on F06 | Complete | 27 unit + 29 real DB tests; production build/TypeScript; live conflict/reload/network recovery and responsive checks; details below |
| F06 | Provider capability/usage catalog and free-experiment gates | Planned | Actual compatible voice availability; unavailable provider/usage messages; no key exposure |
| F07 | Optional brainstorming and persisted AI planning jobs | Planned | Real structured provider output validated and saved; failure/retry/cancel behavior |
| F08 | Combined plan review, direct edits and immutable plan versions | Planned | New snapshots on edit; latest proposal rules; Telugu rendering; no separate script wizard |
| F09 | Exact-input approval and generation queue | Planned | Revision/hash checks, repeat approval deduplication, leased jobs and best-effort cancellation |
| F10 | Integrate existing speech, synchronization and Remotion renderer | Planned | Real English and Telugu videos; measured narration/subtitle timing; recoverable stages |
| F11 | R2 media persistence and authorized playback/MP4/SRT download | Planned | Scoped access, URL expiry/remint, validated media and no public bucket listing |
| F12 | Targeted revisions, speech reuse and version history | Planned | Failed revision preserves prior ready video; immutable history and reuse evidence |
| F13 | Shared brand kit, validated logo uploads and defaults/personal preferences | Planned | Canonical immutable upload, allowed fonts/colors, inheritance, future-plan-only changes |
| F14 | Rename, duplicate and safe project deletion | Planned | No copied approvals/schedules; tombstone/cleanup guards; in-flight job handling |
| F15 | Activity drawer and sanitized operational/recovery states | Planned | Real events/read position, useful errors, loading/offline/stale-session behavior |
| F16 | Instagram OAuth connection, reconnect/disconnect and credential lifecycle | Planned | Official eligible test account flow, scoped encrypted tokens, account replacement safety |
| F17 | Approved publish-now with immutable payload and outcome reconciliation | Planned | Exact video/account approval, rights gates, duplicate protection, uncertain outcome never resent blindly |
| F18 | Scheduling, calendar, cancellation and explicit resume | Planned | Zone/UTC validation, dispatch windows, account/version binding, race and missed-post tests |
| F19 | Approved product homepage and real studio entry | Planned | Stitch desktop/mobile fidelity, accessible motion controls, real auth navigation |
| F20 | V1 acceptance and deployment readiness | Planned | Full user flow, access/concurrency/recovery/mobile/media checks; explicit deployment configuration |

Dependencies: F02 introduces the minimal MongoDB/Auth.js adapter wiring needed for sessions; F03 completes application validators, indexes and transaction infrastructure before project CRUD. F07/F09 initially share the job infrastructure; render work remains outside web requests. F11 requires R2 configuration. F16–18 require Meta setup and publication-permitted media. Credentials alone do not satisfy these gates.

## Baseline already present before F01

| Deliverable | Evidence | Limits |
|---|---|---|
| Approved PRD, system/API/database contracts | Root Markdown documents linked above | Designs/specifications, not implemented services |
| Approved C / Midnight Frame brand and application designs | [BRAND_GUIDELINES.md](BRAND_GUIDELINES.md), [UI_REVIEW.md](UI_REVIEW.md), current numbered Stitch links | User approved the designs before implementation; state boards are not extra routes |
| Local video pipeline and experiment studio | [scripts/local-server.ts](scripts/local-server.ts), [scripts/cli.ts](scripts/cli.ts), [src/pipeline](src/pipeline), [src/video](src/video), [README.md](README.md) | Filesystem experiment harness; no shared accounts/MongoDB/R2/Instagram integration |
| Reviewed real Telugu test video | `output/elevenlabs-water-cycle/water-cycle.te-te.mp4` (ignored local output) | Earlier run: 31.701s, 1080×1920/30fps, H.264/AAC, Alice evaluation voice. Not native Telugu quality verification or publication rights. Not rerendered for scaffold |

## F01 scope and acceptance

- Separate Next.js/TypeScript application under `apps/web`, preserving the root React 18/Remotion prototype and its commands. Dashboard uses its own package and lockfile so React versions do not conflict.
- Canonical brand colors, locally served Sora/Inter/Noto Sans Telugu, reusable button/panel/page-heading/icon patterns, visible keyboard focus and reduced-motion styling.
- Responsive Projects / Calendar / Settings shell, active navigation, skip link, honest local-development identity and unavailable-feature messaging. No pretend Google login, project records, generation progress or Instagram connection.
- `/` temporarily redirects to `/projects`; F19 will replace it with the approved public homepage. Shell routes are local scaffold previews and are not authenticated yet. Bind the local server to `127.0.0.1`.
- Build and both TypeScript checks must pass. Run existing prototype tests and inspect the rendered shell in desktop/mobile sizes before marking complete.

## UI / contract reconciliation decisions

### F02 scope and acceptance

- Auth.js Google provider and MongoDB adapter, database sessions with seven-day absolute expiry, minimum OpenID/email/profile scopes. Exact normalized allowlist and Google verified-email claim required before account/session creation.
- Stable adapter user ID, one configured UUID workspace, atomic insert-only membership enrollment. Disabled members remain disabled on later sign-in. Every protected page/API checks current session, allowlist and active membership; revoked members lose new access and their sessions are deleted.
- Sign-in, denied/error/setup states follow UI-01/UI-02 and Midnight Frame. No public signup/password/token-entry screens. Sign-out uses an Auth.js-protected POST.
- Minimal auth-related indexes and workspace/membership documents follow DATABASE_DESIGN.md. Full application migration/schema infrastructure stays in F03.
- Implement API-01 response/error envelope without leaking configuration, allowlist, OAuth/session tokens, or database rows. No fake identity or bypass account.
- Verify access decisions, expired sessions, disabled membership, redirect validation, error sanitization and direct unauthorized HTTP access. Mark complete only after real configured Google sign-in, MongoDB session persistence and sign-out are verified. Tests with doubles do not satisfy live integration acceptance.

The approved UI is being implemented against the existing contracts. No API operations or database fields are changed in F01.

| Decision | Implementation rule |
|---|---|
| Application location | System design §5.2 is a proposed layout. Use `apps/web/src` for the Next.js modules while keeping the existing pipeline at root `src`; separate dependency trees now, explicit worker adapter later. No copying provider secrets into the web app |
| Navigation | Projects, Calendar, Settings; activity is a later drawer. UI states within a project are not separate wizard routes |
| Authentication | Shell is visibly a local scaffold until F02. No fake user/avatar or client-only security claims; no private data in F01 |
| Empty projects | A scaffold illustration is not a database query result. Explicitly label the library as not connected; creation remains unavailable |
| Language | One English/Telugu selection drives narration and subtitles. Keep accent/voice distinct when implemented |
| Illustrative UI data | No mock counts, invented progress/ETA, renderer nodes, native-accent claims or cleanup/duplicate guarantees |
| Server authority | Later controls follow `allowedActions`, revisions, immutable approval and publishing state contracts |

## Verification log

### F01 — 20 October 2026

| Check | Result and limits |
|---|---|
| Dependency installation | Next.js 16.4.2, React/React DOM 19.3.1; Fontsource Sora/Inter/Noto Sans Telugu 5.3.0. Independent `apps/web/package-lock.json`. Installer reported zero known vulnerabilities at installation; this is not a security audit |
| `npm run web:typecheck` | Passed route type generation and strict TypeScript checking |
| `npm run web:build` | Passed after final code/config changes; prerendered Projects, Calendar, Settings, root redirect, icon and 404. Explicit Turbopack/tracing root resolves the nested-lockfile warning |
| `npm run typecheck` | Existing root prototype TypeScript check passed |
| `npm test` | All 15 existing prototype tests passed. Initial sandbox run passed 14 and blocked the loopback HTTP test; rerun with local network permission passed all 15. These tests do not establish new-app authentication or persistence |
| Local HTTP | `/` → 307 `/projects`; `/projects`, `/calendar`, `/settings` → 200; `/not-a-page` → 404 |
| Desktop browser | Inspected Projects shell at the default approximately 1265×712 browser viewport. Navigation to Calendar and Settings worked; active link exposes `aria-current="page"`. No fake project records or enabled generation action |
| Mobile browser | Inspected Projects at 390×844 and all three routes at 320×740. Found and fixed a small navigation overflow at 320px. Final Projects/Calendar document widths matched the available viewport (305px after scrollbar); navigation targets measured 44px high. Settings wrapped correctly. These are browser viewport checks, not physical-device tests |
| Keyboard | Tab reached the visible Skip to content link; Enter moved focus to `main-content` |
| Language / console | Telugu sample rendered visibly in native script; no warning/error console entries returned during the route checks. This is not a full Telugu shaping or accessibility audit |
| Local isolation | Preview binds `127.0.0.1:3000`. Root prototype commands retain port 4310. Verified `.next`, nested node_modules, build metadata and nested `.env.local` are Git-ignored. No AI provider requests or video rerenders were made for F01 |

**Implemented code:** [application configuration](apps/web/package.json), [Next configuration](apps/web/next.config.ts), [root layout](apps/web/src/app/layout.tsx), [theme/styles](apps/web/src/app/globals.css), [studio shell](apps/web/src/components/studio-shell.tsx), [shared UI](apps/web/src/components/ui.tsx), [icons](apps/web/src/components/icon.tsx), [Projects](apps/web/src/app/(studio)/projects/page.tsx), [Calendar](apps/web/src/app/(studio)/calendar/page.tsx), [Settings](apps/web/src/app/(studio)/settings/page.tsx), route loading/error/404 states. [README.md](README.md) contains install/run/check commands; [AGENTS.md](AGENTS.md) requires future code changes to update this ledger.

**Review locally:** run `npm run web:dev` from the root and open <http://127.0.0.1:3000/projects>. The original experiment studio remains `npm run dev` at port 4310. A running preview is session-dependent, so the command is the reproducible entry point.

**F01 checkpoint limits (authorization superseded by F02 below):** at F01 the three scaffold routes were not authenticated and contained no persisted workspace/project data. Creation, saving, rendering, uploading and publishing remain later features. Calendar/Settings are explanatory placeholders. Error/loading components exist but forced-failure/recovery testing awaits real data flows. Reduced-motion CSS and focus styles are implemented; comprehensive accessibility testing remains in F20 and affected feature acceptance. No deployment performed.

**Next feature F02:** implement Auth.js Google sign-in, verified-email/operator allowlist, minimal MongoDB adapter/database sessions, one shared workspace membership guard, protected routes and sign-out. First inspect local configuration by presence only; request missing Google OAuth/MongoDB settings without printing secrets. Do not use the Gemini API key as Google OAuth credentials. Acceptance must cover denied access and direct protected API requests, not only a successful sign-in screen.

### F02a — authentication foundation, 20 October 2026

**Implemented:**

- [Auth.js configuration](apps/web/src/auth.ts), [restricted adapter](apps/web/src/server/auth/restricted-adapter.ts), [server configuration validation](apps/web/src/server/configuration/auth.ts), [access policy](apps/web/src/server/auth/access-policy.ts), [per-request workspace context](apps/web/src/server/auth/context.ts), [MongoDB auth store/index bootstrap](apps/web/src/server/db/auth-store.ts).
- [Sign-in page](apps/web/src/app/sign-in/page.tsx), [same-origin sign-in/sign-out actions](apps/web/src/app/sign-in/actions.ts), [Auth.js route](apps/web/src/app/api/auth/[...nextauth]/route.ts), [API-01 /me](apps/web/src/app/api/v1/me/route.ts), [private error/success envelopes](apps/web/src/server/http/envelope.ts), and server-guarded studio layout/pages. No client-only login simulation or bypass account.
- [AUTH_SETUP.md](AUTH_SETUP.md), key-free web environment example, locally generated ignored session secret, and `npm run web:auth:check` / optional `--database` read-only ping. Gemini/ElevenLabs keys remain separate.
- Google identity requires verified email, exact subject/provider and exact normalized allowlist. Minimal account rows omit OAuth access/refresh/ID tokens and remote avatars. Membership enrollment uses insert-only defaults and never restores a disabled member. Session reads use a seven-day absolute database deadline; access removal revokes sessions on the next authorized request. No public registration or role-management feature.
- Auth-related indexes are initialized before adapter writes: unique user email, provider/subject, session token and workspace/user membership; session user lookup and expiry TTL; membership status lookup. Adapter ObjectIds map to public hex strings; application workspace/membership IDs remain UUIDs and counters BSON Long. Full application validators/migrations remain F03.

| Verification | Result / limits |
|---|---|
| `npm run web:test` | 14 tests passed: verified Google claims/provider/subject; exact allowlist and removal; malformed/expired sessions; disabled/wrong-workspace membership; safe redirects; denied enrollment before session creation; absolute expiry; omitted provider tokens/avatar; sanitized private API envelopes. Adapter tests use doubles, not a live database |
| `npm run web:typecheck` and root `npm run typecheck` | Passed after auth changes |
| `npm run web:build` | Production build passed with dynamic protected pages, `/sign-in`, Auth.js handlers and `/api/v1/me`. Sandbox initially blocked Turbopack's dependency junction; permitted build succeeded |
| Unauthenticated HTTP checks | `/projects`, `/calendar`, `/settings` → 307 sign-in; `/api/v1/me` → 401 `AUTHENTICATION_REQUIRED` with metadata and `private, no-store`; `/sign-in` → 200 setup state. Checked response content against local secret values without displaying them |
| Browser review | Inspected desktop sign-in and disabled setup state. At requested 390×844 and 320×740 viewports, content widths matched available 375px/305px after scrollbar. No horizontal overflow; visible Telugu footer/sample supported by the existing font setup. Fixed missing spaces when decorative line breaks are hidden on mobile. No live Google consent or authenticated dashboard session was exercised |
| Local setup check | Correctly reports only missing names: Google client ID/secret, team allowlist and MongoDB URI. Session secret was generated directly in the ignored local file. No database ping/writes performed because configuration is incomplete |

**Current external setup state (20 October 2026):** Google OAuth and MongoDB are configured in the ignored `apps/web/.env.local`. The full settings check and live MongoDB ping passed outside sandbox network restrictions. A real approved Google account completed login and reached the shared Projects dashboard. No credential values, allowed email addresses or session tokens are recorded here or committed.

### F02b — live integration verification and fixes, 20 October 2026

- **Passed live:** complete settings check; MongoDB ping; Google account selection/consent and successful OAuth code exchange; authenticated dashboard showing the shared workspace; authenticated `/api/v1/me` returning user/workspace and `preferencesRevision:1`; refresh retaining the session; sign-out returning to sign-in; subsequent `/projects` access blocked. Final verification used the local production build at `127.0.0.1:3000` to avoid OneDrive-triggered development/HMR reloads disrupting the test. The final browser is left signed in for review.
- Fixed auth handler host validation to use the incoming canonical `Host` header instead of Next.js's reconstructed internal URL. Normal provider discovery returned 200; a raw HTTP request with an untrusted Host returned 403.
- Enabled Next.js `skipProxyUrlNormalize` so the configured `127.0.0.1` OAuth callback is preserved during code exchange rather than normalized to `localhost`. Google's observed `redirect_uri_mismatch` was resolved; final callback succeeded.
- Clone Auth.js responses before setting cache headers, preserving redirect status/cookies without mutating immutable redirect headers. Diagnostics now expose allowlisted error categories/provider error codes only, without raw causes or tokens.
- Set MongoDB `promoteLongs:false` to preserve BSON Long counters expected by the API. This resolved a real authenticated `/me` failure; final user/workspace context and revision were read successfully.
- **Checks:** 14 auth tests passed; final production build (including TypeScript) passed. No paid AI generation, deployment, or additional product feature was started. Initial sandbox-only connectivity failure was resolved by rerunning with network permission; the live database connection passed.

**Revised F02 acceptance (user decision, 20 October 2026):** second-account workspace sharing and additional live unapproved/disabled-account denial and expiration checks are deferred beyond V1. These policies have unit coverage, but their full live scenarios remain unverified. Existing authentication and authorization controls remain implemented. F02 is **Complete for the revised V1 scope**; the deferred checks are follow-up work, not a V1 blocker. Next: F03 application validators/index migrations/transaction infrastructure, followed by F04 persisted project create/list/detail. The original pipeline is not yet connected to dashboard generation.

### F03 — database foundation, 20 October 2026

**Implemented:**

- [Shared connection/configuration](apps/web/src/server/db/connection.ts), preserving BSON Long, bounded pools and connection timeouts; dedicated application database required, system database names rejected. Auth.js and future application services share the connection.
- [Owned validators/index contracts](apps/web/src/server/db/schemas.ts) for workspaces/memberships/projects and migration history; strict unknown-field rejection, BSON Date/Long, UUIDs, bounded objects/arrays and supported enums. Adapter documents retain their pinned Auth.js format; existing auth indexes are preserved. API grapheme/byte, catalog, reference and state-transition checks still belong to later domain commands.
- [Explicit migration runner/read-only checks](apps/web/src/server/db/migrations.ts): preflight existing row shapes/unique keys, checksummed immutable foundation manifest, partial unique running lock, owner/epoch-guarded status updates, explicit failed retry and no automatic running-lock takeover. Applied checksum/index/validator drift fails rather than silently repairing. No drop/backfill/destructive repair is performed by the migration.
- [Bounded transaction helper](apps/web/src/server/db/transactions.ts): primary/snapshot/majority, driver retry/operation budget, guaranteed session cleanup. Callbacks must contain serial session-bound MongoDB operations only; external side effects and fresh command IDs belong outside retryable callbacks. Domain idempotency/relationship guards are added with their owning features.
- [CLI](apps/web/scripts/database.ts), isolated [test replica initializer](apps/web/scripts/init-test-database.ts), root/web npm commands, [DATABASE_SETUP.md](DATABASE_SETUP.md), and updated README/auth setup/design handoff. Runtime authentication now requires the applied migration and checks metadata once per process/connection; no request-time DDL.

| Check | Result / limits |
|---|---|
| `npm run web:test` | 16 passed (14 existing auth/policy tests plus database configuration and index-drift unit checks) |
| `npm run web:db:test` | 12 real tests passed on installed MongoDB Community 8.0, isolated loopback replica set `vcF03`. Verified idempotent migrations/data preservation, read-only missing-migration refusal, strict BSON/unknown-field/language rejection, real unique indexes/TTL metadata, commits/rollbacks, concurrent revision updates, invalid/duplicate pre-existing row refusal, explicit retry, competing/running ownership, checksum/index/validator drift. No mocks substitute for these constraints |
| Test isolation | Tests do not load local credentials or use application MONGODB_URI. Randomly named disposable test databases were cleaned after completion. Test server was bound to loopback; its files/logs are ignored in `.cache`. The initializer was also run successfully from the committed npm command |
| Configured development database | `web:db:migrate` applied migration 001; `web:db:check` passed actual checksum, topology, validators, indexes and row/unique-key audit; a second migration run returned already applied. Initial sandbox network failures were resolved with permitted networking, without modifying network allowlists or credentials |
| `npm run web:typecheck` / `npm run web:build` | Passed after implementation; production build includes the auth routes and protected pages. No new dependency installation or provider generation |
| Authentication regression | Restarted production server; existing browser session refreshed to real signed-in Projects/shared workspace. Unauthenticated Projects/Calendar/Settings redirected to sign-in; `/api/v1/me` returned private/no-store 401; Google provider discovery returned 200 with canonical callback; sign-in available and checked response bodies did not contain configured secrets. No new Google consent, second-account/disabled/expiry live checks or authenticated API fetch was performed in F03 |

**Limits/next:** this is backend infrastructure; the dashboard appearance and disabled creation controls remain as before. Only the foundational collections are migrated. Jobs, media, activity/idempotency, publishing and other owned schemas are introduced with their features using new migrations; deletionReceipt remains null until deletion is implemented. Runtime metadata readiness is cached for the process, while explicit `db:check` audits current data/drift. F04 is next: persisted project create/list/detail with scoped access, bounded inputs, cursor pagination and command idempotency. No deployment, spending, video rerender or Instagram operation occurred.

### F04 — shared project library, 20 October 2026

**Implemented:**

- [Project contracts/validation](apps/web/src/server/projects/contracts.ts), [bounded JSON/request validation](apps/web/src/server/projects/validation.ts), [signed cursors](apps/web/src/server/projects/cursor.ts), [scoped service](apps/web/src/server/projects/service.ts), private error handling and server-only runtime binding. APIs: `GET/POST /api/v1/projects`, `GET /api/v1/projects/{projectId}`.
- Canonical server-derived ownership/actors, active workspace membership on service access, literal normalized title search, `(updatedAt desc,_id desc)` keysets with limit+1 and no mandatory count. One-hour cursors bind endpoint/workspace/search/order. Summaries omit brief/reference content; projections omit database/session/email/provider fields.
- Project create + workspace activity sequence + typed event + original response/replay receipt are one bounded MongoDB transaction. IDs/hash/time prepared outside retries. Concurrent matching keys return one project, changed input conflicts, expired receipts are ignored logically before TTL removal, and deleted/inaccessible content cannot be replayed. Same-page network retry reuses the command key and preserves entered content.
- [Migration 002 contracts](apps/web/src/server/db/project-schemas.ts) broaden only draft voice/accent nullability and add typed project-create receipts/activity/indexes. [Ordered runner](apps/web/src/server/db/migrations.ts) preserves immutable 001 manifest/checksum, checks the effective current contract, and verifies the baseline before a pending upgrade. Future command/event variants need new migrations.

Final review also fixed explicit retry after partially applied upgrade DDL: the exact pending validator is recognized without accepting unrelated baseline index/validator drift. A real regression test simulates validator installation before collection creation failure and confirms retry preserves new valid rows and advances ownership epoch. Both database suites passed again after this fix.
- [Idea composer](apps/web/src/components/project-composer.tsx), [real library/cards/search/pagination](apps/web/src/components/project-library.tsx), Projects server page, saved project detail and scoped not-found state. Midnight Frame tokens and existing shell retained; target/language saved, matching subtitle language derived, voice/accent explicitly unselected. First-project/no-result/loading/error/validation states are real. Planning/editing/generation controls remain unavailable.
- Updated API/database/UI reconciliation, README and database setup instructions. No dependency installation, provider call, render, publication or deployment.

| Verification | Result / limits |
|---|---|
| `npm run web:test` | 23 passed: original auth/database checks plus normalization/Telugu-aware grapheme limits, strict unknown-field/reference/settings bounds, literal search, query bounds, cursor integrity/expiry/scope, Origin/Host/If-Match, streamed JSON byte/UTF-8 limits and sanitized errors |
| `npm run web:db:test` | 22 passed (13 foundation regression + 9 project service tests) on isolated local MongoDB 8.0 replica set. Covered English/Telugu persistence, BSON counters, original-snapshot replay, payload conflicts, concurrent duplicate/different commands, event sequences, expired receipts, deleted/foreign denial, shared member access/scoped key identity, 53 tied-sort pagination fixtures, literal regex search and injected event-write rollback |
| `npm run web:typecheck` and final `npm run web:build` | Passed. Final build includes project list/create/detail APIs and dynamic detail pages. Unit suite reran after the final error-header/layout fix; database services were unchanged after the passing real DB run |
| Configured development DB | Applied migration 002 without rewriting 001; checksum/validators/index/row audit passed, repeat setup returned already applied. Post-browser read-only audit also passed with both real draft snapshots |
| Authenticated browser | Real English solar-panel draft (60s) and Telugu water-cycle draft (30s) saved from the composer. Details showed saved idea/options and no selected voice/accent; refresh/reopen and library title search passed. True no-results state checked. Two test drafts intentionally left for user review; no test fixtures were bulk-inserted into the application DB |
| Live authenticated APIs | Browser GET verified project detail, null voice, disabled actions and one-item cursor pages returning distinct records with correct hasMore. Summary omitted brief/workspace content. Unit and local DB tests cover tampering/denial/command replay; no second real Google account test was introduced |
| Private HTTP | Unauthenticated GET/POST list/create and GET detail returned 401, private/no-store and matching response correlation IDs. Mutation origin validation is also unit-tested |
| Responsive/validation | Normal desktop DOM width 1265 had no overflow. Requested 900px/390px/320px widths tested; medium library and mobile Telugu detail inspected. Fixed a 3px search-form overflow at 320px; final library width was 305px including available viewport after scrollbar. Composer/search controls measured 44px. Whitespace-only idea showed server validation, preserved input and set aria-invalid; no extra project created. These are browser checks, not a full accessibility/native-language audit |
| Local proof | Ignored screenshots `.cache/proofs/f04-project-library.png` and `.cache/proofs/f04-telugu-mobile.png`; no personal data or media committed with proof artifacts |

**Limits:** F04 lists support title search, limit, cursor and recent ordering. Generation/publishing/ready filters are explicitly unsupported until those services exist. Detail is currently read-only; no edit/rename/delete/generation buttons pretend to work. Draft null voice/accent are never approved generation input. Unsaved text/command recovery after reloading the composer remains F05; same-page retry is implemented. Activity records are durable, but the activity drawer remains F15. Two-member sharing was verified with isolated DB fixtures, not two live Google identities. No scaling/query-plan guarantee or full browser fault-injection audit is claimed. Next is F05.

## Change log

Review verification, 20 October 2026: fixed P2 “Detect migration-lock drift before recreating its index” in `apps/web/src/server/db/migrations.ts`. Three new real-MongoDB regression cases cover a dropped lock (left absent, history unchanged), weakened uniqueness/wrong partial filter (zero writes), and interrupted initial bootstrap with empty valid history. The existing idempotence test now monitors commands and asserts no writes. First-run concurrency, partial-upgrade recovery and project service regressions also passed. Used only isolated loopback test databases; no application DB migration, UI change, new build, provider call or deployment was performed. Setup documentation now states the strict drift-refusal behavior.

| Date | Feature | Change |
|---|---|---|
| 20 October 2026 | Planning / F01 | User approved incremental feature delivery and this status ledger. Recorded the prior prototype separately from the new application; began scaffold |
| 20 October 2026 | F01 complete | Added separate Next.js shell and local fonts, reusable UI, responsive routes and honest unavailable states; recorded design approval/reconciliation, fixed narrow navigation overflow, passed build/typechecks/15 regression tests and local browser/HTTP checks. Next: F02 |
| 20 October 2026 | GitHub baseline | Created the user-requested `dev` branch, connected the empty public repository, committed/pushed baseline `05b4395` and verified its remote hash. Recorded the authorized commit/push rule in AGENTS.md and this ledger; environment variants remain ignored |
| 20 October 2026 | F02a | Implemented and tested authentication foundation, protected routes/API and beginner setup guide; pushed `80346bd` to `origin/dev` and verified the remote hash. F02 remains in progress pending Google/MongoDB configuration and real session checks; user is reviewing why Google developer setup is needed |
| 20 October 2026 | F02 configuration | Resolved root-versus-web environment file mismatch by copying three Google/team settings into the ignored web environment. Setup check now reports only MongoDB URI missing; live login remains unverified |
| 20 October 2026 | F02b live check | Verified real Google login, MongoDB-backed session/workspace, authenticated context, refresh persistence and sign-out; corrected host/callback normalization, immutable response headers and BSON Long decoding. Broader multi-account/access scenarios remain pending |
| 20 October 2026 | V1 scope decision | User deferred additional multi-account/denied/disabled/expiry live authentication checks beyond V1. F02 closed for the revised scope using existing primary live verification and unit coverage; no access controls removed and no new checks claimed. Next milestone is F03 database foundation. Documentation-only change; no application behavior changed |
| 20 October 2026 | F03 complete | Added explicit schema/index migration, audits/checksum/ownership controls, shared connection and bounded transactions; 16 unit + 12 real local MongoDB tests and build/typecheck passed. Applied/checked/reran the configured development migration; existing signed-in dashboard and unauthenticated HTTP checks passed. Next: F04 persisted projects |
| 20 October 2026 | F04 complete | Connected persisted project create/list/detail and the approved composer/library to MongoDB; added migration 002, typed command replay/activity, validation and signed pagination. Passed 23 unit + 22 DB tests/build/typecheck and live browser/API/mobile checks. Two review drafts remain saved. Next: F05 editing/autosave |
| 20 October 2026 | F04 review fix | Refuse missing/changed migration-lock indexes before bootstrap writes; create lock only for initial empty history. Passed 23 unit + 25 real DB tests and TypeScript; command monitoring verified zero-write reruns/refusals. Next remains F05 |

### F05 — saved brief editing and recovery, 20 October 2026

**Implemented:**

- [PATCH API/service](apps/web/src/server/projects/service.ts) supports whole brief/settings replacements only, with strict bounds, same-origin checks, active workspace membership, expected revision, per-project command replay, no-op receipts and safe stale revision metadata. Edits atomically advance project/brief/guard revisions and commit one activity event, workspace counter and receipt. Retries return the original snapshot before checking current revision; changed commands under the same key are rejected.
- [Migration 003](apps/web/src/server/db/edit-schemas.ts) widens only edit receipt/activity contracts, retaining old create snapshots and all existing indexes. Older migration manifests/checksums are unchanged. Future plan/run pointers cause edit refusal until their owning feature adds invalidation.
- [Editor](apps/web/src/components/project-editor.tsx) and [recovery helpers](apps/web/src/lib/project-draft.ts): serialized approximately two-second autosave, newer-keystroke preservation, validation/network/session retry, explicit saved/local comparison, paused review followed by explicit save, copy/manual-copy fallback, navigation warning and workspace/user/project-scoped sessionStorage recovery. Uncertain requests preserve their exact body/key; pending recovery cannot be silently discarded.
- [Composer](apps/web/src/components/project-composer.tsx) now recovers unsaved ideas and creation attempts in the same tab, freezes fields while a create outcome is uncertain, and retries the original request. Typing never creates a database project automatically. This completes the browser-reload recovery deferred from F04.
- Midnight Frame styling, audience/references editing, language-coupled subtitles, duration options and separate disabled voice/accent controls. Title rename, voice catalog, AI planning and generation remain future features. API/database/UI/setup/README documents reconciled with this boundary.

| Verification | Actual result / limits |
|---|---|
| Unit tests | 27 passed. Added whole-patch/precondition validation, safe conflict envelope, preserving keystrokes after older acknowledgements, and scoped/bounded exact-command recovery. Browser testing caught an unchanged-project dirty-state bug; fixed it and added regression coverage, then reran the unit suite |
| Real database tests | 29 passed on the isolated loopback MongoDB 8.0 replica set: all 25 previous migration/project regressions plus concurrent edit replay, original snapshot after later changes, stale writer rejection, no-op/expired receipts/deleted denial, and injected receipt-failure rollback of project/activity/counter. Test databases cleaned; isolated server stopped |
| TypeScript / production build | Both passed. The final build includes the dirty-state fix. A Windows generated-font lock blocked a rebuild; preserved that generated build in ignored cache and built cleanly without changing source/dependencies to work around it |
| Development database | Migration 003 applied before launching the upgraded build; row/validator/index/checksum audit passed, rerun returned already applied. No credentials changed. An older idle server was discovered and stopped during build verification; no concurrent application writes were observed during migration |
| Browser editing | Existing English solar draft idea/audience/duration saved and survived refresh. Existing Telugu water-cycle draft accepted Telugu edits and retained Telugu subtitle coupling. Empty idea returned validation without losing the draft. The two review drafts remain; no fixture bulk-seeding or provider generation |
| Two-tab conflict | One tab saved revision 4; the older tab retained its text, displayed both versions and stopped autosave. Keep-for-review remained paused. Navigating away, reloading and returning restored review; explicit Save committed revision 5 and survived refresh. This uses one real account in two tabs; no second-account or expired-session live test is claimed |
| Connection / pending recovery | Temporarily stopped the owned local server, edited the Telugu draft and observed unconfirmed-save/retry. Restarted, navigated away/reloaded/reopened, restored the pending command (discard unavailable), retried and verified saved revision 3 across refresh. Real lost-ack-after-commit is covered by service replay tests, not browser network injection |
| Composer recovery | Typed a new unsaved idea, reloaded, restored exact text, then cleared that test-only local idea. No new database project created. Uncertain create and session-expiry UI paths are implemented but not newly exercised live in this milestone |
| Private HTTP | Unauthenticated PATCH returned 401, private/no-store and matching request correlation ID; Origin/Host rules covered by existing tests |
| Responsive | At requested 390/320/900px, available document widths were 375/305/885px with matching scroll widths (no horizontal overflow). Measured enabled editor input/select/button controls were 47/44/44/44px. Desktop and Telugu shaping inspected; not a full accessibility or native-speaker review |
| Proof / running app | Ignored screenshots `.cache/proofs/f05-editor.png`, `f05-conflict.png`, `f05-mobile.png`. Local production app left running at http://127.0.0.1:3000; saved Telugu editor left available for review |

**Limits and next:** sessionStorage is per-tab recovery, not a durable backup; closing the tab/clearing storage can remove unsaved text. No browser live test of session expiry, clipboard denial, storage quota failure or unknown create outcome is claimed. Copy/retry branches are available; frontend acknowledgement/recovery helpers and backend replay are unit/integration tested. F06 is next: actual compatible provider/voice availability and free-usage gates before selecting voices or enabling AI work. This milestone made no provider requests, paid purchases, video renders, Instagram actions or deployment.

Git checkpoint: this milestone is contained in the F05 feature commit. The handoff reports the actual commit and publication outcome after the staged publication scan and remote-ref verification; a local commit alone is not publication evidence.
