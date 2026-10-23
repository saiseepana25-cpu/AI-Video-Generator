# VideoCraft — V1 API Design

## F13a deployed slice — shared workspace defaults (22 October 2026)

API-27 GET `/api/v1/workspace/settings` and API-28 PATCH are implemented for active team members. Responses use the standard private/no-store data/meta envelope, Vary Cookie, nosniff and request ID. GET data is `{revision,timezone,defaults:{language,targetSeconds,preferredVoiceCatalogId,preferredAccentId,themeId,captionStyleId},brandKitRevisionId}`. Legacy bootstrap's unresolved `indian` accent is projected as null when no voice is selected; GET performs no rewrite. New workspaces start with null voice/accent. Defaults expose safe catalog IDs only, never provider credentials, raw voice IDs or allowlists.

PATCH requires same-origin mutation checks, UUID Idempotency-Key and `{expectedRevision,patch}`. Patch accepts timezone and/or a complete defaults replacement. Language en|te; duration 30|60|90; current educational theme/readable caption style; voice/accent both null or supported selections. A supplied nonnull pair must pass the existing current free-evaluation catalog checks for the selected language before commit; unavailable/disabled/paid/unverified selection is 503 VOICE_UNAVAILABLE with no settings write. The UI treats that explicit pre-write refusal as correctable. IANA timezone values are bounded and validated by the installed Intl runtime. Missing revision 428; invalid values 422; unknown fields/query/If-Match 400; stale revision, key/payload mismatch or exhausted revision 409; missing workspace 404; inactive member 403; no session 401. Effective no-op is 422 NO_CHANGES. No settings save triggers inference, synthesis or rendering.

One transaction fences active membership, compares workspace.settingsRevision, changes only supplied fields, advances the shared settings revision/activity sequence and actor/time, appends one workspace-level event and inserts a durable settings-command snapshot. Same-command replay precedes stale/provider checks and returns its original successful snapshot with Idempotency-Replayed:true, even after later settings saves. The client reloads current settings after confirmation. Reused keys with different normalized input are refused. Receipts have no TTL in this slice to preserve unconfirmed save recovery. Unknown transport/5xx outcomes retain the exact command; no automatic retry or stale merge. Reload replaces unsubmitted form edits explicitly.

Inheritance is captured when a new project composer is loaded: member language override precedes workspace language; a matching personal voice/accent pair precedes matching-language workspace voice defaults, while duration remains shared. Changing language clears the captured pair. API-05 still requires a complete explicit SettingsInput; it does not resolve mutable defaults while replaying a create command. Existing/open/recovered drafts, exact pending create bodies, saved projects, approvals, ready videos and scheduled instants remain unchanged. A definitive pre-write VOICE_UNAVAILABLE refusal lets the composer explicitly Clear default voice and save an unresolved draft with a new command; ambiguous failures keep the original command. The API never silently substitutes a voice. Brand/logo customization is implemented in F13b; personal preference writes are implemented in F13c.

## F12c deployed slice — verified local speech reuse (22 October 2026)

No new mutation or approval endpoint. API-18 continues to require explicit approval of the exact saved input and fresh provider/worker/free allowance gates. Admission conservatively reserves all narration units before any reuse decision; no cost saving is promised by revision review. F12b revision-review now returns `speechReuse:"verified_clips_only"` as an execution policy, not per-segment cache availability. It still performs no file/provider call and does not grant approval. Job submissionCount remains actual provider POSTs, not reused segments; reuse receipts are server-internal and expose no file path or source voice ID.

The local worker can reuse a settled original speech attempt from one of the newest 20 successful rendered_local runs in the same workspace/project and current provider configuration. Source input/approval/local-artifact relationships and canonical input hash must match. Exact speech identity includes text/language, actual provider/model/voice/output/settings/adapter/pronunciation policy, catalog/accent, normalization/use-policy and the independent-phrase context contract; diagram/headings/brand layout changes do not invalidate identical speech. Sources are original attempts, not chains of reuse receipts. Missing/corrupt/incompatible clips fall back to ordinary approved synthesis, with existing free-only/uncertain-usage/disablement gates. No uncertain/refused/submitted attempt is a source.

Before a clip is accepted, bounded real-path WAV bytes must match recorded size/hash/sample rate and canonical mono PCM16/24k format, non-silent/non-clipped signal. A post-read transaction fences current owner/epoch/project/cancellation and source evidence, checks current provider policy/config/uncertainty, then inserts a unique target-run/segment reuse receipt with a source retention pin. Revocation/source drift after read refuses the run; it does not silently synthesize in that branch. Reuse never creates a fake settled speech attempt or increments submissionCount. Mixed jobs retain the conservative full settled hold; all-reused jobs release only their own unused reservation. Previously consumed/uncertain holds are unchanged. New timings/captions/render are always rebuilt from measured clips; previous ready output stays intact on failure.

Source audio must remain locally available; this is not an R2 audio cache, cross-project library or resumable speech retry. No automatic resubmission of interrupted speech, public source URL, cleanup endpoint or new publication permission. Restart the generation worker after migration/build to use the adapter; no live generation is authorized by deployment alone.

## F12b deployed slice — revision change review (22 October 2026)

GET `/api/v1/plans/{planVersionId}/revision-review`, no query/body, returns standard private/no-store data/meta with request ID. Requires an active member, live scoped project, current plan/source/settings/input fingerprint and no active planning/generation pointer. Missing/foreign/deleted is 404; inactive member 403; outdated plan 409 PLAN_OUTDATED; active work 409 REVISION_REVIEW_UNAVAILABLE; query/UUID errors 400. No mutation, idempotency key, provider refresh, font read or R2 operation.

Data: `{projectId,planVersionId,projectRevision,speechReuse:false,requiresNewApproval:true,baseline:null|{videoId,versionNumber,planVersionId},changes:null|{hasChanges,sourceBriefChanged,titleChanged,objectiveChanged,sceneOrderChanged,settingsChanged,scenes}}`. No completed video gives null baseline/changes. Scene entries include `{sceneId,added,removed,narrationChanged,headingChanged,diagramChanged}` and only changed scenes are listed. settingsChanged contains supported selection field names, never raw voice IDs or credentials. hasChanges includes source-brief revision changes. Subtitle changes follow narration; this does not replace full caption/render validation.

Baseline is latestReadyVideoId, not the greatest completion version number. The service checks scoped video->approval/plan/input relationships, validates the immutable approved render contract and verifies its canonical input hash against the ready video. Missing/malformed/mismatched baseline returns retryable 503 REVISION_BASELINE_UNAVAILABLE without changing or regenerating the existing video. Comparison uses the pinned approved input, not mutable files or a later plan. Snapshot reads leave project/approvals/ready videos/reservations untouched.

This is advisory saved-content comparison, not render admission or cache eligibility. New generation continues to synthesize every segment; verified clip reuse remains F12c. Current direct edits already produce immutable plan versions after terminal runs clear the active pointer. Current-plan validation and explicit exact-input approval are still required; a comparison is invalidated in the UI by plan/revision/eligibility changes. Earlier ready output remains independently available through F11/F12a.

## F12a deployed slice — completed-video history (22 October 2026)

API-15 now also supports GET `/api/v1/projects/{projectId}/versions?kind=video&limit=10&cursor=...`. Default limit 10, range 1–50; duplicate/unknown parameters, missing/unsupported kind, empty cursor and invalid limits return 400. Returns the standard data/meta envelope with `{items:[{id,projectId,versionNumber,planVersionId,language,captionLanguage,durationSeconds,readyAt,usagePolicy:"evaluation_only",isLatest}],page:{hasMore,nextCursor}}`. Descending version-number keysets use a one-hour HMAC cursor bound to workspace/project/kind/limit and AUTH_SECRET. Plan/video cursor domains are distinct. Bad/tampered/expired/cross-scope cursors return 400 INVALID_CURSOR. New completions appear on refresh; older-page traversal excludes newly inserted higher version numbers.

Active membership, live project and scoped rows are read in one snapshot transaction. Missing/foreign/deleted project returns 404; inactive member 403; missing session 401. Responses are private/no-store with request IDs. This metadata read needs no R2 configuration or provider call and exposes no storage descriptors, transcript, raw voice IDs or media URLs. Summaries record completed provenance, not a remote availability probe. Open a selected ID through API-22's existing GET detail; playback/download recheck current access, destination, owned pins and actual bytes. A currently unavailable old file fails safely; history never rerenders it or substitutes another version.

Selection is local viewing state only. It does not restore a plan, change project/latest pointers, approve generation or confer publication permission. The dashboard explicitly returns to latest; polling a selected older version does not jump to new output. Targeted regeneration and verified speech reuse remain later F12 slices. Existing F08c kind=plan behavior is unchanged.

## F11c deployed slice — owned downloads (21 October 2026)

This extends the F11b local proxy contract below. VideoView now has capabilities.download:true and downloadUrls `{mp4:"/api/v1/videos/{id}/downloads/mp4",srt:"/api/v1/videos/{id}/downloads/srt"}`. These are authenticated application paths, not bearer URLs. Publication remains false/evaluation_only.

GET/HEAD `/api/v1/videos/{videoId}/downloads/{kind}` accepts only `mp4` or `srt`, no query/body and no caller-supplied object key or filename. Unsupported roles return 404. Success returns bytes, never a JSON envelope: Content-Disposition `attachment; filename="videocraft-v{versionNumber}-{language}.{kind}"`; MP4 Content-Type video/mp4, SRT application/x-subrip; charset=utf-8. Subtitles are the immutable matching spoken-language file, without translation or regeneration. Cache-Control private,no-store; Vary Cookie; nosniff; same-origin resource policy; X-Request-ID apply. GET supports the same single byte ranges/206/416 as playback; HEAD ignores Range, verifies full bytes and returns 200 headers with no body. Full GET is 200. No idempotency key or DB write is needed.

Session/active membership, live scoped project, stored bundle/current destination and exact owned role pin/key/descriptor are required. Full bounded remote bytes must match the committed role checksum; MP4 additionally matches ready-video.mp4Sha256. Access and asset reference revision are checked again after retrieval. 401/403/404/400/416 follow playback; missing/corrupt bytes or invalid configuration/pins return sanitized retryable 503 VIDEO_UNAVAILABLE. No partial unverified response or provider error is exposed. Each request buffers/verifies the full role before slicing (MP4 <=128 MiB; SRT <=256 KiB); this local-MVP tradeoff needs hosted-load validation. Previously downloaded bytes cannot be revoked. Browser buttons fetch verified blobs, report errors inline and allow explicit retry; downloads never grant publication permission.

## F11b deployed slice — private playback (21 October 2026)

Local-MVP refinement of API-22/23: playback uses an authenticated same-origin proxy, not a presigned bearer URL. `GET /api/v1/projects/{projectId}/videos/latest` returns `{video:null|VideoView}`; `GET /api/v1/videos/{videoId}` returns VideoView. Existing data/meta envelope/private-no-store headers apply. View fields: id/projectId/versionNumber/planVersionId/generationRunId, language/captionLanguage, narrator, usagePolicy:evaluation_only, media+fps:30, transcript `{segmentId,text,startSeconds,endSeconds}`, readyAt, same-origin playbackUrl, capabilities `{playback:true,download:false,publish:false,publishBlockedReason:MEDIA_USAGE_RESTRICTED}`. No object keys, raw voice IDs, config hashes, credentials or local paths. Dedicated latest-video lookup drives readiness; legacy project/command summary placeholders and terminal generation result:null remain unchanged. Draft, job and ready video are distinct.

`GET /api/v1/videos/{videoId}/playback` returns verified MP4 bytes, inline disposition, Accept-Ranges:bytes, nosniff, Cross-Origin-Resource-Policy:same-origin, Vary:Cookie, private/no-store and request ID. Full GET:200; one bounded/open-ended/suffix range:206 + Content-Range. Malformed/multipart/unsatisfiable ranges:416 + `Content-Range:bytes */<size>` before R2 retrieval. HEAD ignores Range and returns full headers/no body. Each request checks session, active member, live scoped project, stored bundle, available owned MP4 and exact key/config/checksum; after bounded remote verification it rechecks membership/project/asset state before returning bytes. Cross-site browser requests are refused. Already-delivered bytes cannot be revoked.

401 unauthenticated; 403 inactive/cross-site; 404 missing/foreign/deleted; 400 malformed UUID/query; 503 VIDEO_UNAVAILABLE for configuration, unavailable pin or missing/corrupt bytes. Metadata reflects stored provenance; a remote outage can still make playback fail. No silent rerender. Each request currently retrieves/verifies the full MP4 (<=128 MiB), including seeks/HEAD, before returning the requested range. This is a local-team tradeoff, not optimized hosted streaming. No access-minting POST, signed expiry/renewal, public bucket or download endpoint is introduced; downloads remain F11c and publication stays disabled.

## F11a deployed slice — private storage checkpoint (21 October 2026)

No new public endpoint, signed URL, browser upload or media-result capability is introduced. Generation stays rendered_local with result:null even after its separate internal bundle is stored. F11b/c will resolve authorized playback/download DTOs and ready-video contracts. Browser clients receive no bucket keys/config hashes/local paths from this increment.

Operator CLI: `web:storage -- worker|status|store <run-id>|retry <run-id>`. Status prints aggregate pending/uploading/failed/stored counts only. Worker discovery requires committed validated-local provenance; storage-only retries preserve exact identity/bytes and never call speech/rendering. Changed destinations cannot silently adopt earlier bundles. Safe failure codes omit SDK bodies/credentials. No HTTP unlock/retry endpoint or publishing right is added. Storage failure preserves the reviewed plan and cannot mark video ready.

## F09b/F10b deployed slice — leased local execution (21 October 2026)

Generation jobs now expose `queued|running|cancellation_requested|cancelled|failed|rendered_local`, real started/finished timestamps and stages `plan_validation|speech|rendering` (progress remains null). Terminal errors are sanitized `{code,message,retryable:false}`. `rendered_local` means the local MP4 was validated and recorded; `result` remains null and there are no media URLs, ready-video/publication capabilities or local filesystem paths. F11 owns authorized media delivery. Project generation status polling refreshes the saved project revision when idle, preserving unsaved draft checks.

API-18 still requires exact reviewed input/revision/hash and fresh compatible capabilities. A real worker advertises `queue:leased-generation-v1` in addition to speech/render/timing/font/build compatibility; old or diagnostic capability sets cannot enable approval. Repeat approval returns the original logical run in any state; terminal results return 200, active results 202. Every actual speech submission additionally verifies fresh free-account/model/premade-voice access, observed coverage of remaining reservations, current configuration/period/language evidence, operator policy, project liveness and worker/run ownership. These checks do not authorize paid fallback.

API-20 accepts the existing `{expectedRevision}` and UUID key. Queued cancellation is confirmed immediately (200); running cancellation returns 202 with `cancellation_requested`, no premature refund and no cleared active pointer. A replay returns the committed original response. The worker confirms cancellation only after stopping future phrases/render finalization. A sent request may consume allowance; an unknown outcome remains paused/uncertain even if the video is cancelled. A concurrent stage change can return 409 STALE_REVISION; refresh status before a new cancel command. Generic API-21 still refuses generation retry: no automatic resubmission of interrupted or failed speech. A new reviewed plan version is required in this slice.

Known access refusals pause speech availability. Lost/5xx/invalid/truncated responses or a missing durable clip acknowledgement are `SPEECH_OUTCOME_UNKNOWN`; the durable attempt/reservation is retained and new speech is blocked pending operator review. Worker/output failures never become a successful ready video. Already-approved team work continues after its initiating member signs out/is disabled; current active members retain scoped status/cancel access.

