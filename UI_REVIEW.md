# VideoCraft — UI review

F11b reconciliation: the project's static artwork panel is replaced by a same-page finished-video panel with real latest-ready polling, loading/empty/error states, native playsInline controls, matching-language transcript, evaluation notice and explicit playback retry retaining seek position. No autoplay, fake ready media or download/publish controls are added. Saved draft settings remain separate from immutable finished-video language/details. Same-origin media access reauthorizes every request; browser playback of a real stored generated video still needs end-to-end acceptance when such output exists. Existing Midnight Frame colors/spacing/responsive grid are reused.

F08b: “Edit plan” extends the existing inline versioned editor with sequence/cycle/comparison selection, 2–5 ordered label inputs, add/remove controls and a live static preview for each existing scene. Blank labels remain recoverable while unfinished, but cannot be saved. Copy includes diagram labels/layout. Legacy text-only drafts and pending F08a commands retain their original body/key; finish/discard them before reopening the expanded editor. The same stale-save, recovery and immutable-version flow applies. Version-history controls, approval and video rendering remain upcoming.

F08a: the same plan preview now shows its version and “Edit narration & headings.” Editing uses inline per-scene fields with a matching-subtitle preview; explicit “Save as new version” preserves the original. Brief editing and new planning are paused while a plan draft is open. Bounded local recovery retains incomplete text and exact pending save commands across reload; unconfirmed saves offer “Check same save,” while definite stale edits retain text for copying/discard/review. No automatic stale merge, diagram editing, history browser or approval is implied. The selected Midnight Frame tokens, same-page flow and existing project navigation remain in use.

F07 reconciliation: UI-05 now offers optional three-angle brainstorming and “Prepare my plan” directly below the saved brief. Selecting an angle saves the resulting brief through the revision/recovery path and validates its saved provenance. Unsaved/recovery/conflict states block new planning. Queued/running/cancelled/paused/failed/superseded states are real job data, with explicit cancel/retry and same-request recovery. A read-only same-page proposal shows narration, exact matching selected-language subtitles and static diagram proposals; it is not an animated video preview. Older plans stay visible with outdated warnings. Plan editing/approval/rendering remain upcoming; no extra wizard was added.

F06 reconciliation: saved-project voice/accent controls now use API-03's real compatible catalog. No automatic voice/accent substitution; language changes clear both selections. Alice is explicitly evaluation delivery, with native Indian-English/Telugu options disabled. Unavailable preferred voices, missing/exhausted/unverified access and recoverable catalog/session failures are shown truthfully. Refresh checks availability without synthesizing audio. Free evaluation output does not grant publication rights. The rest of the approved idea workspace and later-feature planning/generation gates remain unchanged.

F05 implementation reconciliation: UI-05's idea workspace and UI-22's save/conflict states now map to editable brief/audience/references and language/duration, a visible serialized autosave state, scoped tab recovery, copy/retry, and side-by-side conflict comparison. Keeping local changes pauses autosave until explicit confirmation. Voice/accent are separate disabled controls until F06. The original project title is retained until F14 rename. Generation/planning controls remain unavailable; no illustrative provider or render state is presented as working.

Status: design set approved by the user, 20 October 2026. Midnight Frame / C is the selected brand. These are approved Stitch designs, not evidence of implemented routes or verified integrations. Implementation progress is tracked in [PROJECT_STATUS.md](PROJECT_STATUS.md).

