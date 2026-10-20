# VideoCraft — Project Status

Last updated: 20 October 2026.

This is the source of truth for **development progress**: what exists, what was verified, limitations, and the next feature. Requirements remain in [PRD.md](PRD.md); technical contracts remain in [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md), [API_DESIGN.md](API_DESIGN.md), and [DATABASE_DESIGN.md](DATABASE_DESIGN.md). If implementation differs, record the decision here and update the affected contract before extending it.

## Current focus

**F01 — Application scaffold: complete.** The local Next.js shell is implemented and verified using the approved Midnight Frame theme. No provider calls, authentication, database, or publishing are part of this feature.

Next: **F02 — Individual Google sign-in and shared workspace access**.

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

The initial commit establishes the previously uncommitted project baseline. Its commit hash is recorded by Git rather than embedded in its own content. Future checkpoint rows identify the feature and verification; final handoffs report the actual pushed commit. A successful push and read-back of the remote ref are required to call a checkpoint published.

Public-source preparation: reviewed all 57 initial staged files (about 817 KB), checked for credential patterns and exact matches against configured local secrets without printing their values, and found no matches. `.env.local`, other configured environment variants, caches, dependencies, generated media and Next.js build output are excluded. Only the key-free `.env.example` is included. Staged whitespace checks passed. This checkpoint adds repository/workflow documentation and ignore rules; application behavior and the F01 verification results below are unchanged. `dev` now tracks `origin/dev`; future milestone commits continue there.

## Feature roadmap

| ID | Small feature | Status | Completion evidence required |
|---|---|---|---|
| F01 | Next.js scaffold, Midnight Frame tokens, responsive shell and route placeholders | Complete | Production build and both typechecks passed; desktop/mobile/keyboard/HTTP checks passed; 15 prototype tests passed. Details below |
| F02 | Google sign-in, operator allowlist, one shared workspace, sign-out | Planned | Allowed/denied users, session expiry, protected routes and API authorization; no public signup |
| F03 | MongoDB connection, schema validation, index/bootstrap tooling and transaction foundation | Planned | Idempotent setup; schema/index checks against a test replica set; no network inside transactions |
| F04 | Shared projects: create/list/detail, cursor pagination and real empty/search states | Planned | Team visibility, bounded validation, idempotency, authorization and cursor tests |
| F05 | Saved brief: language/duration/voice/accent choices, autosave and conflict recovery | Planned | Same-language narration/subtitles; stale revision rejection; unsaved edit recovery |
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

**Remaining limits:** the three scaffold routes are not authenticated, contain no persisted workspace/project data, and cannot create, save, render, upload or publish. Calendar/Settings are explanatory placeholders. Error/loading components exist but forced-failure/recovery testing awaits real data flows. Reduced-motion CSS and focus styles are implemented; comprehensive accessibility testing remains in F20 and affected feature acceptance. No deployment performed.

**Next feature F02:** implement Auth.js Google sign-in, verified-email/operator allowlist, minimal MongoDB adapter/database sessions, one shared workspace membership guard, protected routes and sign-out. First inspect local configuration by presence only; request missing Google OAuth/MongoDB settings without printing secrets. Do not use the Gemini API key as Google OAuth credentials. Acceptance must cover denied access and direct protected API requests, not only a successful sign-in screen.

## Change log

| Date | Feature | Change |
|---|---|---|
| 20 October 2026 | Planning / F01 | User approved incremental feature delivery and this status ledger. Recorded the prior prototype separately from the new application; began scaffold |
| 20 October 2026 | F01 complete | Added separate Next.js shell and local fonts, reusable UI, responsive routes and honest unavailable states; recorded design approval/reconciliation, fixed narrow navigation overflow, passed build/typechecks/15 regression tests and local browser/HTTP checks. Next: F02 |
| 20 October 2026 | GitHub baseline | Created the user-requested `dev` branch, connected the empty public repository, committed/pushed baseline `05b4395` and verified its remote hash. Recorded the authorized commit/push rule in AGENTS.md and this ledger; environment variants remain ignored |