Expired rendering/validation leases remain active, including cancellation_requested, until executor termination can be verified. They are not reported as failed/cancelled solely because their lease expired, and they block the sole render slot. The current executor has no durable stop-evidence verifier or recovery/unlock endpoint, so these cases remain operationally paused; no API response claims termination from an abort signal or late output file.

## F09a deployed slice — guarded generation admission (21 October 2026)

API-18 is implemented for exact saved plan/revision/hash approval. `POST /api/v1/projects/{projectId}/generations` takes the three fields in API-18, a UUID Idempotency-Key and same-origin request. It returns 202 with the safe generation job described below (200 for an existing cancelled run). `Idempotency-Replayed` reports command replay or logical duplicate. Missing revision is 428; malformed input 422; stale revision/source/hash or active work 409; missing/foreign/deleted project/plan 404; inactive membership 403. Admission returns sanitized 503 `GENERATION_WORKER_UNAVAILABLE` for absent/stale/incompatible/draining workers or `SPEECH_RESERVATION_UNAVAILABLE` for unavailable/disabled/uncertain/insufficient free speech. No paid fallback exists.

The accepted job contains `id,jobId,generationRunId,projectId,planVersionId,kind:"generation",state:"queued"|"cancelled",statusRevision,stage:"plan_validation",progress:null,sourceBriefRevision,projectRevision,createdAt,updatedAt,startedAt:null,finishedAt:null|ISO,result:null,error:null,cancellationConfirmed,allowedActions,statusUrl,pollAfterSeconds:3`. No raw voice ID, credentials, provider config hash or immutable full input is exposed. `GET /api/v1/projects/{projectId}/generations` returns `{job:null|Job}` for the newest run, including cancelled runs; no query/body. Generic `GET /jobs/{jobId}` dispatches to scoped generation or planning lookup. All responses are private/no-store.

API-20 accepts `{expectedRevision}` and an idempotency key for a queued generation. It returns 200 with confirmed cancelled Job and clears only that run's project pointer. It releases an unused reservation; it never refunds consumed/uncertain speech. CAS mismatch is 409; a fresh command for a nonqueued run is 409. Same-command replay returns its original snapshot, while GET shows current status. API-21 returns 409 `GENERATION_RETRY_UNAVAILABLE` for generation jobs in this slice. Duplicate approval for the same version/hash returns its original run even after cancellation or provider/worker changes; a new take requires a newly reviewed version.

`GET /plans/{planVersionId}/render-input` now reports `canGenerate:boolean`; it is true only for a compiled plan with current speech gates and compatible worker capability. This remains advisory: admission rechecks everything transactionally. The dashboard has explicit approval, safe status polling, queued cancellation and tab-scoped original-command recovery with “Check same generation request.” It locks conflicting edits/requests until status is confirmed. There is currently **no generation worker registered** in development. F09a performs no speech, render, R2 write or fake progress; actual worker ownership, leases, in-flight cancellation/recovery and renderer integration remain F09b/F10.

## F08d implementation — resolved video input (21 October 2026)

Narration-formatting review fix: compiled narration and matching captions accept internal LF and tabs already supported by the editor; CRLF/CR normalize to LF, with NFC/trim matching saved edits. Caption comparison preserves this formatting rather than flattening it. Headings/labels remain single-line; markup, other C0 controls, DEL and lone surrogates remain invalid. No scene/timing/approval or provider-policy change.

The staged proposal and the resolved render plan are distinct contracts even though each has schemaVersion:2. The resolved plan additionally requires `contract:"educational-diagrams-v1"` and is built/validated by the pure render-contract module, shared through the root pipeline bridge. It has one selected language, stable narration segment IDs, exact matching caption references, ordered template scenes, deterministic node/event IDs, supplied provenance, structured warning notes and resolved settings. The supported template IDs are `diagram.sequence`, `diagram.cycle`, `diagram.comparison`, version `1`, with bounded heading/nodes props and only phrase_start/reveal_diagram and phrase_end/hold_diagram events at zero offset. No arbitrary props/code/HTML/SVG/media URLs, word anchors or guessed frame timings are accepted. More template families and the actual Remotion v2 adapter remain F10 work; do not pass this object to the prototype's bilingual v1 renderer.

New read-only extension: `GET /api/v1/plans/{id}/render-input`, no query parameters. Active membership and scoped live project are required. Current plan/source-brief/request/settings and the original saved-input fingerprint must match; active planning or generated-project editing is refused. Snapshot-consistent DB reads make no writes, reservations, provider refreshes or inference calls. Current local font bytes are hashed outside the read transaction. Server-internal prepare() returns the exact validated plan plus generationInputHash for F09. The browser receives only a safe check result; raw provider voice IDs/settings, credentials and configuration hashes are omitted.

200 data: `{planVersionId,projectId,versionNumber,projectRevision,status:"compiled"|"needs_changes",generationInputHash:string|null,canGenerate:false,issues:[{code,message}],executionBlocks:[{code,message}],summary:null|{language,captionLanguage,targetSeconds,sceneCount,segmentCount,templates,voice:{catalogId,accentId,model},output,usagePolicy,contract,fonts,timing}}`. Unselected voice/accent yields VOICE_REQUIRED; unsupported free voice/accent or branding/style yields VOICE_UNSUPPORTED/SETTINGS_UNSUPPORTED; malformed content/coverage yields INVALID_RENDER_INPUT. These are correction outcomes, not an approved generation. Missing/foreign/deleted plans return 404; inactive membership 403; noncurrent/source/settings mismatch or active work 409; unavailable local font files return sanitized 503. Private/no-store envelopes apply.

`generationInputHash = SHA256(canonicalJson(validatedResolvedPlan))`: sorted object keys, preserved array order, NFC strings, LF line endings, finite JSON values and explicit policy defaults. It includes narration/captions/diagrams/on-video title, audience/source provenance, exact Alice evaluation provider/model/voice/settings, local font SHA256 pins, default colors/no logo, output profile, templates and compiler/normalization/timing/renderer versions. It excludes credentials/config fingerprints, project display title, row IDs/version numbers/actors/timestamps and volatile allowance observations. It is distinct from legacy saved-input inputHash and staged edit contentHash. No old immutable row/hash is rewritten.

Static compilation can succeed while execution is paused: stale/disabled/unverified voice, uncertain prior usage or insufficient observed net free allowance appear separately in executionBlocks and do not alter the content hash. Current allowance is already net of ProviderStore reservations; it is not subtracted twice. Native accents/publication stay unavailable. F08d always adds GENERATION_NOT_IMPLEMENTED and canGenerate:false. F09 must recompute/revalidate the expected version/revision/hash, then atomically persist the exact approval/input pins and reserve/queue with current gates; this GET is never dispatch authority. F10 must verify asset bytes/renderer support, obtain measured phrase audio, validate sample/frame/caption/layout bounds and refuse unsupported output. No timing/visual-quality acceptance is claimed from a successful check. This section supersedes earlier statements that staged proposals have no compiler; it does not enable generation.

## F08c implementation — plan history and explicit restore (21 October 2026)

API-15 implements `GET /api/v1/projects/{id}/versions?kind=plan&limit=10&cursor=...`. Only kind=plan is supported; video history is future scope. Limit defaults to 10, range 1–50. Duplicate/unknown fields and empty cursors return 400. Response data: `{items:[{id,versionNumber,title,source,parentPlanVersionId,restoredFromPlanVersionId,createdAt,isCurrent,sourceBriefRevision,approvalState:"not_available"}],page:{hasMore,nextCursor}}`. Descending version-number keyset pagination uses an HMAC cursor bound to project, workspace, kind and limit, expiring after one hour. Concurrent new versions appear on refresh; traversal of older versions stays stable. No media links or provider responses are included.

API-16 additionally returns createdAt, currentPlanVersionId, canRestore and restoredFromPlanVersionId. Missing legacy provenance defaults to null. canRestore is advisory: the transaction rechecks eligibility and refuses identical content. Historical previews remain read-only and separate from current-plan edits.

New extension: `POST /api/v1/plans/{sourceVersionId}/restore`, authenticated active workspace membership, canonical same-origin check, UUID Idempotency-Key, bounded JSON and no query/If-Match. Exact body: `{expectedProjectRevision:2,expectedCurrentPlanVersionId:"UUID"}`. Both are captured when the historical version is reviewed, not silently refreshed at click time. Returns 201 with the new PlanVersion projection/changeSummary and committed projectRevision; Idempotency-Replayed:true on replay. The old version is copied into a new immutable proposal, retaining its narration/captions/diagrams/settings/model/input provenance. parentPlanVersionId references the previous current version; restoredFromPlanVersionId references the selected historical version. No AI call or approval occurs.

404 hides missing/foreign/deleted sources; 403 denies inactive membership; 422 rejects malformed input/unchanged content; 409 rejects stale revision/current plan/brief/request, active work, generated-project editing, differing source brief/settings, exhausted counters and key/payload mismatch. Private no-store envelopes apply. Receipt replay precedes freshness guards but rechecks live-project access: original result ID/revision stay stable; eligibility reflects current state. Browser persists the exact command before sending, locks competing actions while outcome is unknown, and offers explicit same-command replay after reload. No automatic retry. Full render-contract compilation and F09 approval remain later work. This section supersedes earlier statements that history controls are unimplemented.

F08b extension (21 October 2026): API-17 additionally accepts `edits.diagrams:[{sceneId,labels,layout}]`, a complete diagram replacement for 1–8 existing scene IDs. Each diagram has 2–5 ordered plain-text labels (1–100 UTF-16 units, normalized NFC/trim) and layout exactly `sequence|cycle|comparison`. Unknown fields, IDs, duplicate replacements, markup/control characters, unsupported layouts and wrong-language labels are refused with 422. Telugu labels require Telugu text when alphabetic; numeric-only labels are allowed. No scenes, code, arbitrary SVG, media or settings can be added. Diagram edits may combine with narration/headings in one version save. Diagram-only edits preserve narration/captions and use the same revision/current-plan/active-job/replay/parent/hash safeguards; no provider call or approval is involved. Existing saved receipts and F08a request normalization remain compatible. The UI's Edit plan form provides live static diagram previews and bounded add/remove label controls. Full renderer/template compilation and history controls remain later increments; a changed diagram proposal is not a rendered animation or a scientific-accuracy guarantee.

F08a implementation (21 October 2026): API-17 `POST /plans/{id}/edits` now accepts `{expectedProjectRevision,edits:{narration?:[{segmentId,text}],headings?:[{sceneId,text}]}}` for the current staged proposal. Existing scene IDs only; headings ≤140 UTF-16 units, narration ≤1,000, plain normalized selected-language text. Unknown fields, duplicate/missing IDs, structural/settings/diagram changes and no-op commands are refused. Other API-17 fields remain future scope. Auth/membership, canonical mutation origin, UUID idempotency, bounded JSON and no-query/If-Match rules match other mutations. A save creates a new immutable version and exact narration-derived captions, preserving diagram/layout IDs, language/settings and review warnings. Current pointer, parent provenance, project revision/version counter, command receipt and activity commit atomically. Expected project revision/current plan/source brief/request ID guard against stale overwrites; active planning/render work blocks editing. No provider calls or approval occur.

201 returns the new PlanVersion projection plus committed `projectRevision` and `changeSummary`; replay header identifies a replay. Receipts retain original result identity/revision without TTL in this slice; eligibility fields are recomputed against current state, so a later replay can report `isCurrent:false`. Replays precede stale/capacity checks and still require current access to the live project. GET plan/overview adds `projectRevision`, `versionNumber`, `canEdit`, `source`, `parentPlanVersionId`, `contentHash`. Historical AI rows default to source `ai`, null parent/contentHash. Direct edits retain the original saved-input `inputHash` and model provenance; `contentHash` hashes the edited staged plan/settings, and `source:direct_edit` distinguishes human edits. Neither hash is a resolved generation approval hash. For direct edits the new version UUID also serves as the unique proposal request identity (no AI job is invented); original planning provenance follows the parent chain. Diagram editing, history UI and full approval/render-contract compilation remain later increments. F08 overall is not complete.

## F07 implementation reconciliation — 20 October 2026

The saved-brief planning slice implements API-12/13, API-16 (read-only proposal), API-19/20/21 and API-07 angle selection. API-10/11 conversation storage is deferred; requests accept only the saved revision, and the conversation cutoff is zero. Nonzero/extra cutoff fields are rejected rather than ignored. Review/edit/approval/generation remain F08/F09. Project `allowedActions` retains its existing edit-only schema until combined review is implemented; the planning panel uses the planning endpoints and their actual refusal responses. Project details expose real current/active pointers; `currentPlanInputHash` remains null until the approval contract is implemented. The plan endpoint supplies the **saved-input** hash, which is not yet a generation approval hash.

- POST `/projects/{id}/brainstorm` and `/projects/{id}/plans`: `{expectedProjectRevision}` and UUID `Idempotency-Key`; 202 AcceptedJob. Snapshot saved brief/settings, retain source revision and planning request ID. A live worker and fresh free allowance are required before acceptance. No voice is required merely to plan. Exactly three validated brainstorm angles. API-07 selection includes `brainstormSelection:{jobId,angleId}` plus the resulting whole brief; server verifies project, ready result, source brief revision and exact selected text. Ordinary later edits are allowed.
- GET `/projects/{id}/planning` is the F07 **additional scoped resume endpoint**: `{job:Job|null,plan:PlanVersionPreview|null}` for the latest job/current proposal. No query/body. GET `/jobs/{id}` polls the durable state. No fake percentages; `progress:null`, `stage:"planning"`. The browser polls every three seconds, including after reload.
- POST `/jobs/{id}/cancel|retry`: `{expectedRevision}` against visible `statusRevision`, plus UUID idempotency key. Queued cancellation is confirmed immediately (200); in-flight cancellation is requested (202), then the worker records final cancellation. A submitted request can still consume allowance. Retry is explicit, at most three submitted attempts per job, only for known definitive failures/paused pre-submission access. No transport retry, automatic repair, model fallback or paid upgrade. Unknown outcomes are never resubmitted automatically.
- Planning command receipts return the original accepted/action snapshot **before** checking changed revisions/provider availability, and reject key/payload mismatch. These small command receipts have no TTL in F07 (a stricter replay guarantee than the general 24-hour HTTP policy); retention cleanup is deferred. Browser stores uncertain command key/body before sending and offers “Check same request” after an interrupted acknowledgement. Autosave recovery remains separate and preserves incomplete input.
- GET `/plans/{id}` returns immutable text/diagram proposal, selected-language captions, settings snapshot, source revision and `isCurrent`. `canGenerate:false` always in F07. Superseded results cannot replace a current plan; edits keep previous proposals readable but invalidate currency. A new plan request also makes a previous proposal non-current until it finishes. Optional brainstorming preserves an existing plan until an angle is selected.

**Staged proposal format:** F07's bounded `plan.schemaVersion:2` is a read-only proposal projection, not the complete render/approval Plan v2 in section 8. It contains title, learningObjective, language, targetSeconds, 3–8 scenes `{sceneId,heading,narration,labels[2..5],layout:sequence|cycle|comparison}`, exact narration-derived captions `{captionId,sourceSegmentId,text}`, and review notes. F08/F10 must compile this through the trusted narration/scene/event/template contract before approval/rendering; it must never be passed directly to Remotion as a validated render plan. No generated HTML/SVG/code, remote media or arbitrary URLs. Diagram relationships and scientific correctness still require human review; language sanity checks are not native-speaker verification. Captions are untimed until actual speech alignment. Supplied references are text/provenance, not fetched/verified webpages.