Project: [Generate AI Video](https://stitch.withgoogle.com/projects/14828656073434697599).

Design contracts: [PRD](PRD.md), [system design](SYSTEM_DESIGN.md), [API design](API_DESIGN.md), [database design](DATABASE_DESIGN.md), [brand guidelines](BRAND_GUIDELINES.md).

## Review order

1. Team sign-in and access recovery.
2. Shared Projects library, empty state, idea entry and optional brainstorming.
3. Combined script/visual plan review, approval, generation, finished video and revisions.
4. Publish now, schedule, approval/receipts and calendar.
5. Brand/default/voice/personal settings and shared Instagram connection.
6. Activity, project management and generation/publishing/save/connection recovery states.
7. Mobile counterparts for the same workflow.

## Scope rules

- Plan → Generate → Publish stays within the same project workspace; different state mockups are not additional wizard steps or routes.
- One language choice controls matching narration/subtitles. Voice and accent are separate compatible choices.
- Shared workspace and individual Google sign-ins; no public signup, workspace switching, billing, credits, upgrades or member quotas.
- Previous ready videos remain accessible when a revision fails. Ready video, draft, active generation and publishing state are separate.
- Generation and posting each need explicit approval. Publishing approval binds the exact video version, Instagram account and dispatch time.
- Uncertain posting outcomes offer status checking, not blind reposting. Reconnect/resume and missed schedules require explicit review.
- Publishing examples use hypothetical publication-permitted assets; actual free Alice output is evaluation-only and publishing is disabled for it.
- No provider keys, OAuth tokens, database fields or raw logs in product UI. State-board labels and API mappings belong outside product frames.
- The existing product homepage remains separate from the signed-in Projects landing page.

## Screen index

All **30 current designs** are available: 22 desktop screens/state boards and 8 mobile counterparts. Each link opens the selected review version. Earlier source copies remain on the canvas as history; use this index rather than assuming every similarly named board is current.

### Desktop application

| Number | Screen / preview | Surface and review focus | API contract |
|---|---|---|---|
| UI-01 | [UI-01 — Team sign-in](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=d3537407116d44569fda6115b06a8ddd) | Page — Individual Google sign-in; approved-team access | Auth.js, API-01 |
| UI-02 | [UI-02 — Access states](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=7c3597bce4e54fbcb341ba14bb6533cb) | State board — Access denied, expired session, auth failure and scoped 404 | Auth.js; 401/403/404 contracts |
| UI-03 | [UI-03 — Projects (Review)](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=61f1ad47d98749c68a7b74c893432855) | Page — Idea composer and shared project library | API-03–09 |
| UI-04 | [UI-04 — Projects empty](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=e8c282272bf14d118177af5177e94ee1) | Empty state — First project and search with no results | API-04–05 |
| UI-05 | [UI-05 — Project idea & AI angles](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=6c773b48ec0340d4937f2b91846a4cc5) | Project state — Idea conversation, optional AI angles and references | API-06–07, API-10–14 |
| UI-06 | [UI-06 — Combined plan review](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=07311262d65644c5b25cddc822d5a5b2) | Project state — Combined narration/visual plan, changes and generation approval | API-03, API-15–18 |
| UI-07 | [UI-07 — Generation in progress](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=e78285a65f074424afa2231bd1a2a98e) | Project state — Persisted stage progress, queue, cancellation and previous video | API-19–21, API-45 |
| UI-08 | [UI-08 — Finished video review](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=270f8162dde04017833fa146953d0666) | Project state — Player, transcript, video/subtitle downloads, usage limits | API-15, API-22–23 |
| UI-09 | [UI-09 — Revisions and version history](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=fc1bd4a694234b80bca171a73e553e83) | Project overlay/state — Revision request and immutable plan/video history | API-14–22 |
| UI-10 | [UI-10 — Publish now review](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=6834d53b242d47e688dd113b8147ad40) | Publish drawer — Exact video/account/caption/cover review and publish-now approval | API-23, API-31, API-35–37 |
| UI-11 | [UI-11 — Schedule review](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=75545f1fe79f4e5fafa5cfc0549a42ef) | Schedule drawer — Local date/time, timezone and explicit scheduled approval | API-36–38 |
| UI-12 | [UI-12 — Posting receipts (STATE BOARD)](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=b1fb7f7bf4fa43598b3d3af5030f788c) | State board — Scheduled, preparing, confirmed publication and cancellation checking | API-37–42 |
| UI-13 | [UI-13 — Calendar month](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=3e672df9db0e4e7abcde596ac4894f47) | Page — Month calendar, selected-post details and empty state | API-37–39, API-42 |
| UI-14 | [UI-14 — Calendar agenda & post details](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=2d1d9d10993e4d8cbbbbc98aca01c091) | Page/drawer — Agenda, post details and state-dependent actions | API-37–42 |
| UI-15 | [UI-15 — Settings brand kit (Review)](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=a730ae1e6cf049088d25f2b4592b0f6c) | Settings tab — Shared video brand, validated logo, curated fonts and preview | API-24–26, API-29–30 |
| UI-16 | [UI-16 — Settings defaults & personal preferences (Final review)](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=2fb0c869a88146ff9bc13c5603368c3b) | Settings tab/sheet — Shared defaults and personal language/voice/timezone inheritance | API-01–03, API-27–28 |
| UI-17 | [UI-17 — Instagram connection & confirmations (STATE BOARD) (Review)](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=ed76a29bfcb54055977e890faf3d6e2d) | State board — Instagram connect, reconnect, disconnect, replacement and denied flow | API-31–34, API-40 |
| UI-18 | [UI-18 — Activity & system status](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=abd629c695834c9292e200977c011d88) | Drawer/status panel — In-app activity, read position and sanitized operational health | API-43–45 |
| UI-19 | [UI-19 — Project management (STATE BOARD)](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=5f9d71c07e234febb78a9038c449fae1) | State board — Rename, duplicate, deletion confirmation and cleanup outcomes | API-07–09, API-20, API-39 |
| UI-20 | [UI-20 — Generation recovery (STATE BOARD)](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=fbcbebd4594b463bb9e549b76a33e814) | State board — Queue, pause, safe retry, required plan revision and cancellation | API-03, API-14, API-19–21 |
| UI-21 | [UI-21 — Publishing recovery (STATE BOARD)](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=0bd400aec5de431eb7f46ece50f4a965) | State board — Uncertain publishing, reconnect, missed/delayed post, restricted media and cover/time errors | API-31–41, API-45 |
| UI-22 | [UI-22 — Saving, loading & upload states (STATE BOARD)](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=31bcdb7498e243c8907f25ac1c2b1a4b) | State board — Loading, offline, save conflict, session expiry, asset expiry and logo validation | Auth.js; API-07, API-17, API-23–26, API-35 |

### Mobile counterparts

| Number | Screen / preview | Surface and review focus | Desktop correspondence |
|---|---|---|---|
| M-01 | [M-01 — Mobile team sign-in](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=334cfe37ae784695bdf24ade58d605a2) | Mobile page — Team sign-in | UI-01–02 |
| M-02 | [M-02 — Mobile Projects](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=061805911c0d43878a3285b6efd56009) | Mobile page — Idea composer, library and compact navigation | UI-03–05 |
| M-03 | [M-03 — Mobile combined plan review](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=eeee8f369d874f9ea4ecbe1ebfa0c557) | Mobile project state — Combined Telugu plan review and approval | UI-06 |
| M-04 | [M-04 — Mobile generation progress](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=a602cdb7651b441baec81876ea0c9523) | Mobile project state — Progress, queue, cancellation and previous output | UI-07, UI-20 |
| M-05 | [M-05 — Mobile video review](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=29c1b177e2814e1f91b8b36be0f6f9b9) | Mobile project state — Video review, transcript, downloads and revisions | UI-08–09 |
| M-06 | [M-06 — Mobile publish & schedule (Review)](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=ff307f6a25c644339d6bd3a38b041ce0) | Mobile sheet — Publication review and scheduled approval | UI-10–12 |
| M-07 | [M-07 — Mobile calendar agenda (Review)](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=b19a9e5351124400a062c23795296515) | Mobile page/sheet — Agenda and scheduled-post details/recovery actions | UI-13–14, UI-21 |
| M-08 | [M-08 — Mobile settings & connection (Review)](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=8f31adc3e30c4b0e886b44e828652b91) | Mobile state board — Brand, defaults, personal preferences and connection states | UI-15–17 |

Mobile sources are dedicated 390px designs (780px-wide screenshots at 2× capture), rather than shrunken desktop screens. This does not by itself prove production responsiveness, text wrapping or touch/keyboard behavior; test those during implementation.

### Existing brand and homepage

- [Approved Midnight Frame brand](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=aab6bb8b19b444a7898399c6b290659e).
- [Product homepage — desktop](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=8f86a379e42f45a180a0c710da2ca7ef).
- [Product homepage — mobile concept](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=3860407831e84e1187506aace7812b39).

The 30-screen count excludes these existing brand/homepage artifacts and superseded copies. It is a design inventory, not 30 new application routes.

## Handoff

The user approved the numbered screens and state boards. Reconcile any UI-driven request/response or schema changes in both API_DESIGN.md and DATABASE_DESIGN.md before implementing the affected feature. The initial reconciliation decisions and incremental implementation sequence are recorded in PROJECT_STATUS.md.

All 30 current artifacts were checked for a saved HTML source and screenshot. Representative desktop/mobile layouts were inspected; this is not a full interactive or accessibility acceptance test. Calendar times, avatars, accounts, voice choices, progress and operational health are illustrative data, not live provider results. Player mockups are not proof of generated-video playback.

## Before coding: reconciliation checklist

F04 implementation reconciliation: UI-03/04 now show real persisted draft cards, title search, cursor loading, and first-project/no-result states. The idea composer saves a draft with language/target; its action is labelled **Create project** until AI planning exists. UI-05 initially shows saved idea/options in the same project route, with editing/planning unavailable. No illustrative video posters, generation states, counters or fictional voices are treated as real data. Voice/accent remain null until explicit catalog selection. Future filter/management/AI controls are enabled only with their owning services. See PROJECT_STATUS.md for actual browser/DB checks.

- Bind each action to its API contract above and the server's allowed actions. Simple prototype button behavior is not authority to generate, publish, reconnect, retry or delete.
- Personal preference writes accept only language, voice and timezone overrides. No notification digest, email/push preference, density setting or role-management feature is added by the UI.
- Use the live compatible voice catalog and usage policy; Alice is evaluation-only with source accent. Any fictional catalog/account labels or apparent connectivity in older boards are sample data, not supported production inventory.
- Model or caption/voice changes create a newly reviewed plan. Selecting a historical version does not overwrite current data. Discard controls may discard unsaved local edits, not delete immutable committed plan/video history.
- Generation cancellation is best effort until confirmed. A previous ready version remains usable when a new attempt fails; new drafts never alter an approved scheduled payload.
- For publishing, preserve exact approved version/account/time and distinguish captions from subtitles. Use UTC plus original local timezone/offset. Unknown publication outcomes get read-only reconciliation, not a duplicate-send button.
- Connection refresh is server-managed. No manual token refresh, raw scopes/API-version badges, Google-based Instagram authorization, Facebook-Page requirement or role-based administrator workflow is introduced.
- No aggregate filter counts are assumed unless the API provides them. Use cursor Load more, preserve filters and reload on stale cursor/session state.
- Curated video brand fonts/colors/logo are separate from fixed app chrome. Upload validation must finish before an image becomes selectable; old brand/media remain usable on validation failure.
- Normalize all studio links to the product origin and existing auth flow. Do not follow external production OAuth, publish or deletion actions while reviewing design-only previews.
- Confirm all essential microcopy, accurate Telugu shaping, true 9:16 media proportions, date/weekday/timezone rendering, contrast, focus, reduced motion, 44px targets and responsive behavior across real viewport sizes. Review mobile bottom-sheet scrolling, sticky action bars and keyboard overlap before coding acceptance.
- Use the PRD/API/DB as the authority for incidental generated labels (such as ready versus published, voice availability, deletion effects and scheduling delays). Fix a conflicting mockup rather than silently expanding the backend contract.

No frontend application pages, database migrations, deployments or live provider integrations were implemented in this design pass.
F11c: the same finished-video panel adds explicit MP4 and matching-language SRT download buttons beside its evaluation notice. Preparing state prevents duplicate clicks, failures stay inline with explicit retry, and wrapping controls preserve the Midnight Frame layout. No publication action or translated-caption option is added. Ready-state browser downloads on actual generated media remain acceptance work; fixture access/checksum tests do not establish that live flow.