Free inference uses the configured reviewed Gemini model and billing-disabled confirmation, current metadata and an explicit configuration-bound operator quota observation. The local cap is at most 500 requests, expires within one hour and before Pacific midnight, and reserves one request transactionally before submission. A conservative one-minute interval and 24 KB input/8,192 output-token caps stay below the observed 15 RPM/250,000 TPM limits for this worker. Other project usage remains external and can cause 429; no remaining quota is inferred from metadata. Unknown submission pauses all planning and requires reconciliation, which has no automated clearance command in F07. Re-attesting cannot clear uncertainty. All endpoints require active team membership, live project access, strict origin on mutations, bounded JSON, private/no-store envelopes and non-enumerating IDs.

## Document control

| Field | Value |
|---|---|
| Version/date | 1.0 — 20 October 2026 |
| Status | Proposed application contract for review and Stitch reconciliation; not implemented endpoints |
| Product reference | [PRD.md](PRD.md), v1.2, including the user's later single-language and free-test decisions |
| Architecture reference | [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md), v1.0 |
| Persistence companion | [DATABASE_DESIGN.md](DATABASE_DESIGN.md), v1.0 |
| Scope | Internal shared-team V1; Google sign-in, projects, planning, generation, media, branding, Instagram, calendar, activity |
| Next stage | Reconcile these contracts with Google Stitch designs before implementation |

The existing loopback prototype endpoints are not this API. This document specifies the application to build. Creating it does not migrate data, deploy routes, change credentials, or authorize publication. Exactly two design documents are being added; a generated OpenAPI contract can follow the UI reconciliation.

## Contents

1. [Scope and contract decisions](#1-scope-and-contract-decisions)
2. [HTTP conventions](#2-http-conventions)
3. [Authentication and authorization](#3-authentication-and-authorization)
4. [Validation and limits](#4-validation-and-limits)
5. [Pagination, filtering, and ordering](#5-pagination-filtering-and-ordering)
6. [Concurrency and idempotency](#6-concurrency-and-idempotency)
7. [Errors and status codes](#7-errors-and-status-codes)
8. [Shared response models](#8-shared-response-models)
9. [Identity and voice catalog](#9-identity-and-voice-catalog)
10. [Projects and conversation](#10-projects-and-conversation)
11. [Planning and version review](#11-planning-and-version-review)
12. [Generation and jobs](#12-generation-and-jobs)
13. [Media access and uploads](#13-media-access-and-uploads)
14. [Workspace settings and brand](#14-workspace-settings-and-brand)
15. [Instagram connection](#15-instagram-connection)
16. [Publishing commands](#16-publishing-commands)
17. [Calendar, activity, and operations](#17-calendar-activity-and-operations)
18. [State, retry, and race contracts](#18-state-retry-and-race-contracts)
19. [Security and provider boundaries](#19-security-and-provider-boundaries)
20. [Verification and Stitch handoff](#20-verification-and-stitch-handoff)
21. [Traceability, refinements, and references](#21-traceability-refinements-and-references)

## 1. Scope and contract decisions

- One approved team workspace; server resolves it from current membership. No public registration, client-created workspaces, customer billing, quotas, or subscription endpoints.
- One selected video language: `en` produces English narration/subtitles; `te` produces Telugu narration/subtitles. `captionLanguage` is derived response metadata, not a writable request field. Cross-language captions are rejected.
- Accent and voice are separate compatible catalog selections, not arbitrary provider parameters. One narrator per V1 video; built-in free test voices are explicitly labelled evaluation alternatives.
- Workflow remains **Plan → Generate → Publish** in one project workspace. Backend stages are not extra customer pages.
- Generation approval binds an immutable plan/settings snapshot. Publishing approval separately binds a ready version, post caption, cover, destination, and time.
- All long work is accepted durably and runs in the worker. Closing the browser or signing out does not cancel it.
- One authorized render at a time is a service-capacity decision. No per-member credit balance is returned.
- Ready requires validated durable media. Published requires confirmed external evidence. Uncertainty is a real response state, never assumed success/failure.
- Full V1 includes Instagram and scheduling; the prototype and an export-only intermediate build do not establish those integrations.

Product rules come from the PRD. Exact request/response names and persistence refinements in section 21 make the system design concrete. If Stitch reveals a missing UI action, update this document and its DB counterpart together; do not add an undocumented endpoint during frontend implementation.

## 2. HTTP conventions

### 2.1 Transport and representation

Application base path: `/api/v1`. Hosted deployments require HTTPS and same-origin browser access. Local development uses an explicitly configured loopback origin/port. Example origins and IDs in this document are illustrative, not deployed services or usable credentials.

- JSON request/response media type: `application/json`; UTF-8.
- Use ISO 8601 UTC strings with milliseconds for API timestamps, e.g. `2026-10-20T08:30:00.000Z`. Durations are numeric seconds; offsets are integer minutes; frames are integers.
- Application resource IDs are server-generated UUID strings. Auth.js user IDs are opaque strings. Meta account/media IDs are opaque strings, never JS numbers.
- Booleans are JSON booleans. Counts/revisions are safe nonnegative JSON integers; reject overflow/NaN/Infinity and numeric strings. Database Long conversion is internal.
- `null` means an explicitly absent optional value. Omitted patch members mean unchanged. Empty strings are not substitutes for null references.
- No JSON body on GET/HEAD. DELETE uses headers/query parameters specified below, not a body that intermediaries may discard.
- Unsupported methods return `405` with `Allow`; malformed JSON returns `400`; unsupported request content type returns `415`.
- Auth.js OAuth/form/redirect routes, direct R2 uploads/downloads, and the Instagram callback have their own formats and are explicitly outside the JSON envelope.

### 2.2 Standard headers

| Header | Contract |
|---|---|
| `Accept: application/json` | Application API representation |
| `Content-Type: application/json` | Required on application mutations with a body |
| Session cookie | Library-managed; no API key or provider token from browser |
| `Origin` | Checked on browser mutations against configured origin; server requests use separate trusted execution identity |
| `Idempotency-Key` | Required on application POST/PATCH/PUT/DELETE commands; UUID per logical user action, preserved on network retry |
| `If-Match` | Not used on these V1 aggregate DTO routes; use the explicit expected revision instead |
| `X-Request-ID` | Response correlation ID generated/validated server-side; never an authorization mechanism |
| `Location` | New resource or job status URI on 201/202 |
| `Retry-After` | Suggested retry/poll delay for 202/429/503 where appropriate, not an execution guarantee |
| `Idempotency-Replayed: true` | Present when returning a committed previous command result |
| `Cache-Control: private, no-store` | All authenticated JSON and signed-URL responses |

Strict origin/CSRF checks are independent of idempotency. A custom header alone is not authentication. Library-provided Auth.js forms/actions use the pinned library's CSRF flow rather than a fabricated login JSON endpoint.

### 2.3 Success envelope

```json
{
  "data": {"id": "20000000-0000-4000-8000-000000000001", "revision": 1},
  "meta": {"requestId": "req_example_01", "serverTime": "2026-10-20T08:30:00.000Z"}
}
```

All endpoint success examples below show the `data` value unless labelled **full response**. The server wraps it with `meta`; list pagination is inside `data.page`. A 204, if introduced later, has no envelope/body; V1 uses JSON confirmations for deletion/cancellation because outcomes need explanation.

Creation returns `201`. Accepted asynchronous work returns `202` with a status URL. Synchronous reads/updates/replays return `200`, or the original committed 201/202 on replay. No endpoint holds an HTTP request open until a video finishes.

## 3. Authentication and authorization

### 3.1 Google authentication

Use Auth.js Google provider and MongoDB adapter with database sessions. Require verified Google email, exact normalized operator allowlist membership, and an active workspace membership. Do not use an email-domain suffix as blanket authorization or silently reactivate a disabled member.

| Integration route | Behavior |
|---|---|
| `/api/auth/signin/google` | Library-managed sign-in entry; use supported Auth.js client/server helper, not hardcoded token exchange |
| `/api/auth/callback/google` | Configured OAuth callback; state/PKCE validation under pinned Auth.js version |
| `/api/auth/session` | Library session representation; dashboard uses `/api/v1/me` for application context |
| `/api/auth/signout` | Library-managed CSRF-protected sign-out; not a state-changing GET |

Do not promise an exact cookie name/form schema across library releases. Hosted cookie is HttpOnly, Secure, and configured with appropriate SameSite policy. Proposed absolute session lifetime is seven days. No Google Drive scope, password endpoint, API-key login, or browser refresh token is needed. [Auth.js Google provider](https://authjs.dev/getting-started/providers/google)

### 3.2 Per-operation authorization

Before command replay or resource lookup, verify current session, allowlist, and active membership. Derive `{userId, workspaceId}` server-side; apply both resource ID and workspace/deletion filters. All active teammates share access; there is no project-owner ACL or new role hierarchy.

- Missing/expired session: `401 SESSION_EXPIRED` or `AUTHENTICATION_REQUIRED`.
- Signed-in nonmember/disabled member: `403 TEAM_ACCESS_DENIED` without exposing team data.
- Missing/inaccessible/tombstoned resource: non-enumerating `404 RESOURCE_NOT_FOUND`.
- Jobs and approved schedules continue after logout/member removal; shared history retains actor IDs. Remaining teammates can cancel them.
- Every signed URL is newly authorized. Existing bearer URLs can remain valid until expiry; membership removal cannot retroactively revoke them.

Reject user-supplied workspace/actor IDs in commands. Never return provider keys, Meta ciphertext/plaintext, Google account tokens, session tokens, object-storage credentials, or unredacted provider bodies. Do not cache workspace responses across users.

## 4. Validation and limits

### 4.1 General rules

Use strict application schemas, allowlisted enums, and bounded strings/arrays. Unknown query/body fields are errors, including unsupported cross-language caption fields. Return paths in `fieldErrors`, preserving useful client input. Validate decoded URLs/UUIDs only where the contract allows them; no arbitrary filesystem paths, executable scene code, provider URLs, or raw SVG uploads.

| Input | V1 bound/default |
|---|---|
| Idea | Required nonblank, maximum 2,000 grapheme clusters |
| Audience | Default beginner/general; maximum 200 graphemes |
| Change request | Nonblank, maximum 2,000 graphemes |
| Pasted reference text | Maximum 20,000 graphemes total per brief; at most 10 entries |
| Display title | 1–120 graphemes; separate from on-video title |
| Language | Exactly `en` or `te` |
| Target | Exactly 30, 60, or 90 seconds |
| Voice/accent/theme/font | Enabled compatible catalog IDs; not free-form provider settings |
| Plan snapshot | Maximum 512 KiB serialized UTF-8; trusted template-specific tighter bounds |
| Command JSON | Maximum 128 KiB encoded bytes; larger references are not silently truncated |
| Post caption | Maximum 2,000 graphemes and current stricter provider validation |
| Logo | PNG/JPEG/WebP; maximum 5 MB actual bytes; dimensions at most 4096×4096 |
| Calendar window | At most 93 days queried; positive range |
| Schedule | 10 minutes–30 days ahead; future UTC instant resolved from IANA zone/local input |
| Default zone | `Asia/Kolkata` |

Normalize line endings and use a documented Unicode normalization policy before hashing. Preserve Telugu grapheme boundaries, intended punctuation, names, units, negation, and numbers. Script checks do not prove language accuracy. References are untrusted content, not system instructions; a supplied URL is provenance only, not permission to crawl it.

### 4.2 SettingsInput

Writable project settings use the whole following object when replaced:

```json
{
  "language": "te",
  "targetSeconds": 30,
  "accentId": "source-voice",
  "voiceCatalogId": "alice-evaluation",
  "brandKitRevisionId": null,
  "themeId": "clean-educational-v1",
  "captionStyleId": "readable-default-v1"
}
```

`source-voice` means the explicit evaluation delivery of that catalog voice, not a claim of native Telugu or Indian-English accent. Enabled catalog entries determine actual permissible combinations. Defaults prefer English/Indian accent only when a tested compatible voice exists. If unavailable, return `VOICE_UNAVAILABLE` and explicit alternatives; do not silently choose Alice.

Settings resolve into immutable `SettingsSnapshot` containing provider/model/voice ID, adapter versions, pronunciation policy, exact brand/font assets/checksums, template/compiler/output versions, derived caption language, and usage policy. Clients select catalog IDs; the server owns resolution and hashing. Production output profile is fixed, not a client-selected arbitrary resolution/codec.

F04 draft refinement: `accentId` and `voiceCatalogId` may each be null in saved draft SettingsInput. Saving an idea must not require an integration that is implemented later or silently substitute a voice. Approved generation input still requires an explicitly selected, resolved compatible voice/accent; null is never eligible for generation. At F04, only null selections are accepted on creation; non-null selections return `503 VOICE_UNAVAILABLE` until the F06 catalog is connected. The UI offers idea/language/target only; voice and accent remain separate future controls.

## 5. Pagination, filtering, and ordering

### 5.1 Cursor contract

List endpoints accept `limit` (default 20, range 1–50) and an opaque `cursor` (maximum 2,048 characters). Offset/page-number pagination is not supported. Reject malformed, expired, wrong-workspace, wrong-endpoint, or changed-filter cursors with `400 INVALID_CURSOR`; a cursor never grants access.

Cursor payload is versioned and integrity-protected, binding endpoint/workspace, filter/order fingerprint, last sort tuple, and proposed one-hour expiry. Decode into typed values only; never turn cursor content into a MongoDB operator. Validate membership again. Sort tie-breaker is ID or immutable sequence; fetch `limit+1` to derive `hasMore`.

```json
{
  "items": [],
  "page": {"limit": 20, "hasMore": false, "nextCursor": null}
}
```

Use the actual server-returned cursor unchanged on the next request with the same filters. No expensive mandatory `totalCount`; an empty page returns 200. A cursor scan of mutable `updatedAt` ordering is not a frozen snapshot: concurrent edits can move items between pages. Clients deduplicate by ID and refresh the first page for a current library. Activity/messages use immutable sequence ordering for stable traversal.

### 5.2 List options

| Endpoint | Supported filters and order |
|---|---|
| Projects | `q` literal title search ≤120; `generationState`; `publishingState`; `hasReadyVideo`; order `updated_desc` only |
| Messages | Ascending sequence, cursor-based; bounded historical traversal |
| Versions | `kind=plan` or `kind=video`; descending per-kind version number; kind required |
| Activity | Descending workspace sequence; `projectId` and optional comma-separated event types |
| Calendar | Required `from`, `to` UTC timestamps, `timezone`; optional comma-separated states; ascending `(scheduledAtUtc,id)` |

Project generation filter means latest run state; publishing filter means an unresolved matching intent, or latest resolved outcome where specified by the response. A project can match both rendering and scheduled. Filter before pagination, not after loading a page. Deleted projects and inaccessible resources never become visible through counts/search.

F04 implementation checkpoint: project lists implement `q`, `limit`, `cursor` and `order=updated_desc`. Generation/publishing/ready filters are not exposed in the UI and return `400 INVALID_QUERY` until their owning services exist. Only persisted draft summaries are returned; no invented generation/publication state or mandatory aggregate counts.

Duplicate query keys, unsupported order/filter enums, negative/fractional limits, arbitrary regexes, or inconsistent cursor filters return 400. Literal title search escapes metacharacters and does not execute user regex code. Calendar includes publish-now activity using the persisted effective dispatch instant.

## 6. Concurrency and idempotency

### 6.1 Revision preconditions

`revision` is the mutable resource's user-edit/control revision. Projects additionally expose `briefRevision` for generation-relevant changes. Internal heartbeat/guard counters are not editor revisions. Updating a display title advances `revision`, but not `briefRevision` or the approved generation hash. Changing language/voice/reference/idea advances both and invalidates the current proposal for generation.

Use the endpoint's explicit `expectedProjectRevision` or `expectedRevision` in JSON; DELETE uses a required query precondition because it has no body. Missing required precondition → `428 PRECONDITION_REQUIRED`; stale revision → `409 STALE_REVISION`. Revision values are not arbitrary client assertions: the server compares them atomically with the stored current resource.

V1 does not emit a strong ETag derived only from an edit revision on an aggregate response that also contains changing job/connection state or serverTime. No 304 flow is needed for private no-store responses. Sending If-Match to these routes returns `400 UNSUPPORTED_PRECONDITION`; use the specified revision field. If a later separately versioned editable representation adds HTTP validators, false If-Match must use 412 under HTTP semantics. That future header behavior is not a second V1 concurrency mechanism. [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.1)

Background status uses `statusRevision` separately. On conflict, return safe current revision/editor/time; preserve the client's unsaved text and reload/resolve. No last-write-wins narration edits. This chooses the system design's explicit-revision option consistently rather than inventing a misleading aggregate validator.

### 6.2 Command replay

1. Authenticate and authorize current access, then validate command shape/canonical request hash.
2. Look up workspace/user/route-scoped idempotency key hash. A changed payload, including changed expected revision, under the same key is a conflict.
3. Commit the domain change and result reference in the same transaction as the idempotency record. Concurrent matching calls return the winner; no dangling in-progress record is treated as success.
4. Replay returns the committed result and `Idempotency-Replayed: true`, even if later edits advanced the resource; client can fetch current state afterward.
5. Default HTTP record expiry is 24 hours. Generation also has unique `(workspaceId, planVersionId, inputHash)`. Publication has a permanent unique `creationCommandId`, separate from temporary HTTP cache lifetime.

Rejected validation/precondition commands do not reserve the key. A definitive committed domain failure, such as a later asynchronous provider error, is not hidden by issuing a new generation command. Retry through the explicit safe retry endpoint against the original immutable input.

Publishing `creationCommandId` is a client-generated UUID persisted with the intent for its lifetime. Reusing it with a different original payload yields `IDEMPOTENCY_MISMATCH`; replaying it returns the same intent even after terminal publication or later payload revisions. An intentional repost requires a new command and explicit prior-post acknowledgement. A unique active slot prevents two unresolved intents for the same project/account from different members or keys.

Ephemeral URL responses are a defined exception to byte-identical replay: media access reauthorizes and can mint a fresh short-lived read URL; upload replay returns the same reservation/key with no extension beyond its original write expiry; OAuth connect replay returns the same unconsumed, unexpired state transaction or an expired-flow error. Persist safe result references, not signed URLs. OAuth state needed to reconstruct the same authorization URL is encrypted in the short-lived OAuth transaction, with its hash used for lookup. These replays never create another logical upload/OAuth flow or extend a committed write permission silently.

## 7. Errors and status codes

### 7.1 Full error response

```json
{
  "error": {
    "code": "STALE_REVISION",
    "message": "This project was updated by a teammate. Review the current version before saving.",
    "retryable": false,
    "action": "reload_and_resolve",
    "fieldErrors": [],
    "details": {"currentRevision": 13, "updatedAt": "2026-10-20T08:31:00.000Z", "updatedBy": {"id": "user_example_2", "name": "Team member"}}
  },
  "meta": {"requestId": "req_example_conflict", "serverTime": "2026-10-20T08:31:01.000Z"}
}
```

`fieldErrors` is an array of `{path,code,message}` using JSON Pointer paths such as `/settings/language`; paths for query values begin `/query/`. `details` is an allowlisted code-specific object. Never echo credentials, full submitted content, SQL/Mongo internals, raw provider error text, or stack traces.

### 7.2 Catalog

| HTTP | Code examples | Meaning/action |
|---|---|---|
| 400 | `MALFORMED_JSON`, `INVALID_QUERY`, `INVALID_CURSOR`, `INVALID_ID`, `UNKNOWN_FIELD`, `UNSUPPORTED_PRECONDITION` | Correct request; no work accepted |
| 401 | `AUTHENTICATION_REQUIRED`, `SESSION_EXPIRED` | Sign in; existing jobs remain |
| 403 | `TEAM_ACCESS_DENIED`, `ORIGIN_NOT_ALLOWED`, `CSRF_REJECTED` | Access/request protection; no sensitive resource detail |
| 404 | `RESOURCE_NOT_FOUND` | Missing, inaccessible, or deleted resource |
| 409 | `STALE_REVISION`, `STALE_PLAN`, `ACTIVE_INTENT_EXISTS`, `IDEMPOTENCY_MISMATCH`, `SUBMISSION_STARTED`, `INVALID_STATE`, `UNRESOLVED_PUBLICATION`, `UPLOAD_NOT_READY` | Resolve state/review; do not blindly replay with a new key |
| 409 | `ACTIVE_WORK_ACK_REQUIRED`, `OAUTH_FLOW_EXPIRED`, `ALREADY_PUBLISHED`, `MISSED_SCHEDULE` | Review impact, restart authorization, or explicitly resolve the existing post/time |
| 428 | `PRECONDITION_REQUIRED` | Missing required explicit edit revision |
| 413/415 | `INPUT_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE` | Correct payload/media |
| 422 | `VALIDATION_FAILED`, `INVALID_LANGUAGE`, `VOICE_INCOMPATIBLE`, `UNSUPPORTED_TEMPLATE`, `INVALID_TIME`, `AMBIGUOUS_TIME`, `UNREADABLE_LAYOUT`, `REPOST_ACK_REQUIRED` | Supported input/review needed |
| 422 | `MEDIA_USAGE_RESTRICTED`, `MEDIA_UNAVAILABLE`, `CAPTION_INVALID`, `COVER_UNSUPPORTED`, `INSTAGRAM_INELIGIBLE` | Cannot publish this payload under current constraints |
| 429 | `SERVICE_RATE_LIMITED` | Temporary technical protection, with Retry-After; not a member generation allowance |
| 503 | `PROVIDER_PAUSED`, `VOICE_UNAVAILABLE`, `WORKER_UNAVAILABLE`, `SCHEDULING_UNAVAILABLE`, `CONNECTION_UNAVAILABLE`, `STORAGE_UNAVAILABLE` | Integration unavailable; preserve work |
| 500 | `INTERNAL_ERROR` | Sanitized support ID, uncertain commit retried only using same command key |

Provider 402 is normalized to unavailable access, never customer checkout. Provider 429 may be rate/allowance related; classify it, pause/back off as appropriate, and do not assume payment is authorized. Asynchronous failure appears in the job/intent response with its stable error code; a polling GET still returns 200 for an existing failed job.

`retryable:true` means the specified action is safe under the same command/state, not permission to resend Meta publish or unknown synthesis calls. If a request times out, retry the same idempotency key or fetch its known resource; never create a new publication to guess whether the first succeeded.

## 8. Shared response models

These are explicit public DTOs. Database fields, R2 keys, leases, ciphertext, provider bodies, and raw worker logs are not automatically serialized.

| Model | Required public fields |
|---|---|
| `ActorSummary` | `id`, `name`; avatar URL optional/approved; email only on own profile |
| `SettingsInput` | Fields in section 4.2; partial settings objects are rejected unless an endpoint explicitly names a patch |
| `SettingsSnapshot` | Selected IDs plus resolved safe provider/model/voice name, brand revision, font/theme/template/output versions, `captionLanguage`, `usagePolicy`; no keys |
| `ProjectSummary` | `id`, `displayTitle`, `revision`, `briefRevision`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `draftState`, `latestRun` nullable, `latestReadyVideo` nullable, `publishing` summaries |
| `ProjectDetail` | Summary plus `brief:{idea,audience,references}`, `settings`, `currentPlanVersionId`, `currentPlanInputHash`, `activePlanningJobId`, action capabilities and blocked reasons |
| `PlanVersion` | `id`, `projectId`, `versionNumber`, `sourceBriefRevision`, `parentPlanVersionId`, `inputHash`, `plan`, `settingsSnapshot`, `reviewNotes`, `createdAt`, `createdBy`, `isCurrent`, `canGenerate`, blocked reasons |
| `PlanVersionSummary` | `id`, `projectId`, `versionNumber`, `title`, `sourceBriefRevision`, `isCurrent`, `canGenerate`, `approvalStatus`, `createdAt`, `createdBy`; no full narration/props |
| `VideoVersionSummary` | `id`, `projectId`, `versionNumber`, `title`, `language`, `captionLanguage`, narrator name, `usagePolicy`, actual duration, poster asset ID, readyAt and availability |
| `Message` | `id`, `projectId`, integer `sequence`, `role:user/assistant`, `text`, `createdAt`, `actor` nullable, `relatedJobId` nullable |
| `AcceptedJob` | `jobId`, `kind`, `state`, `statusUrl`, domain result IDs if allocated, `pollAfterSeconds` |
| `Job` | `id`, `kind`, `projectId` nullable, `state`, `statusRevision`, `stage`, `progress` nullable, `queuePosition` nullable/advisory, timestamps, `result` nullable, `error` nullable, `allowedActions` |
| `VideoVersion` | `id`, `projectId`, `versionNumber`, `planVersionId`, `generationRunId` (nullable for explicit prototype import), `source`, `language`, derived `captionLanguage`, narrator name, `usagePolicy`, `media`, `assets`, `transcript`, `readyAt`, capabilities |
| `AssetSummary` | `id`, `kind`, `mimeType`, `sizeBytes`, duration/dimensions where applicable, `availability`; URLs obtained separately |
| `Upload` | `id`, `state`, `expiresAt`, `assetId` nullable, `validationJobId` nullable, safe error nullable |
| `ConnectionSummary` | `id` nullable, `revision`, `generation`, `status`, `account` nullable, expiry/health time, affected intent count, allowed actions; no token |
| `PublishingIntent` | `id`, `projectId`, `revision`, `payloadRevision`, `state`, `creationCommandId`, immutable current payload, provider confirmed media ID/permalink nullable, error, timestamps, allowed actions |
| `ActivityEvent` | `id`, `sequence`, actor/system, type, user-safe message, project/resource refs where visible, createdAt, action needed |

### 8.1 Job result union

- `brainstorm`: `{angles:[{id,title,hook,learningObjective}], sourceBriefRevision}`; exactly three validated alternatives.
- `plan`/`revision`: `{planVersionId, isCurrent}`; superseded results do not replace the current proposal.
- `generation`: `{generationRunId, videoVersionId}` only after ready commit; failed/cancelled work has no fake video ID.
- `caption_suggestion`: `{videoVersionId,caption,hashtags}`; editable text, not a publishing approval.
- `upload_validation`: `{uploadId,assetId}` only after decoded asset validation.
- `reconciliation`: `{intentId,state,evidenceClassification}`; no publish action implied.
- `cleanup`: `{projectId,cleanupState}` for an authorized deletion receipt without resurfacing private deleted content.

### 8.2 Narration and scene plan

`plan` uses selected-language schema v2: title, learning objective, audience, language, target seconds, stable narration segments, matching caption segments, ordered scenes, supplied references, and review notes. Each scene has a trusted template ID/version, source segment IDs, validated props, and declarative anchor events. All nested fields are bounded and application-owned as specified in system design section 11 and DB design section 5.

The full plan is returned for combined review; snippets in examples illustrate shape, not a complete educational plan. Clients never submit executable React/SVG/JS or model-generated timestamps as final alignment. Caption text cannot independently translate or alter narration meaning.

## 9. Identity and voice catalog

### API-01 — `GET /api/v1/me`

Request: no body/query. **200 data:**

```json
{
  "user": {"id": "user_example_1", "name": "Team member", "email": "member@example.com"},
  "workspace": {"id": "10000000-0000-4000-8000-000000000001", "name": "VideoCraft team", "timezone": "Asia/Kolkata"},
  "preferences": {"language": null, "voiceCatalogId": null, "accentId": null, "timezone": null},
  "preferencesRevision": 1,
  "defaults": {"language": "en", "targetSeconds": 60, "preferredAccentId": "indian", "preferredVoiceCatalogId": null},
  "capabilities": {
    "planning": {"enabled": false, "reasonCode": "PROVIDER_NOT_VERIFIED"},
    "generation": {"enabled": true, "evaluationOnly": true},
    "publishing": {"enabled": false, "reasonCode": "INTEGRATION_NOT_CONFIGURED"},
    "scheduling": {"enabled": false, "reasonCode": "ALWAYS_ON_HOST_UNVERIFIED"}
  }
}
```

These capability values illustrate an unavailable-integration state; they are computed from configuration/health, not hardcoded promises. Preferred defaults may be unresolved/null; generation cannot proceed with an unresolved voice. No team email list is returned.

Implementation checkpoint F02: `/me` returns planning/generation disabled with `reasonCode:"FEATURE_NOT_IMPLEMENTED"` until their application features are connected. Existing CLI prototype capabilities do not make the dashboard generation API available. Private context is not returned until real authentication and active membership succeed.

### API-02 — `PATCH /api/v1/me/preferences`

Request `{expectedRevision, patch}`; patch accepts only personal `language`, `voiceCatalogId`, `accentId`, and `timezone`, each nullable to clear override. No shared workspace default changes here.

```json
{"expectedRevision":1,"patch":{"language":"te","timezone":"Asia/Kolkata"}}
```

**200 data:** `{"preferences":{"language":"te","voiceCatalogId":null,"accentId":null,"timezone":"Asia/Kolkata"},"revision":2}`. Validate compatible preference if a voice is supplied; mismatch is 422, stale preferences 409. Saving preferences does not mutate existing project/version/schedule settings.

F13c implementation (22 October 2026): API-02 and companion `GET /api/v1/me/preferences` return `{revision,preferences}` with exactly the four editable preference fields. API-01 normalizes legacy missing accent to null. PATCH requires authenticated active membership, canonical Origin, UUID Idempotency-Key, a bounded JSON body and positive safe expectedRevision (missing 428). Query parameters/If-Match are refused. Unknown fields 400; invalid language/zone/pair/no-op 422; stale revision or key mismatch 409; unavailable selected voice 503 VOICE_UNAVAILABLE. Language is en|te|null; timezone is a validated IANA identifier|null. Voice/accent are separate controls and must be both selected or both null. A personal voice requires an explicit personal language, preventing an inherited workspace language from silently changing that selection. Voice changes use the current free-only catalog; clearing overrides works while providers are unavailable. No inference/speech request is made by saving preferences.

Original same-member command replay precedes current revision/provider checks, while current access is always rechecked. Permanent private receipts have no TTL. A new save CAS-updates only that membership's preferencesRevision/preferences/updatedAt and inserts its receipt atomically. Shared defaults, branding, activity sequence/read marker, projects/plans/approvals/videos/schedules and other members are unchanged. No shared activity event exposes personal preferences. The UI preserves an exact complete pending save in workspace/user-scoped tab storage, retries unknown outcomes with the original key/body, and retains stale edits until explicit reload. Unsaved incomplete typing is not a durable draft.

Newly loaded composers apply personal language before team language; a saved personal voice/accent applies only to its explicit personal language, otherwise matching-language team defaults apply. Duration/brand/theme/captions remain shared defaults. Existing/open/recovered composers and exact pending create commands retain their captured selections. Personal timezone is persisted for future F18 scheduling; it does not currently override every displayed browser-local timestamp or move scheduled instants. The nullable accent extension preserves the PRD's separate voice/accent requirement without rewriting legacy memberships.

### API-03 — `GET /api/v1/voices`

Operator disablement is independent of observation refresh. A provider disabled through policy or legacy disabled state returns `state:disabled`, `reasonCode:PROVIDER_DISABLED`, and no available voices, even with healthy fresh metadata. Only an explicit operator revision-checked enable command can clear the policy; it invalidates observations before future reservations. Catalog GET/refresh and successful probes never grant re-enablement.

F06 implementation: authenticated/no-store catalog supports the query below, with exact English/Telugu and source-voice/en-IN/te-IN bounds and duplicate/unknown query rejection. `data.providers` additionally contains safe provider/model/state/reason/check/expiry summaries and nullable observed remaining provider units. It contains no credentials, raw voice IDs, config hashes or reservations. Reads refresh expired metadata only (five-minute healthy cache, one-minute failure cache); no read synthesizes speech. Explicit operator probes record bounded free-account speech evidence per language before Alice becomes selectable. Both voice and accent remain separate nullable draft fields; choosing a voice does not auto-pick its accent. Actual selection changes are validated against current server observations within project transactions after replay lookup. Unchanged saved selections can be retained while editing a brief; they are not dispatch approval. Preferred paid-library voices remain unavailable. Native accents and publication remain unverified/unavailable. Gemini model discovery cannot prove remaining allowance, so unknown capacity stays paused. Dashboard planning/generation remain disabled until their owning features.

Query: required `language`; optional `accentId`, `intendedUse=evaluation|publication`, `includeUnavailable=true|false` (default false). Bounded curated list, no pagination. **200 data:**

```json
{
  "language": "te",
  "items": [{
    "id": "alice-evaluation",
    "name": "Alice — evaluation voice",
    "provider": "elevenlabs",
    "model": "eleven_v3",
    "supportedAccentIds": ["source-voice"],
    "testedForLanguage": true,
    "nativeAccentVerified": false,
    "usagePolicy": "evaluation_only",
    "available": true,
    "reasonCode": null,
    "sampleAssetId": null
  }],
  "checkedAt": "2026-10-20T08:30:00.000Z"
}
```

Unavailable preferred voices can be shown with a clear reason when requested. A sample uses the same asset-access authorization as other media. Raw provider IDs/settings are resolved server-side; availability is checked again at approval/dispatch. Publication filter never treats a successful evaluation as permission for business posting.

## 10. Projects and conversation

### API-04 — `GET /api/v1/projects`

Request example: `?limit=20&q=water&hasReadyVideo=true&generationState=ready`; additional filters in section 5. **200 data:** `{items:ProjectSummary[],page}`. Each summary exposes independent draft/latest-run/latest-ready/publishing indicators, timestamps and actor summaries, not full conversation or large plans. No match → empty list. `publishingState` filtering uses the intent semantics defined in section 5, not a single overloaded project status.

### API-05 — `POST /api/v1/projects`

Required body: `idea`, `settings:SettingsInput`. Optional `displayTitle`, `audience`, `references` (default empty). Reference entries: stable brief-local `referenceId`, pasted `text`, nullable provenance `suppliedUrl`; no URL fetching. **Request:**

```json
{
  "displayTitle": "Water cycle test",
  "idea": "Explain the water cycle to beginners.",
  "audience": "Beginners",
  "references": [],
  "settings": {
    "language": "te", "targetSeconds": 30, "accentId": null,
    "voiceCatalogId": null, "brandKitRevisionId": null,
    "themeId": "clean-educational-v1", "captionStyleId": "readable-default-v1"
  }
}
```

**201 data — ProjectDetail example:**

```json
{
  "id": "20000000-0000-4000-8000-000000000001",
  "displayTitle": "Water cycle test",
  "revision": 1,
  "briefRevision": 1,
  "createdAt": "2026-10-20T08:30:00.000Z",
  "updatedAt": "2026-10-20T08:30:00.000Z",
  "createdBy": {"id":"user_example_1","name":"Team member"},
  "updatedBy": {"id":"user_example_1","name":"Team member"},
  "brief": {"idea":"Explain the water cycle to beginners.","audience":"Beginners","references":[]},
  "settings": {"language":"te","targetSeconds":30,"accentId":null,"voiceCatalogId":null,"brandKitRevisionId":null,"themeId":"clean-educational-v1","captionStyleId":"readable-default-v1"},
  "draftState": "draft",
  "currentPlanVersionId": null,
  "currentPlanInputHash": null,
  "activePlanningJobId": null,
  "latestRun": null,
  "latestReadyVideo": null,
  "publishing": [],
  "allowedActions": ["edit", "brainstorm", "create_plan", "duplicate", "delete"],
  "blockedReasons": []
}
```

`Location: /api/v1/projects/<id>`. Persist only; do not start planning, synthesis, or publishing implicitly. Drafts may explicitly leave voice/accent null; attempting to resolve or use an unavailable voice returns selection guidance, with no paid/provider fallback.

F04 implementation checkpoint: API-04/05/06 are connected to MongoDB. Creation uses a UUID Idempotency-Key and exact configured Origin/Host. Project insert, original response snapshot/replay receipt, activity event and workspace sequence increment commit in one transaction. Replay returns the original 201 snapshot plus `Idempotency-Replayed:true`, while deleted/inaccessible source content is never replayed. Responses currently expose `allowedActions:[]` with blocked reasons for editing/planning/generation; later features enable their own actions. Actor summaries contain IDs/names, never team emails. The current request example uses unresolved draft selections; catalog-selected settings become available with F06.

### API-06 — `GET /api/v1/projects/{projectId}`

No body/query. **200 data:** complete `ProjectDetail` shape from API-05 with current pointers, independent state summaries, and allowed actions. Live progress belongs to job DTOs; no signed URLs or tokens in the project response. Deleted/inaccessible project → 404.

### API-07 — `PATCH /api/v1/projects/{projectId}`

**F14a implementation (23 October 2026):** accepts `displayTitle`, `brief` and/or `settings`, plus the F07 `brainstormSelection` with its resulting brief. Brief/settings remain complete replacements. Missing revision returns 428; unsupported keys return 400; invalid fields return 422. Same-origin, active membership, UUID idempotency key and 128 KiB JSON limits match creation. The route scope includes the project ID. Replay is checked before revision comparison and returns the original committed 200 snapshot; changed payload/revision under the same key returns 409. No-op replacements retain revisions/timestamps/activity count while committing the existing 24-hour replay receipt. `allowedActions:edit` continues to cover this command; no new action enum or migration is introduced.

Rename input is NFC-normalized and trimmed, 1–120 grapheme clusters within the existing 4,800-code-unit bound, single-line plain text without markup, controls, Unicode line/paragraph separators or unpaired surrogates. A changed title atomically updates displayTitle, normalized literal searchTitle, project revision, updatedAt/updatedBy, one sanitized project_updated event and the receipt. Title-only changes preserve briefRevision, guardRevision, settings/brief and plan/planning/run/video pointers. They require no provider check or cancellation and are permitted by the service on projects with generation pointers. Combined title/input edits obey all existing generation-input restrictions and fail atomically if ineligible. Changed brief/settings advance project/brief/guard revisions and append one event; direct brief/settings edits on generated projects retain their existing refusal. Voice/accent are governed by F06; subtitles follow language.

The inline Rename project form uses explicit Save title. It pauses same-tab brief/planning mutations while open and waits for local edits/operations to settle before opening; the API still permits standalone renames during server-side work. Unconfirmed saves preserve the exact normalized command/key in workspace/user/project-scoped sessionStorage and must replay before editing/canceling. After replay the UI fetches current state, since the receipt can precede later edits. A stale revision retains the typed title and requires explicit Reload saved project, review and another save. Unsaved typing is not durable across reload/navigation. Library title and on-video/plan title are distinct.

The editor serializes saves after roughly two idle seconds. New typing is preserved while an older save is in flight. Uncertain saves reuse the exact key/body before later changes. A stale save pauses autosave, loads a comparison, and offers either the saved version or keeping local edits for review followed by an explicit save. Tab-local recovery is scoped by workspace/user/project; a recovered pending command is resolved before discard/new saves. It is not a durable backup or cross-device sync.

Required `expectedProjectRevision`, `patch`. Allowed patch keys: `displayTitle`, `brief` (whole `{idea,audience,references}` replacement), `settings` (whole SettingsInput replacement), optional `brainstormSelection:{jobId,angleId}` alongside the resulting brief. Nested objects are replaced, not recursively JSON-merged; no JSON Patch operations.

```json
{"expectedProjectRevision":1,"patch":{"displayTitle":"How water travels"}}
```

**200 data:** current `ProjectDetail`, `revision:2`, `briefRevision:1` for this title-only change. Generation-relevant edits advance `briefRevision`, clear proposal eligibility, and supersede current planning requests; they do not remove previous ready videos or modify schedules. Return 409 for stale edits; no automatic merge or render. A supplied brainstorm selection must belong to this project and actual result.

### API-08 — `POST /api/v1/projects/{projectId}/duplicate`

Request `{expectedProjectRevision, displayTitle?}`. **201 data:** new `ProjectDetail`; new IDs/revisions, copied brief/settings/proposal content with provenance. No approval, generation job, publishing intent/history, or external post is copied. Any asset reuse requires separate DB pins. Failure of current source access → 404; stale source → 409.

F14b implementation: authenticated same-origin POST requires a UUID Idempotency-Key, strict JSON <=128 KiB, no query or If-Match, and a positive safe expectedProjectRevision (missing 428, invalid 422; unknown keys 400). Optional displayTitle follows rename's bounded single-line plain-text rules; otherwise the server derives a grapheme-safe `Copy of …` title. The saved source is copied in a transaction, not the browser's unsaved form or current workspace defaults. An eligible current plan must match the source brief revision, request identity, settings and source input hash; its content becomes independent plan version 1 with fresh project/plan/request IDs and duplicate provenance. Valid but outdated proposals are omitted, as stated before confirmation; missing/foreign current-plan pointers refuse with 409 DUPLICATE_SOURCE_INVALID. A retained captured brand revision is checked locally; unavailable branding returns 422 BRAND_UNAVAILABLE. Saved voice/accent choices are retained even when providers are unavailable; actual generation still needs fresh provider checks and a new exact approval.

The new draft starts editor/brief revisions at 1, fresh counters and null operational pointers, with sourceProjectId provenance. Only a copied plan's current pointer/request/plan counter are initialized. No conversation, history, approval, media, speech reuse, job, schedule, token or post is copied, and no provider/R2 request is submitted. Existing immutable brand/logo ownership pins are retained through the referenced brand revision; this endpoint creates no media owner or asset reuse pin.

Migration 019 adds permanent source/actor/key-scoped project_duplicate_commands receipts and optional duplicate plan provenance, preserving earlier manifests. Exact replays return the original 201 ProjectDetail plus Idempotency-Replayed:true before stale/provider checks, and never create another copy after HTTP-receipt TTL. Changed payloads return 409 IDEMPOTENCY_MISMATCH. Both source and copied target must still be live and accessible; disabled membership or deleted/foreign source/target refuses replay. Source guard and active membership writes fence concurrent deletion/revocation/source changes without advancing the source editor revision or changing active work. The new draft/optional plan/activity/receipt and guard writes commit or roll back together.

The existing detail page has a Duplicate project confirmation form with a copy title, concise scope explanation, Create copy and Cancel copy. It serializes against local edits/rename/planning actions. An unconfirmed request keeps the exact scoped tab command for retry before new work/cancel. A stale source requires explicit reload and review; typed copy title remains. Successful creation navigates to the independent copy, with an explicit open link if navigation is delayed. Incomplete unsaved copy-title typing is not durable across reload/navigation.

### API-09 — `DELETE /api/v1/projects/{projectId}`

**F14c2 queued-work extension (23 October 2026):** GET `/api/v1/projects/{projectId}/deletion-impact`, no query, returns private/no-store `{projectId,projectRevision,workRevision,queuedPlanning,queuedGenerations,canDelete,blockReason}` from one authorized snapshot transaction. It exposes no job IDs, prompts, provider balances, storage descriptors or credentials and performs no writes/provider calls. Missing/foreign/deleted projects return 404, inactive membership 403. Up to 50 queued rows of each domain are eligible; excess/unresolved/malformed work fails closed.

DELETE still accepts the idle legacy query. When eligible queued work exists, a non-acknowledged request fails 409 ACTIVE_WORK_ACK_REQUIRED. After reviewing impact, pass both `acknowledgeActiveWork=true&expectedWorkRevision=<workRevision>` in addition to expectedProjectRevision. Unknown/duplicate fields, false/incomplete acknowledgement and unsafe counters are 400; changed reviewed guard is 409 STALE_WORK. A fresh impact/confirmation is required after change. Safe planning work must be queued, attempt zero, submission none, unowned/unleased and never started, with no stage attempt. Safe generation must be queued with zero submissions, no owner/lease/start/artifact, zero or absent legacy lease epoch, initial or absent stage, no speech attempt and no uncertain/settled hold. An idle-looking pointer with missing/unrelated work refuses deletion.

In the same transaction as tombstone/receipt/event/member/project fences, eligible planning jobs and generation runs become cancelled with advanced status revisions and terminal timestamps; their project pointers clear. Only an unused reserved speech hold is closed using existing accounting rules; allowance is credited only for the same configuration/period with a known bounded remaining value. No planning budget refund, operator re-enable, network call, slot release or running-work cancellation. Receipt failure rolls cancellation/accounting back. Worker claim contends on the same run/job/project writes and rechecks state after retry. Running/uncertain/previously-started work, unstored renders, unfinished storage and publishing remain blockers even with acknowledgement. This supersedes F14c1's blanket queued-work refusal only. Response/receipt remains retained/null-cleanup-job; physical cleanup remains the next increment. The confirmation fetches current counts, requires a separate queued-work checkbox, serializes local actions and recovers the exact acknowledged command.

**F14c1 implemented subset (23 October 2026):** bodyless authenticated same-origin DELETE accepts exactly one positive safe `expectedProjectRevision` query and a UUID Idempotency-Key. If-Match, unknown/duplicate query fields and bodies are rejected. Active/uncertain planning, active generation pointers/runs, unstored local renders and pending/uploading/failed storage refuse with 409 PROJECT_WORK_UNRESOLVED, even after lease expiry. There is no acknowledgeActiveWork bypass in this increment. Current project revision must match; stale input returns 409 STALE_REVISION. No providers or storage operations run in the handler.

202 data is `{projectId,accessRemoved:true,cleanupState:"retained",cleanupJobId:null,externalPublicationState:"none_pending",message:"Project removed from team access. Files and records are retained; physical cleanup is not implemented yet."}`. This is an access-removal tombstone, not proof of physical erasure or an executing cleanup task. The transaction advances editor/guard revisions, fences membership, writes one sanitized event and a permanent actor/project/key-scoped minimal receipt. Replay returns the original 202 result with Idempotency-Replayed:true before freshness checks but after current membership; changed payload/key use fails 409. Another key against a tombstone returns 404. Original source-content command receipts cannot bypass the live-project checks.

GET `/api/v1/projects/{projectId}/deletion` (no query) returns only that coarse receipt to current team members; live/missing/foreign projects return 404. Ordinary project/plan/video reads remain 404 after deletion. The protected project page can display the same minimal deletion result, which recovers a lost acknowledgement without resurfacing source content. Unknown deletion commands retain their original key/revision in scoped tab recovery. Physical R2/local/content cleanup, cancellation of unstarted work and active-publication reconciliation remain F14c2/later integration. The following paragraph/example is the broader target contract, not deployed cancellation/cleanup behavior.

No body. Require query `expectedProjectRevision`; optional query `acknowledgeActiveWork=true` only when live job/schedule impact was shown. Otherwise return `409 ACTIVE_WORK_ACK_REQUIRED` with safe affected counts. Requires idempotency key. Example: `DELETE /api/v1/projects/{projectId}?expectedProjectRevision=12&acknowledgeActiveWork=true`.

**202 data:**

```json
{"projectId":"20000000-0000-4000-8000-000000000001","accessRemoved":true,"cleanupState":"pending","cleanupJobId":"40000000-0000-4000-8000-000000000009","externalPublicationState":"none_pending","message":"Project hidden. Associated unreferenced files will be removed."}
```

A gated/uncertain publication reports `externalPublicationState:"checking"` and preserves reconciliation. No claim that deletion retracts an Instagram post or revokes every issued URL. New ordinary project/media reads return 404. Current members may poll this specific cleanup job for coarse deletion status; it returns no deleted titles, prompts, media links, or credentials. A repeated same delete command returns its minimal receipt, not restored project content.

### API-10 — `GET /api/v1/projects/{projectId}/messages`

Query `limit,cursor`; order ascending immutable sequence. **200 data:** `{items:Message[],page}`. Message IDs and sequence preserve a bounded conversation cutoff for AI requests. User cannot request raw system prompts/provider debug traces.

### API-11 — `POST /api/v1/projects/{projectId}/messages`

Request `{"text":"Make the explanation suitable for a 12-year-old."}`; 1–2,000 graphemes. **201 data:**

```json
{"id":"21000000-0000-4000-8000-000000000001","projectId":"20000000-0000-4000-8000-000000000001","sequence":1,"role":"user","text":"Make the explanation suitable for a 12-year-old.","createdAt":"2026-10-20T08:32:00.000Z","actor":{"id":"user_example_1","name":"Team member"},"relatedJobId":null}
```

Append a message only; no automatic external work or role selection. Planning/revision commands can reference an existing user message by ID instead of duplicating its text. Reject simultaneous `messageId` and `changeRequest` in those commands. A new message alone does not mutate an approved video.

## 11. Planning and version review

### API-12 — `POST /api/v1/projects/{projectId}/brainstorm`

Request `{expectedProjectRevision}`; uses saved brief/settings and recorded conversation cutoff. **202 data:** AcceptedJob with `kind:"brainstorm"`, source brief revision, status URL. On ready, `Job.result` contains exactly three angles. Select an angle through API-07. Empty/broad ideas are handled visibly; no random topic from empty input. Unknown free provider access → 503 before work acceptance, or persisted paused state if availability changes after acceptance.

### API-13 — `POST /api/v1/projects/{projectId}/plans`

Request `{expectedProjectRevision}`; optionally `conversationThroughSequence` bounded by actual saved messages. Server snapshots current saved input and conversation cutoff. **202 data:**

```json
{"jobId":"40000000-0000-4000-8000-000000000001","kind":"plan","state":"queued","statusUrl":"/api/v1/jobs/40000000-0000-4000-8000-000000000001","sourceBriefRevision":1,"pollAfterSeconds":3}
```

Latest planning request ID + source brief revision guard the resulting current pointer. Newer requests supersede older ones. No result silently overwrites edits or starts rendering. Planning estimates are not final speech timings.

Planning refusal handling (local MVP, 22 October 2026): named WORKER_UNAVAILABLE/503 and FREE_ALLOWANCE_UNAVAILABLE/503 are definitive pre-write admission refusals, after exact receipt replay and before job/receipt creation. The client retains the brief but releases the refused command so editing and retry remain possible. Other 5xx/transport failures and 401 can hide an accepted command and retain its exact key/body for recovery. Refresh availability updates provider metadata; a fresh operator observation of the actual API project's/model's free quota is separately required.

### API-14 — `POST /api/v1/projects/{projectId}/revisions`

Required `expectedProjectRevision`, exactly one `basePlanVersionId` or `baseVideoVersionId`, and exactly one `changeRequest` or saved `messageId`. Optional settings replacement only when explicitly requested by the user. Example:

```json
{"expectedProjectRevision":5,"baseVideoVersionId":"60000000-0000-4000-8000-000000000001","changeRequest":"Shorten the introduction and use a simpler example."}
```

**202 data:** AcceptedJob `kind:"revision"`; ready result identifies a new `PlanVersion` with parent/provenance and change summary. Old ready output and existing schedule remain unchanged. Unsupported request yields a supported alternative in proposal/review notes or actionable failure. No implicit approval/regeneration.

### API-15 — `GET /api/v1/projects/{projectId}/versions`

Required `kind=plan|video`; optional `limit,cursor`. **200 data:** `{items:PlanVersionSummary[]|VideoVersionSummary[],page}` for the selected kind. Plan summaries include eligibility/current/approved indicators; video summaries include ready media metadata and usage policy. Neither kind includes expiring URLs; fetch full version separately.

### API-16 — `GET /api/v1/plans/{planVersionId}`

**200 data:** `PlanVersion` from section 8. `plan` contains the full selected-language narration and scene plan; `settingsSnapshot` and server `inputHash` are returned for approval. `isCurrent`, `canGenerate`, and blocked reasons are computed under current project/provider status, not stored inside immutable plan content.

Example response fields for review (projection, full schema in section 8 and DB section 5):

```json
{
  "id":"30000000-0000-4000-8000-000000000001",
  "projectId":"20000000-0000-4000-8000-000000000001",
  "versionNumber":1,
  "sourceBriefRevision":1,
  "inputHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "isCurrent":true,
  "canGenerate":true,
  "blockedReasons":[],
  "reviewNotes":[{"id":"review-1","severity":"warning","message":"Review unfamiliar names and Telugu pronunciation."}]
}
```

Plan-local narration/scene/reference IDs are validated stable strings, not globally addressable resource UUIDs. Proposed native-word anchors without verified timing remain planning references until normalization; invalid/unsupported props cannot be approved as renderable.

### API-17 — `POST /api/v1/plans/{planVersionId}/edits`

Request `{expectedProjectRevision, edits}`; edits support optional `onVideoTitle`, `narration:[{segmentId,text,pronunciation?}]`, and complete `settings` replacement. Only existing segment IDs can be directly edited; structural scene requests use API-14. Example:

```json
{"expectedProjectRevision":3,"edits":{"narration":[{"segmentId":"intro-a","text":"నీరు భూమి, ఆకాశం మధ్య ప్రయాణిస్తుంది."}]}}
```

**201 data:** new `PlanVersion` plus `projectRevision` and change summary. Server derives matching captions, recalculates estimates/dependency validity, resolves settings and anchor references. If a changed segment invalidates an unsupported word anchor/layout, return 422 or mark a proposal blocked until reviewed replanning; never silently reuse incorrect timing or executable scene code. Previous approvals remain historical and do not apply to the new plan.

## 12. Generation and jobs

### API-18 — `POST /api/v1/projects/{projectId}/generations`

This button is **Approve & generate video**. Request fields all required:

```json
{"expectedProjectRevision":3,"planVersionId":"30000000-0000-4000-8000-000000000001","generationInputHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
```

Check current saved proposal/source brief/settings hash, supported language/voice/assets, access/usage policy, worker capability, and known budget pause. Persist approval, input pins, logical run, queue job, command result/activity atomically. **202 data:**

```json
{"generationRunId":"50000000-0000-4000-8000-000000000001","jobId":"40000000-0000-4000-8000-000000000002","kind":"generation","state":"queued","statusUrl":"/api/v1/jobs/40000000-0000-4000-8000-000000000002","pollAfterSeconds":3}
```

Duplicate approval of the same saved version/hash returns its existing run, including a failed/ready run, rather than silently generating again. A definite failed stage uses API-21. Another voice/take/settings requires a new reviewed snapshot. Voice availability changes cannot silently alter the approved input.

### API-19 — `GET /api/v1/jobs/{jobId}`

No body/query. **200 data — generation job example:**

```json
{
  "id":"40000000-0000-4000-8000-000000000002",
  "kind":"generation",
  "projectId":"20000000-0000-4000-8000-000000000001",
  "state":"running",
  "statusRevision":8,
  "stage":"render",
  "progress":{"stage":"render","percent":45,"source":"renderer"},
  "queuePosition":null,
  "createdAt":"2026-10-20T08:35:00.000Z",
  "startedAt":"2026-10-20T08:35:02.000Z",
  "updatedAt":"2026-10-20T08:36:00.000Z",
  "finishedAt":null,
  "result":null,
  "error":null,
  "allowedActions":["cancel"]
}
```

For speech/planning, `progress:null` is valid. Stage names: `plan_validation`, `speech`, `alignment`, `captioning`, `compile`, `render`, `media_validation`, `persistence`, plus kind-specific `planning`, `upload_validation`, `reconciliation`, `cleanup`. No invented whole-pipeline percentage or exact completion estimate. Queue position is advisory. Finished state returns the typed result or safe error.

Generic job states: `queued`, `running`, `waiting_retry`, `paused`, `validating`, `ready`, `failed`, `cancellation_requested`, `cancelled`, `superseded`. For non-generation tasks, `ready` means their typed task result is available; it does not mean a video or Instagram post exists.

Only user-facing planning/generation/caption/upload/reconciliation jobs and a minimal authorized cleanup receipt are exposed here. Internal token-refresh and publishing-dispatch jobs are not generic browser-readable/cancelable resources; use connection/intent endpoints for their safe public state. Unknown/internal task IDs return non-enumerating 404.

### API-20 — `POST /api/v1/jobs/{jobId}/cancel`

Request `{expectedRevision}` matches `statusRevision`. Heartbeats alone do not advance this revision; actual visible state/stage changes may. **200 data:** `{jobId,state:"cancelled",cancellationConfirmed:true}` for unclaimed work. **202 data:** `{jobId,state:"cancellation_requested",cancellationConfirmed:false,statusUrl}` for in-flight generation/planning.

Allowed only for cancelable creation/upload jobs; publication uses its intent cancellation endpoint. Ready output is not deleted by cancelling a terminal job. Return 409 INVALID_STATE for a non-cancelable task/terminal state. Aborting a submitted provider call is best effort and does not guarantee restored allowance.

### API-21 — `POST /api/v1/jobs/{jobId}/retry`

Request `{expectedRevision}`. **202 data:** AcceptedJob for the same logical job/run with a new attempt and unchanged immutable input. Permit only definite retryable failures/explicitly resumable pauses. Uncertain provider consumption requires recorded recovery/resolution; `needs_plan_revision`, cancelled/deleted input, unresolved publish, and changed settings are not generic retries. Recheck current allowance/access and preserve valid audio/checkpoints.

### API-22 — `GET /api/v1/videos/{videoVersionId}`

**200 data:** full `VideoVersion`; example key fields below are a projection:

```json
{
  "id":"60000000-0000-4000-8000-000000000001",
  "projectId":"20000000-0000-4000-8000-000000000001",
  "versionNumber":1,
  "planVersionId":"30000000-0000-4000-8000-000000000001",
  "generationRunId":"50000000-0000-4000-8000-000000000001",
  "language":"te","captionLanguage":"te","narrator":"Alice",
  "usagePolicy":"evaluation_only",
  "media":{"width":1080,"height":1920,"fps":30,"durationSeconds":31.701,"videoCodec":"h264","audioCodec":"aac","audioSampleRate":48000},
  "assets":{"mp4":{"id":"70000000-0000-4000-8000-000000000001","kind":"mp4","mimeType":"video/mp4","sizeBytes":1541813,"availability":"available"}},
  "transcript":[{"segmentId":"intro-a","text":"నీరు భూమి, ఆకాశం మధ్య ప్రయాణిస్తుంది.","startSeconds":0.367,"endSeconds":3.633}],
  "capabilities":{"download":true,"publish":false,"publishBlockedReason":"MEDIA_USAGE_RESTRICTED"},
  "readyAt":"2026-10-20T08:40:00.000Z"
}
```

Full response assets also identify poster, SRT, and transcript/manifest access where permitted; full transcript covers every segment. No arbitrary local files/provider payloads are exposed. Missing stored bytes can disable access without rewriting the immutable video version or silently rerendering it. Request playback through API-23.

## 13. Media access and uploads

### API-23 — `POST /api/v1/assets/{assetId}/access`

Request: `purpose=playback|download|sample|preview` and the authorized owning context, e.g. `videoVersionId`, `brandKitRevisionId`, or `voiceCatalogId`; exactly one valid context. Example:

```json
{"purpose":"download","videoVersionId":"60000000-0000-4000-8000-000000000001"}
```

**200 data:**

```json
{"assetId":"70000000-0000-4000-8000-000000000001","url":"https://example.invalid/temporary-object-url","method":"GET","expiresAt":"2026-10-20T08:45:00.000Z","filename":"water-cycle-te-v1.mp4","mimeType":"video/mp4","sizeBytes":1541813}
```

Proposed lifetimes: download 5 minutes, playback/sample/preview up to 15 minutes. These URLs are never stored as project state or logged with query strings. Context must actually pin the asset and be visible in this workspace; a correct UUID alone is insufficient. User downloads do not require Instagram connection. Restricted-use assets expose their notice; allowed internal evaluation download does not imply publication rights.

Actual R2 response is bytes, not JSON, with appropriate content type/disposition, `GET`/`HEAD` and tested byte ranges. Expired links → request new authorized access, preserve seek position. Use supported S3 presigned host and configured CORS; do not expose the bucket. [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)

### API-24 — `POST /api/v1/uploads`

**F13b3 implementation boundary (22 October 2026):** the generic reservation/signed-PUT/background-finalize APIs 24–26 below remain planned. The local team MVP currently prepares logos synchronously through authenticated server-mediated routes, so raw untrusted bytes are never stored in R2 and no browser receives a bucket key or upload permission:

- `PUT /api/v1/workspace/logo-uploads/{uploadId}`: client UUID also supplied as `Idempotency-Key`; canonical mutation Origin/Host, no query/If-Match. Raw PNG/JPEG/WebP bytes, uncompressed, <=5,000,000 bytes, bounded streaming read (30 seconds). Headers: exact `Content-Type`, `X-Logo-Filename` (encodeURIComponent of plain <=120-character filename), `X-Logo-Sha256` (lowercase SHA256). Actual byte length/hash determine the stable command identity together with filename/type; reuse with different metadata fails 409. Auth and origin checks precede body reading. Header/body validation failures return 400/413/415/422 without claiming an upload. Decode failures persist a terminal rejected receipt and return 200 data with state rejected, not a usable asset. Unknown storage/commit outcomes return safe 503; retain the same ID/file and check status before retrying.
- `GET /api/v1/workspace/logo-uploads/{uploadId}`: current active membership plus creator/workspace scope. 200 data `{id,state,filename,expiresAt,retryAfterSeconds,assetId,previewUrl,error}`. States are validating/ready/rejected/expired; ready alone returns an asset ID and same-origin private preview URL. Missing/foreign receipts return 404; no implicit new upload or extended expiry. Initial lost request may have no receipt; reselect/retry the original file/ID. A live lease returns UPLOAD_BUSY/409 on PUT. Lease expiry permits a fenced deterministic retry of the same file, not a new logical upload. Unfinished uploads expire 15 minutes after creation; ready/rejected receipts remain retained. Client stores ID and metadata in scoped sessionStorage, not file bytes; reload may require reselecting the original file.
- `GET /api/v1/workspace/logo-assets/{assetId}`: active shared-team access, available asset and ready owning upload required, rechecked after R2 read. Returns only verified canonical PNG bytes with private/no-store, nosniff and restrictive image CSP. No signing/public URL. Filename is display metadata, never a storage path. F13b4 permits prepared logo IDs in immutable brand revisions, with transactional ownership guards described in API-29/30.

Full signature/decoder/dimension checks accept only still PNG/JPEG/WebP within 4096x4096; obvious trailing payloads, APNG, wrong formats and incomplete content are refused. Pixels are rotated for orientation, scaled inside 1024x1024 without enlargement, re-encoded as metadata-free sRGB PNG preserving proportions/alpha, and bounded to 5 MB. The exact canonical descriptor is persisted before a create-only R2 PUT and verified read-back. A 90-second owner/epoch lease and final membership fence prevent late owners or revoked users from making an asset ready. Only canonical bytes reach a fresh server-derived immutable key. No external write occurs inside a database transaction. Actual deployment must reconcile the 5 MB app limit with hosting request-body/time limits; this local milestone is not Vercel deployment acceptance.

Logo-only V1 upload reservation. Request required `{purpose:"brand_logo",filename,contentType,sizeBytes,sha256}`; content type PNG/JPEG/WebP, checksum lowercase 64-hex, size 1–5,000,000 bytes. Filename is display metadata, never an object key/path.

```json
{"purpose":"brand_logo","filename":"team-logo.png","contentType":"image/png","sizeBytes":18432,"sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}
```

**201 data:**

```json
{"id":"71000000-0000-4000-8000-000000000001","state":"reserved","upload":{"method":"PUT","url":"https://example.invalid/reserved-upload-url","requiredHeaders":{"Content-Type":"image/png"},"expiresAt":"2026-10-20T08:45:00.000Z"},"assetId":null,"validationJobId":null,"expiresAt":"2026-10-21T08:30:00.000Z"}
```

Temporary PUT URL expires after proposed 15 minutes; reserved receipt has a separate cleanup expiry. Direct upload is not yet a validated/brand-selectable asset. Untrusted declared length/checksum/type are checked independently after upload. No arbitrary SVG/font/video/file uploads in V1.

### API-25 — `GET /api/v1/uploads/{uploadId}`

**200 data:** `Upload`, with state `reserved|validating|ready|rejected|expired`, safe failure, and asset/validation job IDs where present. This companion status route refines the architecture inventory so a reload can recover a pending upload. It never returns a new PUT URL automatically after expiry or reveals an R2 key. A new reservation is explicit; expired receipt → `state:"expired"` while retained, then 404 after cleanup.

### API-26 — `POST /api/v1/uploads/{uploadId}/finalize`

Request `{}` with idempotency key. **202 data:** `{uploadId,state:"validating",jobId,statusUrl,pollAfterSeconds:3}`. Atomically enqueue decoded-content verification; compare actual size/hash, signature, decoder success, dimensions and decompression limits. Decode/read one bounded byte snapshot and write validated canonical bytes to a distinct immutable asset key, so a still-live PUT URL cannot overwrite an approved logo. On success, `Upload.assetId` identifies that validated asset, then brand revision can reference it. Invalid bytes → job/receipt rejected, not a successful logo. Duplicate finalize returns the same validation job/result. Missing object → 409 UPLOAD_NOT_READY; invalid/expired state → 409/422.

## 14. Workspace settings and brand

### API-27 — `GET /api/v1/workspace/settings`

**200 data:** shared default preferences, `revision`, current brand revision ID, timezone, and safe configurable catalog IDs. Example:

```json
{"revision":1,"timezone":"Asia/Kolkata","defaults":{"language":"en","targetSeconds":60,"preferredAccentId":"indian","preferredVoiceCatalogId":null,"themeId":"clean-educational-v1","captionStyleId":"readable-default-v1"},"brandKitRevisionId":null}
```

No API-key editor, allowlist, token values, billing state, or customer generation allowance is included. Defaults do not silently claim an unavailable narrator is usable.

### API-28 — `PATCH /api/v1/workspace/settings`

Request `{expectedRevision,patch}`; patch accepts timezone and complete `defaults` replacement, no privileged configuration. **200 data:** API-27 model with next revision. Validate timezone, language, duration, supported style, and voice/accent when nonnull. Existing projects, ready versions, and schedule instants remain unchanged. Stale edit → 409. Shared settings are editable by active members; operator-only secrets stay outside this API.

### API-29 — `GET /api/v1/workspace/brand`

**Implemented F13b1–4 boundary (22 October 2026):** GET/PUT persist and preview a shared palette. F13b2 now captures an optional immutable brand revision in project settings and compiles its exact palette into approval/render snapshots; F13b3 prepares canonical private logos and F13b4 attaches them to brand revisions and video inputs. Newly loaded composers capture the current workspace revision and offer a branding opt-out. Existing/open/recovered drafts keep their captured revision or legacy null; creation retries never re-resolve workspace defaults. Current curated IDs are `inter-latin-400`, `noto-sans-telugu-400`, `clean-educational-v1`; `logoAssetId` is null or a UUID of an available, ready, same-workspace prepared logo. Unsupported asset/font/theme inputs fail 422. Both primary and secondary diagram strokes require contrast >=3:1 against the background. Preview label text stays on the background and deterministically chooses black or white (>=4.5:1); no input colors are silently substituted. Three colors are complete six-digit hex values normalized uppercase before hashing/saving. A revision is created only on an intentional save, including the first save of the sample palette.

Both endpoints require active shared membership and private/no-store responses. No query parameters or If-Match. PUT requires canonical Origin, JSON within the standard project body limit, UUID Idempotency-Key and nonnegative safe-integer `expectedRevision` (missing 428). `{expectedRevision,brandKit}` is a complete replacement; unknown fields 400, invalid or unchanged kit 422, stale revision/key mismatch 409. PUT returns 201 on original and replay with `Idempotency-Replayed`; `createdBy` is `{id:userId}`, `createdAt` ISO UTC. Original snapshot replay precedes current revision checks but never current access checks. Normalized equivalent hex case has the same request identity. Receipts have no TTL. The client retains the original body/key on transport, 401 or ambiguous server failure and explicitly retries the same save. Definite conflicts keep edited colors until explicit Reload. Unsaved incomplete palette typing is not a durable draft.

**200 data:** `{revision:0,brandKit:null}` before setup; otherwise current immutable brand-kit revision with id/revision, colors, logo asset nullable, curated font/theme IDs, creator/time. No arbitrary unvalidated CSS/font URLs. PlanVersion.settingsSnapshot retains the captured immutable brand revision ID; canonical render/approval input embeds its full resolved colors and font checksums. Historical plans resolve that retained revision, never the current workspace pointer. Brand revisions therefore remain retained; cleanup must not delete referenced kits.

F13b4 adds authenticated private/no-store `GET /api/v1/workspace/logo-assets` (no query/If-Match), returning `{items:[{id,filename,width,height,previewUrl}],hasMore}`. The picker is deliberately bounded to the newest 50 available assets, ordered createdAt DESC/_id DESC; its currently saved choice remains selectable even outside this window. No unbounded library or pagination cursor is implemented in this MVP slice. Creator identity, R2 paths/config/bucket and raw provider errors are excluded. A prepared upload refreshes the in-page picker; it never silently changes the draft selection.

### API-30 — `PUT /api/v1/workspace/brand`

Request `{expectedRevision,brandKit}` replaces the current kit by creating a new immutable revision. Example:

```json
{"expectedRevision":0,"brandKit":{"logoAssetId":null,"primaryColor":"#3660D9","secondaryColor":"#173342","backgroundColor":"#F5F3EB","englishFontId":"inter-latin-400","teluguFontId":"noto-sans-telugu-400","themeId":"clean-educational-v1"}}
```

**201 data:** `{revision:1,brandKit:{id,revision:1,logoAssetId:null,primaryColor,secondaryColor,backgroundColor,englishFontId,teluguFontId,themeId,createdAt,createdBy}}`, with actual values, not shorthand property names. Validate decoded available logo, same-workspace refs, contrast/readability, and curated fonts. If layout/contrast would be invalid, return 422 with supported correction, not silently different approved branding. Explicit null removes the logo in the new revision; old pinned assets remain. F13b4 atomically adds a brand owner pin with asset lifecycle/reference guards, the immutable kit, workspace CAS, receipt and activity. Missing/foreign/unready/unavailable logos return 422 LOGO_UNAVAILABLE; exact receipt replay still precedes asset availability checks. A logo-only change is a valid save. Captured project/plan revisions resolve their pinned asset, and approval snapshots include only exact {assetId,sha256,size,width,height,contentType:"image/png"}, never a URL or storage address. Generation admission pins the asset to the new run in the same transaction as approval/reservation. It requires render:brand-logo-v1 capability; workers verify actual private bytes before any speech submission. Check video plan displays the captured logo and dimensions. Logos retain their aspect ratio/alpha in a fixed 180x96 header area; the title is measured in a separate 720px column. No-logo inputs/layout/hashes remain unchanged. Logo changes affect video hashes but do not invalidate matching speech identity. No automatic regeneration or retroactive workspace updates.

## 15. Instagram connection

### API-31 — `GET /api/v1/integrations/instagram`

**200 data:**

```json
{"id":null,"revision":0,"generation":0,"status":"disconnected","account":null,"expiresAt":null,"healthCheckedAt":null,"affectedIntentCount":0,"allowedActions":["connect"]}
```

Connected `account` is `{id,handle,type:business|creator}`; no personal account eligibility promise. Safe expiry/permissions status may be shown; tokens and full provider account rows are never returned. Account ID is an opaque string. One shared connection affects all teammates.

### API-32 — `POST /api/v1/integrations/instagram/connect`

Request `{expectedRevision,returnPath,mode:"connect"|"reconnect"|"replace"}`; returnPath must be a validated relative project/settings route. Replace additionally requires `acknowledgeAffectedSchedules:true`. **200 data:** `{authorizationUrl,expiresAt,connectionRevision}` for the official flow. Exact callback/scopes/host/version are server-configured after provider verification; browser cannot submit them.

State is random, hashed at rest, single-use, ten-minute proposed expiry, bound to member/session/workspace and expected connection revision. This endpoint does not set Connected or publish. An existing in-progress flow may be restarted with a new logical action; replaying the same key returns the same still-valid flow, otherwise 409 OAUTH_FLOW_EXPIRED with restart guidance.

### API-33 — `GET /api/integrations/instagram/callback`

External query contains provider `code,state` or denied/error result; never a user-supplied access token. Verify state, session/current membership, expiry, one-time consumption, safe return path, connection revision, granted scopes and account identity. Exchange credentials server-side and encrypt them. No JSON success envelope: return `303` to the validated app route with a short safe outcome code; no raw token/code/error body in redirect parameters.

Denied/incomplete/expired flow returns to project/settings with retry guidance; saved video stays usable. Reconnected different account cannot satisfy old intent identity. Replacement requires the separate explicit acknowledgement recorded by API-32, and pauses old schedules. Direct login-contract details remain the Meta integration gate in the system design; no mocked callback counts as connected.

### API-34 — `POST /api/v1/integrations/instagram/disconnect`

Request `{expectedRevision,acknowledgeAffectedSchedules:true}`. **200 data:** `{connection:ConnectionSummary,pausedIntentCount,checkingIntentCount}`; status disconnected/needs_reconnection as appropriate. New submissions are blocked by the connection generation guard. In-flight attempts remain checking/reconciling and may require narrow retained credentials until resolved; a disconnect confirmation does not retract a remote post. Missing acknowledgement → 409 ACTIVE_WORK_ACK_REQUIRED. Repeated command returns its prior result.

## 16. Publishing commands

### API-35 — `POST /api/v1/projects/{projectId}/post-caption`

Request `{videoVersionId,tone?}`; optional tone is bounded plain text ≤200 graphemes, not arbitrary model configuration. **202 data:** AcceptedJob `kind:"caption_suggestion"`; result `{videoVersionId,caption,hashtags}` from the approved explanation. Preserve facts/units and selected content language unless user explicitly requests a different post-caption language in a future supported feature. Editing suggested caption does not mutate subtitles/video or authorize posting.

### API-36 — `POST /api/v1/publishing-intents`

Required fields: `creationCommandId`, `projectId`, `videoVersionId`, `expectedConnectionRevision`, `destinationAccountId`, `caption`, `cover`, `dispatch`, `shareToFeed`, `acknowledgePreviousPublication`. Only ready validated versions with permitted use and eligible connected account are accepted. Reject an arbitrary video URL, actor/workspace ID, provider token, or container ID from the browser.

**Schedule request example:**

```json
{
  "creationCommandId":"81000000-0000-4000-8000-000000000001",
  "projectId":"20000000-0000-4000-8000-000000000001",
  "videoVersionId":"60000000-0000-4000-8000-000000000002",
  "expectedConnectionRevision":4,
  "destinationAccountId":"17840000000000001",
  "caption":"A simple explanation of the water cycle.",
  "cover":{"mode":"video_frame","offsetMs":2000,"fallbackAccepted":false},
  "shareToFeed":true,
  "dispatch":{"mode":"schedule","localDateTime":"2026-10-21T10:00:00","timezone":"Asia/Kolkata","utcOffsetMinutes":330},
  "acknowledgePreviousPublication":false
}
```

This example uses a hypothetical publication-permitted video ID, not the existing Alice evaluation asset. For publish-now, dispatch is exactly `{"mode":"now"}`; no supplied past time. Schedule UTC is resolved/validated server-side. Cover offset must be an existing frame within actual video duration; unsupported cover path needs a visible approved fallback before submission.

**201 data:**

```json
{
  "id":"80000000-0000-4000-8000-000000000001",
  "projectId":"20000000-0000-4000-8000-000000000001",
  "creationCommandId":"81000000-0000-4000-8000-000000000001",
  "revision":1,"payloadRevision":1,"state":"scheduled",
  "payload":{
    "videoVersionId":"60000000-0000-4000-8000-000000000002",
    "account":{"id":"17840000000000001","handle":"example_team"},
    "caption":"A simple explanation of the water cycle.",
    "cover":{"mode":"video_frame","offsetMs":2000,"fallbackAccepted":false},
    "shareToFeed":true,
    "dispatch":{"mode":"schedule","scheduledAtUtc":"2026-10-21T04:30:00.000Z","localDateTime":"2026-10-21T10:00:00","timezone":"Asia/Kolkata","utcOffsetMinutes":330}
  },
  "providerMediaId":null,"permalink":null,"error":null,
  "createdAt":"2026-10-20T08:45:00.000Z","updatedAt":"2026-10-20T08:45:00.000Z",
  "allowedActions":["revise","cancel"]
}
```

Publish-now can return `state:"preparing"` with work queued; 201 means the intent exists, not a post exists. Insert immutable payload/approval, active-slot claim, media pins, dispatch job, idempotency result/activity atomically. Double submission with the same creationCommandId returns the same intent. A different creationCommandId while the destination slot is active returns 409 ACTIVE_INTENT_EXISTS with the existing safe ID, even for identical content; the client opens that intent instead of treating the rejected new command as accepted. This avoids an unrecorded command alias becoming a new post after the original resolves.

Previously published same video/account requires `acknowledgePreviousPublication:true` and a new creationCommandId. It does not override an unresolved active intent or permit duplicate guessing. Restricted media → 422 MEDIA_USAGE_RESTRICTED; unavailable always-on scheduler → 503 for schedule mode, preserving download/publish-now independently where eligible.

### API-37 — `GET /api/v1/publishing-intents/{intentId}`

**200 data:** complete `PublishingIntent` shape from API-36 with current immutable payload, actual state, relevant safe timestamps, error/action, and confirmed media ID/link when available. Include `lastAttempt:{phase,outcomeClass,lastCheckedAt}` but no signed fetch URL, token, lease, or full provider response. A new draft/ready video cannot change this payload.

Published with no permalink yet remains `state:"published"` and `permalink:null`; retrieve link separately in worker. A timeout is `reconciling` or `needs_review`, never optimistic Published.

### API-38 — `POST /api/v1/publishing-intents/{intentId}/revisions`

Request `{expectedRevision,patch}`. Allowed patch keys: `videoVersionId`, `caption`, `cover`, `shareToFeed`, `dispatch` (whole union replacement). Account identity cannot be silently changed; switching destination requires resolving/cancelling the old intent and a new explicit approval. Example:

```json
{"expectedRevision":1,"patch":{"dispatch":{"mode":"schedule","localDateTime":"2026-10-22T10:00:00","timezone":"Asia/Kolkata","utcOffsetMinutes":330}}}
```

**200 data:** updated PublishingIntent, next control/payload revisions, new approval snapshot, stale dispatch invalidated and pins updated atomically. Allowed only before submission gate and while no external request outcome is unresolved. Existing completed video is not replaced without an explicit version selection. At/after gate → 409 SUBMISSION_STARTED; current checking state is returned in safe error details.

### API-39 — `POST /api/v1/publishing-intents/{intentId}/cancel`

Request `{expectedRevision}`. **200 data:** `{id,state:"cancelled",revision,cancellationConfirmed:true}` only if no external publish can still occur. **202 data:** `{id,state:"reconciling",revision,cancellationConfirmed:false,message:"Submission has started; checking the actual outcome."}` when a send gate/uncertain request exists. This records cancellation desire but does not cancel remote content or authorize a new intent. Already published → 409 ALREADY_PUBLISHED with safe permalink when known. Never release active slot before a definite resolution.

### API-40 — `POST /api/v1/publishing-intents/{intentId}/resume`

Request `{expectedRevision,expectedConnectionRevision,approvedPayloadRevision}`. **202 data:** updated intent/status URI after confirming same external account, reviewed payload, current rights/media, due time, host and no uncertain old submission. If reconnect changed the binding generation, append a new immutable payload/approval with the same reviewed content and updated same-account binding; do not edit old payload history. Future post returns scheduled; safely due within grace may resume preparing only after explicit review. Past beyond grace → 409 MISSED_SCHEDULE; use a new reviewed now/time revision after resolving old state. A different-account reconnect never resumes it.

### API-41 — `POST /api/v1/publishing-intents/{intentId}/reconcile`

Request `{expectedRevision,evidenceHint?}`; optional evidenceHint `{providerMediaId,reviewNote}` has bounded strings, is untrusted, and triggers verification rather than becoming truth. **202 data:** AcceptedJob `kind:"reconciliation"` and intent ID/state. Query known container/media/account evidence without re-sending publish. Deduplicate active reconciliation work.

If user supplies a candidate media ID, verify account ownership and exact attributable evidence; record any human matching separately from provider confirmation. If evidence remains ambiguous or an old worker may still send, retain Needs review and active slot. No endpoint accepts `forcePublished:true`, user-declared `notPublished:true`, or a raw DB state override. A confidently resolved nonpublication can become cancelled/missed/failed or a reviewed retry under the DB transition rules. Intentional repost requires a new reviewed command after safe resolution.

## 17. Calendar, activity, and operations

### API-42 — `GET /api/v1/calendar`

Query required `from`, `to` UTC timestamps and valid IANA `timezone`; optional `states`, `limit,cursor`. Example: `?from=2026-10-01T00:00:00.000Z&to=2026-11-01T00:00:00.000Z&timezone=Asia%2FKolkata&limit=20`.

**200 data:** `{items:CalendarItem[],page,timezone}`. Item fields: `intentId,projectId,displayTitle` if visible, `videoVersionId,state,scheduledAtUtc,originalTimezone,originalLocalDateTime,originalUtcOffsetMinutes,accountHandle,captionPreview,allowedActions`. Render month/list views from the same data; layout does not change scheduling semantics. Return pinned snapshot title/thumbnail context, not a newly edited draft. Query timezone formats display; it never moves saved instants.

### API-43 — `GET /api/v1/activity`

Query `limit,cursor,projectId?,types?`. **200 data:** `{items:ActivityEvent[],page,readThroughSequence,latestSequence}`. Only bounded current-member-visible content; after deletion retain minimal outcome notices without exposing removed prompts/URLs. System/actor events have stable IDs/dedupe keys and action links. No raw diagnostic logs or expensive global unread-count requirement.

### API-44 — `POST /api/v1/activity/read`

Request `{"throughSequence":42}`; integer must not exceed current workspace event high-water value available to this member. **200 data:** `{"readThroughSequence":42}`. Monotonic per-member update; concurrent reads can only increase it and do not alter shared event history or personal-preferences revision. This is an explicit companion endpoint to support persistent in-app notifications, not email delivery.

### API-45 — `GET /api/v1/operations`

No mutation/query body. **200 data:**

```json
{"worker":{"state":"healthy","lastSeenAt":"2026-10-20T08:45:00.000Z","renderCapacity":1,"activeRenders":0},"providers":[{"id":"elevenlabs","state":"evaluation_only","reasonCode":null}],"queues":{"generationWaiting":0,"publishingNeedsReview":0},"scheduling":{"enabled":false,"reasonCode":"ALWAYS_ON_HOST_UNVERIFIED"}}
```

Values are actual safe operational summaries, not a formal service-level guarantee or customer usage meter. No API key, provider balance per member, ciphertext, host filesystem paths, or public unauthenticated admin controls. Maintenance changes to provider budgets/credentials/allowlist remain operator configuration, not this read endpoint.

## 18. State, retry, and race contracts

### 18.1 Independent public state

| Domain | Public states | Important distinction |
|---|---|---|
| Draft summary | `draft`, `planning`, `plan_ready`, `changes_requested`, `approved` | Derived from current brief/proposal/approval; not the immutable plan's mutable status |
| Job | `queued`, `running`, `waiting_retry`, `paused`, `validating`, `ready`, `failed`, `cancellation_requested`, `cancelled`, `superseded` | Stage status only; non-generation ready result is not a video |
| Generation run | `queued`, `running`, `waiting_retry`, `paused`, `validating`, `ready`, `failed`, `cancellation_requested`, `cancelled`, `needs_plan_revision` | Input remains immutable; a valid older approved render is not silently superseded by a new draft |
| Connection | `disconnected`, `connecting`, `connected`, `refreshing`, `needs_reconnection` | Authorization never posts |
| Publishing | `scheduled`, `preparing`, `uploading`, `publishing`, `reconciling`, `published`, `delayed`, `needs_reconnection`, `needs_review`, `failed`, `missed`, `cancelled` | A ready container is not a confirmed post |
| Upload | `reserved`, `validating`, `ready`, `rejected`, `expired` | Upload bytes are unusable until decoded validation |

Full allowed transitions, guards, writes, leases, asset lifecycle and impossible transitions are in [DATABASE_DESIGN.md](DATABASE_DESIGN.md), section 8. APIs expose `allowedActions` as convenience only; server rechecks every command. They are not a second client-controlled permission system.

### 18.2 High-risk races

| Race | API outcome |
|---|---|
| Save/approve from stale tab | 409; no new approval/job |
| Two approvals of same plan | Same logical run; actor history and no duplicate provider command |
| Old planning response after new brief | Superseded job/result, never current plan |
| Retry network request after committed command | Same key/domain result; no duplicate task |
| Delete/cancel before ready commit | Late output hidden, no project resurrection |
| Expired playback URL | Renew access for existing asset; no rerender |
| New ready video while a post is scheduled | Existing payload unchanged |
| Cancel/disconnect before submission gate | Worker cannot pass stale guards; cancellation/pause confirmed |
| Gate wins first | 202 Checking/reconciling or 409 Submission started, not false cancellation |
| Publish response lost | Read evidence; no generic retry/new intent |
| Worker restarts long after schedule | Missed only when definitely unsubmitted; uncertain requests still reconcile |

### 18.3 Scheduling rules and errors

Server resolves local time+zone+offset to UTC. Nonexistent DST time → `422 INVALID_TIME`; ambiguous time without valid chosen offset → `422 AMBIGUOUS_TIME` with candidate offsets/instants. An inconsistent supplied offset is invalid. Reject past/out-of-horizon schedules and preserve the user's text/time selection in the client.

Default dispatch target is within 60 seconds when healthy; known-safe retries can continue for 15 minutes, showing Delayed. Beyond that, definitely unsubmitted work becomes Missed and needs explicit now/reschedule. In-flight/unknown sends stay in reconciliation beyond the window. Never promise exact Instagram public appearance time or use browser timers as the scheduler.

### 18.4 Automatic versus user retry

Known-safe reads/storage/computation can use bounded retry with backoff. Invalid plans get one structured repair. Unsupported voice/language, forbidden/paid-only access, exhausted free allowance, uncertain provider acceptance, and unsafe publish requests are not automatically looped. Correcting narration/voice creates a new proposal and approval; retry is not permission to mutate the original input.

## 19. Security and provider boundaries

- Library OAuth endpoints/cookies use tested Auth.js protections. Application APIs add current membership, strict origin/CSRF checks, scoped resources and no-store responses.
- Renderer consumes trusted templates and vetted staged assets. No executable model/user code, arbitrary fetch endpoints or unsanitized HTML/SVG.
- Use bounded request parsing, safe Unicode handling, validated filenames/content, literal search, no user Mongo operators, and no unbounded plan/message arrays.
- Signed URLs are narrowly scoped expiring bearer credentials; no API secrets in browser storage, prompts, logs, screenshots or download manifests.
- Worker service identity/leases are not browser session credentials. No public worker callback can set a job Ready from a user-provided file/ID.
- Provider IDs/model availability/usage rights are server catalog controls. No customer billing/credits/subscription API is introduced.
- Persist provider IDs/status evidence but redact headers, signed queries, OAuth codes, credentials and raw bodies. A request ID is for support, not authority.
- Gemini/ElevenLabs keys already present in development do not prove all live planning, native-accent quality, permitted publication, or hosted scheduling gates passed. Retain the system design's independent integration gates.
- Meta container creation, status polling, publication and token refresh are server/worker adapter operations, not proxy endpoints exposing a provider token to the browser. Exact selected API contracts must be pinned and tested before enabling them.

## 20. Verification and Stitch handoff

### 20.1 Contract checks before implementation acceptance

1. Validate each command's strict schema, required/unknown fields, null/patch semantics, grapheme/byte limits, and matching narration/subtitle language.
2. Test 401/403/404 without information leakage, session expiry, allowlist removal, CSRF/origin, authorized signing and secret redaction.
3. Test empty/multiple pages, invalid/wrong-scope/expired cursors, filter binding, concurrent project updates and stable message/activity ordering.
4. Test missing/stale revision, rejection of unsupported conditional headers, conflicting tabs/members, no heartbeat-induced edit conflicts, and command replay after a lost response.
5. Test one generation per immutable version/hash and one unresolved intent per destination; test permanent publication command identity after 24-hour HTTP record expiry.
6. Inject late planning, worker crash, cancellation/deletion, corrupt media, upload/DB split failure and insufficient provider access; preserve old good output.
7. Verify actual R2 byte-range playback/download expiration and decoded logo validation; never accept just a successful PUT.
8. Exercise actual intended Instagram authorization/publication, time/zone/DST handling, stale schedule jobs and unknown publish results. Mocks do not prove deployment/account access.

### 20.2 Stitch checklist

For Projects, workspace, Calendar, Settings and sign-in, map every button to an endpoint ID above. Include empty/loading/saving/conflict/paused/failed/cancel-requested/reconciling/missed/connected/unavailable states. Keep combined plan review and one language selection; no API-stage screens or separate storyboard editor.

The design must show exact video/account/time confirmation, usage/access restrictions, version selection, actor/edit conflict context, post-caption versus subtitle labels, and browser-independent progress. If a design needs a new action/field, update both design documents before code. Your Stitch approval is required before frontend-page implementation.

## 21. Traceability, refinements, and references

### 21.1 Product coverage

| PRD scope | API coverage |
|---|---|
| FR-01 Accounts/shared workspace | Auth.js routes, API-01/02, common authorization |
| FR-02 Projects | API-04–09, API-15/22 |
| FR-03/04 Planning/approval | API-10–18 |
| FR-05 Branding/language/voices | API-03/17/24–30 |
| FR-06/07 Production/revisions | API-14–23, state/retry rules |
| FR-08 Export | API-22/23 |
| FR-09 Instagram | API-31–34 |
| FR-10 Publishing/calendar | API-35–44 |
| FR-11 Persistence/recovery | Common revisions/idempotency, API-19–21, 37–41 |
| FR-12 Internal operations | API-45, provider/capacity pause rules |

All PRD edge cases EC-01–EC-55 are addressed through these groups and the companion DB invariants/transition matrix. There are no billing/checkout, arbitrary state override, public signup, independent subtitle-language, or recurring autonomous publishing endpoints.

### 21.2 Refinements from the high-level system design

| Refinement | Reason |
|---|---|
| Separate project `revision`, `briefRevision`, internal guard counters | Metadata rename/job progress must not accidentally invalidate generation content or race protection |
| Explicit revision preconditions on all V1 mutations; DELETE uses query revision | Aggregate DTOs include live fields/serverTime, so an edit revision is not a strong full-representation ETag; avoid an invalid HTTP validator |
| Permanent publication creationCommandId | External duplicates must remain prevented after temporary idempotency TTL |
| Upload status GET and explicit upload receipt schema | Refresh/reload needs a durable upload/validation state |
| Personal preferences PATCH and per-member activity-read command | Match individual accounts and persistent notices without complex collaboration features |
| Superseded job state | Late planning/stale dispatch becomes a truthful terminal no-op |
| Context-bound media signing | Asset UUID/source project alone is insufficient for duplicated/shared pinned assets |
| Computed action capabilities and separate post/video states | Stitch can show truthful valid controls while the server remains authoritative |

These refine engineering contracts without changing the approved product scope. The corresponding DB decisions are recorded in its change/refinement section.

### 21.3 References

- [PRD](PRD.md), especially sections 5–13 and acceptance AC-01–AC-26.
- [System design](SYSTEM_DESIGN.md), especially sections 6–18 and deployment gates in section 23.
- [Database design](DATABASE_DESIGN.md): persistence schemas, indexes, transitions and transaction recipes.
- [Auth.js Google](https://authjs.dev/getting-started/providers/google) and [MongoDB adapter](https://authjs.dev/getting-started/adapters/mongodb): provider/adapter configuration; exact installed-library forms/cookies remain implementation-tested.
- [HTTP semantics, RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html): preconditions and status semantics.
- [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/): scoped temporary media access.

Primary protocol/vendor references were checked on 20 October 2026. Endpoint names, DTOs, numeric product defaults, and limits here are proposed application contracts, not evidence that future routes are already deployed.
