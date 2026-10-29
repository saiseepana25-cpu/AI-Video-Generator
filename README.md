# VideoCraft

## Live pacing limits

New live videos use measured speech and at most two seconds of added hold per scene, within the existing 30–33/57–63/87–90-second windows. Very short narration now fails with `NARRATION_TOO_SHORT` instead of creating long silent gaps. Expand the plan or choose a shorter supported target, save/check a new version and approve it. The app does not cut/speed up speech or retry automatically; used clips and earlier ready videos remain retained. Restart the generation worker after updating because new approvals require `timing:bounded-holds-v1` and the current build. Pacing is checked after measured audio exists, separately from pre-speech font layout.

`render:diagrams -- --diagnostic` keeps its explicitly offline, non-ready target-fill behavior so the original layout/prototype checks remain runnable. A diagnostic clip is not evidence of live voice/pacing quality or permission to publish.

## Local generation worker recovery

Run `npm run web:generation -- worker` when ready to process already approved work. Temporary idle database failures now get three retries after 2, 4 and 8 seconds; persistent failure stops. Logs use safe structured reason codes. This does not retry a video, speech request, approval or uncertain outcome. Startup/readiness/configuration errors and unresolved failures after claim still stop; inspect retained job/provider status before restarting. Do not clear a rendering lease merely because it expired.

Ctrl+C interrupts polling/backoff and waits for owned processing/heartbeat cleanup. Registry writes use revision fences and bounded driver deadlines; a delayed heartbeat cannot revive a released worker. A stopped instance cannot start polling again. This local loop does not replace deployment supervision, prove the cause of the earlier worker exit or change video pacing. Existing R2 videos remain usable with the generation worker stopped.

## Pre-speech layout safety

The local generation worker measures approved caption/heading/diagram text using pinned fonts before any speech request or reuse. Overflow fails with `TEXT_LAYOUT_EXCEEDED`; unavailable fonts/browser fail with `LAYOUT_CHECK_UNAVAILABLE`. Review, shorten and save/check a new plan version before approving another attempt. Static dashboard checks do not start Chrome or guarantee measured duration. Restart an old generation worker after updating code; admission requires `layout:font-measured-v1` and the current renderer build. Existing stored videos keep their original identity and remain playable.

`npm run test:layout` is an explicit local Chrome/font integration suite for English/Telugu fitting and overflow, with no credentials, AI requests, speech, database or R2 use. The regular root tests remain `npm test`; the runnable root video prototype is unchanged.

## Deleted-project source-retention audit (F14c5c1)

```text
npm.cmd run web:cleanup -- source-audit <deleted-project-id>
```

This operator-only command takes a read-only MongoDB snapshot of a tombstoned project with a deletion receipt. It returns bounded record counts and safe blockers for unresolved/uncertain work, incomplete media/speech checkpoints, unreleased reuse references, copied-plan provenance, inconsistent scope and unknown publishing/asset owners. It emits no source text, canonical input, object address or credential. Each inventory reads at most 201 rows and reports at most 200 plus `truncated`; missing indirect rows beyond that bound cannot turn into a complete assessment. Snapshot/driver errors fail with sanitized CLI output, never a partial success report.

`blocked` means known evidence requires resolution. `review_required` means the bounded checks found no listed blockers; it does **not** mean that content may be purged. Every result says `retainedContent: true` and `purgeImplemented: true`. Counts do not prove physical absence or completed cleanup, and the report is not a reusable authorization token. Global unknown publication payloads or generic asset references conservatively block review even if apparently unrelated, matching the current cleanup boundary. No database/file/R2 write, provider call, guard advance, lease recovery, migration, HTTP endpoint or UI change is involved.

## Guarded source-payload purge (F14c5c2)

After migration **025** is applied and audited, an operator can explicitly run `npm.cmd run web:cleanup -- purge-source <deleted-project-id>`. This is irreversible for the listed source payloads; it is never triggered by the dashboard, deletion command, audit or a background timer. Do not run it against retained QA/user projects merely to test it.

One snapshot transaction re-proves a dated tombstone, resolved ownerless/unleased work, settled accounting, full ready-media/local-render/speech cleanup checkpoints and exact reuse-release receipts. Live/copied/foreign/unknown owners, unresolved usage, started failed/cancelled runs, incomplete proofs or more than 100 rows per inventory refuse without partial erasure. Settled reservation history remains retained and does not itself block purge. This command cannot clean failed/unpromoted/scratch/orphan content or stop an executor.

Eligible projects lose their title/brief/references and current source/media pointers. Scoped planning jobs, plan versions, canonical approvals and ready-video rows are removed. Project-creation/edit/duplicate replay snapshots are redacted while command keys/hashes and identifiers remain. Shared branding, deletion receipts, actor IDs, activity, run/attempt/storage/asset/checkpoint/reuse metadata remain retained. A permanent source_purge_receipts fingerprint receipt supports exact replay and rejects resurrected/changed source payloads. Operator status adds sourceCleanup; source_records_removed covers this listed scope and always reports allDataErased:false. No filesystem/R2/provider action occurs. Other lifecycle cleanup and physical cancellation remain separate work. The read-only audit now advertises purgeImplemented:true without asserting eligibility.


## Retiring obsolete speech-reuse references (F14c5b)

Apply/audit migration **024** and restart app/workers. After deleted-project ready-media and local-render cleanup, an operator can run:

```text
npm.cmd run web:cleanup -- release-reuse <deleted-project-id>
npm.cmd run web:cleanup -- speech <deleted-project-id>
npm.cmd run web:cleanup -- status <deleted-project-id>
```

`release-reuse` commits up to 100 reference-release receipts per call; it does not delete records, files or remote objects. Each consuming run must be an ownerless/unleased completed render in the same deleted workspace/project, with matching artifact, approval, verified local cleanup and settled original speech provenance. Source and target canonical plans must agree with the recorded speech identity. Unresolved work, active/live/missing/foreign/unknown targets, publication payloads, generic owners and source drift refuse release. Cross-project reuse remains unsupported. Failed/unrendered consumers remain retained for a later recovery policy.

Original generation_speech_reuses rows stay unchanged. A permanent speech_reuse_releases receipt fingerprints **every field** of that immutable row and binds workspace/project/source attempt/source run/target run. Only exact matching receipts retire pins. Missing, mismatched or changed reuse evidence continues to block speech removal, even when another reference has been released. More than 200 references on one attempt conservatively retains that file for operator review. Receipt writes and the project guard commit together; replay returns the original release without a second guard change. Release and audio cleanup share the project guard; new reuse must still refuse deleted projects and speech-cleanup checkpoints.

`speech` can now remove verified WAVs whose historical pins all have exact release receipts. It retains the existing source/root/checksum and transaction checks. `status` adds `reuseRelease:{reuseRecords,releaseReceipts,retainedContent:true}` and reports still-effective pins under speechCleanup.pinnedAttempts; receipt counts alone do not certify eligibility. Source/approval/history/attempt/reuse records remain retained as audit/recovery evidence. This supersedes earlier blanket retention of references from deleted completed consumers; source-record purge, scratch/unpromoted/orphan lifecycle and active-executor cancellation remain pending. No public API, automatic cleanup, provider call or paid fallback is added. Existing user audio is not deleted during acceptance tests.

## Unreferenced settled speech cleanup (F14c5a)

Apply/audit migration **023** and restart the app/workers. After owned R2 cleanup and verified local render cleanup, an operator can run:

```text
npm.cmd run web:cleanup -- speech <deleted-project-id>
npm.cmd run web:cleanup -- status <deleted-project-id>
```

`speech` physically removes at most 100 eligible settled attempt WAVs. It requires the same canonical repository root as the completed local-render checkpoint, a tombstoned project, resolved work, an ownerless/unleased completed render, matching approval/artifact/input/provider identity and **no surviving speech-reuse or generic asset reference**. Even references from other deleted projects retain audio; this step does not release pins. Unknown publication payloads refuse cleanup. Submitted/uncertain/refused attempts, failed/unpromoted runs, untracked files and source records remain retained. A zero processed count is not proof of erasure.

Each file is exactly `output/dashboard-speech/<run UUID>/<attempt UUID>.wav`, bounded and verified against the settled attempt's original SHA256/byteLength. Initial missing or changed bytes refuse checkpointing. A permanent task captures identity/root before I/O; partial failure or lost final acknowledgement resumes the same file, accepting absence only on that checkpoint path. Changed provenance/root, hard links and symlink/junction traversal refuse removal. No recursive/prefix deletion, directory removal or source-record purge. This uses the trusted local filesystem boundary described below.

`status` additionally reports `speechCleanup` settled/pinned/removed/pending/retry attempt counts without file locations or credentials. Pinned counts cover speech-reuse references, not every possible retained reason, and are not an eligibility calculation. New reuse checks for any cleanup checkpoint before reading audio and again when accepting a pin. The same project guard serializes cleanup and current same-project reuse acceptance; cross-project reuse remains unsupported. Future pin writers must honor that guard and refuse cleanup-checkpointed attempts. No inference, speech submission, paid fallback or automatic cleanup is introduced.

This supersedes earlier statements that all speech files remain retained: **referenced speech and all source/history/approval/attempt/reuse metadata still remain retained**. Releasing reuse pins/source payloads, scratch/unpromoted/orphan cleanup and active-executor cancellation are separate future increments.

## Verified local render cleanup (F14c4)

Apply/audit migration **022** before restarting the dashboard and workers. After ready-media cleanup has confirmed removal of all five owned R2 objects, the operator can run:

```text
npm.cmd run web:cleanup -- local <deleted-project-id>
npm.cmd run web:cleanup -- status <deleted-project-id>
```

`local` physically removes verified completed render files, up to 100 bundles per invocation. It requires a tombstoned project, resolved work, terminal render ownership and matching completed artifact/stored bundle/ready-video/deleted-asset receipts. It does not contact R2 or providers. Run from the repository root using the script; the web script resolves the canonical repository root. Moving the repository after a checkpoint changes its root fingerprint and requires review rather than silently resuming elsewhere.

The five core files must match their recorded SHA256/size; the manifest must match the completed artifact. An optional narration copy must match the manifest audio hash. Existing scene previews are bounded and checkpointed. Only the fixed filenames inside `output/dashboard-renders/<run UUID>/<artifact UUID>/` are eligible. Unknown files, empty directories, reusable `output/dashboard-speech` audio, `.cache/selected-renderer` scratch, source/history/approval records, branding and unpromoted/orphan output remain retained. This supersedes the earlier F14c3 statement that every local render file is retained; full erasure remains pending.

Before unlinking, an immutable inventory is checkpointed with root fingerprint and a project guard write. Partial failures or lost final acknowledgements retry that inventory; already absent files are accepted only on the checkpoint path. Replaced bytes, hard links, symlink/junction ancestors or changed provenance refuse cleanup. No recursive or prefix deletion occurs. This assumes a trusted operator filesystem and immutable completed outputs: arbitrary hostile concurrent filesystem mutation is outside the local MVP's boundary. Stop other local file-management tools before cleanup. `status` and the protected deletion page show local bundle counts separately from ready-media progress; neither exposes local paths or claims all data erased. Physical deletion is exercised only on disposable test fixtures, not existing user outputs.

## Ready-media cleanup for deleted projects (F14c3)

Apply migration 021 with `npm.cmd run web:db:migrate`, then audit with `npm.cmd run web:db:check`. The dashboard does **not** start cleanup automatically. The operator-local commands are:

```text
npm.cmd run web:cleanup -- status <deleted-project-id>
npm.cmd run web:cleanup -- project <deleted-project-id>
npm.cmd run web:cleanup -- worker
```

`status` reads coarse owned-ready-asset counts without R2 credentials/network access. `project` processes at most 100 eligible assets in the configured R2 destination; run status afterward and repeat for larger histories. `worker` polls every five seconds; Ctrl+C finishes the current bounded operation and stops. These commands physically remove eligible ready-video objects for **already deleted** projects, including MP4/SRT/input/timing/manifest; they are not dry runs. Use the existing server-only R2 settings and object deletion permission. No operator command creates a project tombstone or bypasses active work/reference checks.

Each object must match the deleted project's exact ready-video/bundle/run/key/config identity and have no surviving/unknown owner. A transaction releases that ready owner's reference, writes `deleting` under the shared reference guard and checkpoints the exact descriptor. The worker deletes only that key and requires missing-object HEAD; then asset/task finalization commits together. Unknown/failed deletion or lost metadata acknowledgement retries the same immutable key, never uploads/renders replacements. Durable remote-failure retries back off 60 seconds; invalid ownership/configuration is refused and discovery backs off that asset in memory for 60 seconds. Logs are sanitized. Concurrent workers may issue the same deterministic idempotent removal; reference revisions fence their metadata finalization. There is no lease-based render takeover.

The configured endpoint/bucket/access-key identity must match the stored configuration fingerprint. Changed destination/identity, active or uncertain work, shared/aliased references and publication payloads require operator review rather than automatic deletion. Generic future pin writers must use the asset guard and refuse deleting/deleted. Migration 021 supports the current sole ready-video owner; it does not implement a general shared-media reference framework.

The deleted-project page and receipt GET show current owned ready-media progress separately from immutable delete-command receipts. **Local speech/render files, source/approval/history records, shared branding/logos, stored-but-unpromoted bundles and orphan objects remain retained.** `ready_media_removed` confirms only owned ready files; `no_ready_media` does not establish that a project has no other data. Active-executor cancellation and broader cleanup remain pending. Unit/isolated-database tests use stubbed storage; no real R2 deletion acceptance has been performed for this increment.

## Shared workspace defaults (F13a)

Settings now saves the team's default English/Telugu language, 30/60/90-second length, separate verified voice/accent and IANA timezone. Both voice controls can stay unselected. Saves require the current workspace revision and preserve the exact command if the outcome is unconfirmed; Check same settings save resolves it. Reload saved settings replaces unsaved form edits. The existing educational theme and readable captions stay curated.

Newly loaded project composers capture workspace defaults, with an existing personal language override taking precedence. Language changes clear the voice/accent pair. Existing drafts, pending create commands, projects and completed videos retain their settings. API creation still requires complete explicit settings; retries never resolve changed defaults. An unavailable preferred voice is refused rather than silently substituted. New generation/usage is not triggered by changing defaults.

Stop app/worker writes, apply/check migration 014, build/restart the dashboard. No new credentials or package dependencies. Brand/logo customization and personal preferences are later F13 slices; timezone updates do not move existing schedule instants.

## Verified local speech reuse (F12c)

After migration 013 and a worker restart, a newly approved plan can reuse unchanged narration from successful earlier runs in the same project. The worker verifies source approval/model/voice/settings and the actual saved WAV checksum before use. Changed or unavailable clips follow ordinary free-only synthesis. Visual edits can avoid new speech calls; all clips still get fresh measured timing, matching captions and a new render. Earlier ready videos remain available.

Admission still requires full-plan free allowance because reuse is decided during execution. All-reused runs release their unused reservation; mixed runs keep the conservative full settled hold. Revision review reports the reuse policy, not guaranteed savings. Keep output/dashboard-speech and original attempt/approval records: reuse receipts pin their sources, and automatic cleanup is not implemented. Only original settled clips from the latest 20 successful same-project runs are considered; missing local files can require synthesis even if videos are stored in R2.

Stop app/generation/storage writers, then run `npm run web:db:migrate`, `npm run web:db:check`, and rebuild/restart the app. Restart generation with `npm run web:generation -- worker` only when ready to process explicitly approved jobs. A worker start does not authorize new provider usage by itself. No cross-project reuse, paid fallback, automatic speech retry or new publication rights.

## Review a video revision (F12b)

After saving plan edits, choose **Review video changes** under **What changed?** to compare the saved plan with the latest completed video's approved input. It highlights narration/matching subtitles, headings, diagrams, scene sequence, source brief and supported settings. Before a first video it explains that there is no completed baseline. Your earlier video stays available in the finished-video panel/history.

This read-only comparison uses no AI credits and does not generate or approve media. New generation still synthesizes all narration; verified audio reuse is not implemented yet. Run **Check video plan** and explicitly approve the exact input separately. Active work or outdated plans must be resolved first. No new credentials, dependencies or database migration are required.

## Completed-video history (F12a)

Open **View video history** in the finished-video panel to browse completed versions, load older pages and view a selected version's player, transcript and downloads. **Return to latest video** resumes following the current latest output. Viewing an older version does not change the saved plan or latest-video pointer. A newly arriving video does not interrupt an older version you selected. History is metadata, so a listed video may still be temporarily unavailable at playback/download time; refresh or explicitly choose another version, with no automatic regeneration.

GET `/api/v1/projects/<project-id>/versions?kind=video&limit=10` adds scoped, signed keyset pagination without a migration or new credentials. Media endpoints retain all existing ownership/checksum safeguards and evaluation-only restrictions. Targeted regeneration/speech reuse and real combined generation-to-download acceptance remain pending.

## Private downloads (F11c)

The finished-video panel offers Download MP4 and Download subtitles (.srt) for ready output. Files retain the reviewed version/language; English uses English SRT and Telugu uses Telugu SRT. Both remain internal evaluation media, not authorized for publishing. Failed downloads show an inline message and can be explicitly retried without regenerating speech/video.

GET/HEAD `/api/v1/videos/<video-id>/downloads/mp4` or `/downloads/srt` requires the signed-in active team member and a live owned project. Responses use safe attachment filenames, private/no-store, checksum verification and access rechecks. Single GET ranges are supported; HEAD ignores Range and has no body. Unsupported roles and arbitrary keys are refused. As with playback, the full bounded object is verified in memory for every request; assess memory/hosting limits before deployment. No new migration or credentials are required beyond F11b.

## Private playback (F11b)

With app/worker writes stopped, apply/check migration 012, build/start the dashboard, then restart the storage worker in another terminal:

```sh
npm run web:db:migrate
npm run web:db:check
npm run web:build
npm run web:start
# Separate terminal:
npm run web:storage -- worker
# Reconcile one already-stored, checksum-protected run without local files:
npm run web:storage -- promote <run-id>
```

The same-page finished-video panel polls for actual ready output and provides native controls, matching transcript and explicit retry with seek-position retention. New storage commits ready metadata/owned asset pins atomically; older late completions cannot replace newer ready output. Loading/empty/error states do not fake finished videos. Each same-origin media request rechecks session/team/project/asset ownership and verifies actual MP4 bytes. No bearer URL/public R2 access or publication permission is created. Current playback rereads the whole bounded MP4 (<=128 MiB) for each request, including seeks/HEAD; hosted memory/response limits need validation before deployment. Downloads remain F11c. Checksumless legacy output cannot be promoted by inventing a hash. Dedicated latest-video lookup drives the player; legacy project-summary placeholders are unchanged.

## Private media storage worker (F11a)

New completed manifests pin MP4 SHA256, and their exact bytes are pinned by the generation artifact's manifestHash. Storage checks this chain before preparing/uploading a bundle, independently of media profile/duration/audio checks. Older manifests without a checksum stop with STORAGE_VIDEO_CHECKSUM_REQUIRED. Do not compute a checksum from today's file to rewrite an old completion; a newly reviewed generation is required. No silent legacy backfill or stored-object rewrite occurs.

Configure the six server-only R2 fields in `apps/web/.env.local` using the example. Endpoint: exactly `https://<account-id>.r2.cloudflarestorage.com`; region: `auto`; existing private bucket; bucket-scoped S3 credentials. Keep public access disabled. The SDK follows [Cloudflare's guide](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/), with [create-only conditional writes](https://developers.cloudflare.com/r2/api/s3/extensions/). File-size caps do not enforce the account's aggregate free allowance. No billing upgrade or paid fallback is enabled.

Stop app/worker writes for migration, apply/check 011, then run storage alongside the generation worker in another terminal:

```sh
npm run web:db:migrate
npm run web:db:check
npm run web:storage -- worker
# Safe aggregate status:
npm run web:storage -- status
# Operator commands for an existing local run:
npm run web:storage -- store <run-id>
npm run web:storage -- retry <failed-storage-run-id>
```

The worker discovers committed local output and revalidates media/captions/provenance, persisting MP4/SRT/input/timing/manifest bytes under fixed private keys. Keep local files until storage succeeds. Uploads are create-only and actual read-back SHA256 checked; partial/unknown writes reuse identical keys/bytes. Failed bundles require explicit storage-only retry, never new speech/video. Missing/corrupt local folders are skipped until correction plus explicit store or worker restart; changed destination settings cannot silently move earlier bundles. Ctrl+C finishes the bounded current step. Stored is an internal checkpoint: playback/downloads, ready-video pins and cleanup follow later. No signed URL/public access is created; evaluation publication restrictions remain.

## Dashboard generation worker (F09b/F10b)

Install both dependency trees and configure Google/MongoDB/provider settings as described below. The worker uses `apps/web/.env.local` and reads the existing root Remotion license confirmation without printing credentials. Stop application/worker writes before applying migration 010, then use separate terminals from the repository root:

```sh
npm run web:db:migrate
npm run web:db:check
npm run web:start
```

```sh
npm run web:generation -- worker
# In another terminal, inspect safe queue/heartbeat status:
npm run web:generation -- status
```

The real worker registers verified local fonts/build capabilities and processes only explicitly approved jobs. In a saved project, select the tested evaluation voice/accent, check the plan, then use **Approve & generate video**. Free-account/model/access/allowance checks run before every phrase; there is no paid provider, automatic speech retry or diagnostic fallback. Keep the worker terminal open; Ctrl+C drains/aborts work conservatively. Restart both worker and dashboard after changing environment settings. A stopped, incompatible or disabled worker blocks new approval.

Status supports queued/running/cancellation requested/failed/cancelled/**rendered locally**. Running cancellation is best effort; speech already sent can consume free allowance. Unknown outcomes pause new speech for operator review and are never retried automatically. Fully validated local output lives under ignored `output/dashboard-renders/<runId>/<artifactId>/`, with source clips under `output/dashboard-speech/<runId>/`. These operator files are not yet dashboard playback/downloads, ready videos or publishable media; R2 delivery is F11. Do not manually change an uncertain reservation to retry a request whose consumption is unresolved.

If a worker loses its lease during rendering or validation, the run stays active and blocks the sole render slot, including after cancellation. Lease expiry, abort requests and output files do not prove that Chrome/FFmpeg stopped. The current adapter has no durable termination-evidence verifier or supported unlock command; automatic recovery of these stages is intentionally paused. A future recovery path must verify the exact executor's termination before releasing the slot. Do not clear active rows or edit lease timestamps to bypass this gate.

## Selected-language diagram renderer (F10a)

The new local adapter renders the dashboard's strict `educational-diagrams-v1` input directly, with sequence/cycle/comparison motion, local pinned fonts, measured phrase audio, matching captions and MP4/media checks. It is separate from the older bilingual prototype below. Install both dependency trees (`npm ci` and `npm ci --prefix apps/web`) and keep `REMOTION_FREE_LICENSE_CONFIRMED=true` in the ignored root `.env.local` only after confirming eligibility.

```sh
npm run render:diagrams -- --diagnostic --language en
npm run render:diagrams -- --diagnostic --language te
```

These commands use curated fixtures and **offline robotic eSpeak only**, with zero provider calls. Unique output folders under `output/selected-diagrams/` contain `video.mp4`, `captions.srt`, narration WAV, canonical input, measured timeline/layout, representative frames and a manifest. Scratch bundles/fonts are isolated per render under ignored `.cache/selected-renderer/`. No earlier video is overwritten. Failed/cancelled work retains its nonvalidated manifest for inspection; only `diagnostic_complete` indicates a completed diagnostic. No database, approval, worker registry or R2 write occurs.

For a local resolved input file, add `--input path/to/input.json --hash <reviewed-sha256>` with its matching language. The hash and installed font bytes must match. Narration/caption/scene IDs and clip text are checked, and measured audio must fit the target (+3 seconds maximum) and 90-second cap. Caption text is wrapped into at most two font-measured readable lines; excess text or speed fails instead of being clipped. Short diagnostic scripts may include visual reading holds to reach their target; this is not a narrative-quality acceptance claim. Native Telugu wording/pronunciation still needs human review.

This does **not** enable dashboard generation: the diagnostic voice deliberately fails the pinned neural-voice requirement. Actual worker ownership/leases, external speech-attempt recovery, accepted-job UI and R2 media remain later increments. The adapter's evaluation branch validates caller-supplied speech source pins; the future trusted worker must supply verified provider-attempt/artifact provenance, not merely user-provided metadata.

F06 introduces the authenticated `/api/v1/voices` catalog, separate evaluation voice/accent choices and conservative free-provider checks. Put provider settings in ignored `apps/web/.env.local` (see its key-free example), then explicitly migrate the database. Catalog reads never generate audio; the separate operator `web:providers:probe -- en|te` command performs a fixed short free-only compatibility test. Native accent quality and publication rights are not inferred from model language support. Current evidence and limitations remain in Project Status.

The Next.js dashboard now supports editing saved briefs and video options with autosave and conflict recovery (F05). Run the explicit database migration/check with app writes stopped before starting the upgraded dashboard. Local unsaved work can be restored in the same browser tab; closing the tab or clearing browser storage can remove it. Voice selection and AI planning are subsequent milestones. See [Project Status](PROJECT_STATUS.md) for measured verification and the remaining feature roadmap.

Development progress, feature scope, verification and next steps live in **[PROJECT_STATUS.md](PROJECT_STATUS.md)**. Update that file alongside each feature change.

## Dashboard application — shared project library

The new Next.js application lives in `apps/web`, separate from the existing video prototype. From the repository root:

```sh
npm ci --prefix apps/web
npm run web:db:migrate
npm run web:dev
```

Open **http://127.0.0.1:3000/sign-in**. The Midnight Frame sign-in flow and server authorization protect Projects / Calendar / Settings. Follow **[AUTH_SETUP.md](AUTH_SETUP.md)** to configure the separate web environment file, Google OAuth client, exact team email allowlist and MongoDB database before migrating/starting. Follow **[DATABASE_SETUP.md](DATABASE_SETUP.md)** for explicit migrations, checks and local transaction tests. Google/MongoDB login and persisted project creation/list/detail are live-verified; see PROJECT_STATUS.md for evidence and limits. The root URL temporarily redirects toward Projects until the product homepage feature is built.

In Projects, enter an idea, choose English/Telugu and a 30/60/90-second target, then select **Create project**. The server saves a shared draft and opens its details. Search is literal title search; longer libraries use **Load more projects** with signed cursors. Details currently show saved content/options; editing/autosave, live voice selection, AI planning and generation are later milestones. Voice/accent remain explicitly unselected on new drafts; no AI request or paid fallback runs on creation. Repeating a failed save with unchanged input on the same page reuses its request key. Unsaved input recovery across a page reload belongs to F05.

```sh
npm run web:typecheck
npm run web:test
npm run web:db:check
npm run web:build
npm run web:start
```

The web application has its own package lock and React 19 dependencies. The root React 18/Remotion package and the commands below continue to run the prototype. AI provider secrets remain in the ignored root `.env.local`; the web app does not read it. Authentication settings belong in `apps/web/.env.local`; `apps/web/.env.example` lists key-free names. Never use `NEXT_PUBLIC_` for secrets. `npm run web:auth:check` validates setting presence/shape without printing values; `npm run web:auth:check -- --database` also performs a read-only MongoDB ping. Neither check substitutes for an actual Google sign-in and session/access test.

## Existing video pipeline prototype

A runnable local proof of the video-production loop described in [PRD.md](PRD.md), with a short [architecture sketch](ARCHITECTURE.md).

## Open the local studio

```sh
npm run dev
```

Open **http://127.0.0.1:4310** and keep the terminal running. If that port is occupied, set `PORT` to another free port before starting. Use the printed `127.0.0.1` URL rather than `localhost`.

1. Choose **Offline samples**, a lesson, and 30, 60, or 90 seconds. Click **Prepare my plan**.
2. Review the combined scene/narration plan. Edit English or Telugu wording if needed.
3. Choose **Video language** once: English narration with English subtitles, or Telugu narration with Telugu subtitles. Choose accent preference and 540p preview or 1080p export, then save any edits.
4. Check the approval box and click **Approve & generate video**.
5. Review the finished video and download its MP4 or SRT captions. Earlier versions remain in the library.

The local studio is a small browser interface over the pipeline, built without a separate frontend build step. It is an experiment harness; the later shared-team application still uses the agreed Next.js architecture. There is no pretend sign-in or Instagram connection.

Plans, settings, approved snapshots, job status, and rendered versions are stored under `output/projects/<project-id>/`. Restarting the studio restores saved projects. Jobs interrupted by a server restart are marked interrupted; they are not silently resumed. A crashed renderer may leave `.cache/pipeline.lock`: check its recorded PID before removing that specific stale file. Only one render can run at a time. Keep the server running until a render finishes.

Changing a plan or output settings clears the approval checkbox. The server also rejects an approval for a different plan or settings hash, and rejects stale saves from another tab. Revisions create a new output folder and reuse unchanged speech clips. Subtitles always use the selected video language; there is no separate subtitle-language setting.

## Current modes

| Mode | Script | Voice | Network/provider requests |
|---|---|---|---|
| Offline diagnostic | Curated English/Telugu water-cycle and seed-growth lessons | Local robotic eSpeak NG | None during generation/rendering when Chrome and dependencies are installed |
| Gemini | AI plan saved for human review, or a reviewed local plan | Gemini TTS, explicitly selected | Requires your own eligible free-tier key and billing confirmation |
| ElevenLabs voice test (CLI) | Reviewed local plan | Built-in Alice with Eleven v3 | Checks free-account allowance and Telugu model support before synthesis |

**Offline samples are diagnostic, not production AI voice demonstrations.** Every sample video is marked accordingly. Offline English is a generic robotic voice, not validated Indian-accent narration. Telugu fixture wording and pronunciation require a native speaker's review. Subtitles match narration and use measured phrase windows, not guessed word timestamps.

There are two trusted visual templates: an **illustrated water cycle** and an **animated concept flow**. Live Gemini can plan other step-by-step educational processes for the concept-flow template; it does not generate arbitrary illustrations or renderer code. The sample lessons have progressively longer narration for 30/60/90 seconds, rather than stretching a short script with a long silent ending.

## Requirements

- Node.js 22 or newer.
- An organization eligible for Remotion's free license (the user confirmed three or fewer total people for this workspace).
- Local Chrome/Edge, or a Remotion-supported headless browser. Installed Windows Chrome/Edge is detected automatically; set `BROWSER_EXECUTABLE` for another local installation.
- Package installation needs internet; the offline render itself does not call AI APIs.

```sh
npm install
```

For a new checkout, copy `.env.example` to `.env.local`, and set `REMOTION_FREE_LICENSE_CONFIRMED=true` only after checking eligibility. This workspace already has that local confirmation. Keep `.env.local` private; it is ignored by Git.

## Run the two offline samples

```sh
npm run doctor
npm run demo
```

The explicit `demo` command approves only the fixed diagnostic fixture. It creates two 1080×1920 MP4s, corresponding SRT subtitle files, narration WAVs, representative scene PNGs, and a machine-readable manifest:

```text
output/offline-water-cycle/
  water-cycle.en-en.mp4
  water-cycle.te-te.mp4
  narration-en.wav
  narration-te.wav
  en-en.srt, te-te.srt
  plan.json
  manifest.json
  *.props.json
  *.png
```

Only English→English and Telugu→Telugu are supported. Diagram labels follow the selected video language. Duration is derived from actual speech, with a selected 30/60/90-second minimum and a 90-second absolute cap. A script that exceeds its target by more than three seconds is rejected with a request to shorten it. No narration is cut off to force a duration. Existing cross-language experiments stay on disk but are excluded from the simplified studio library.

For a faster half-resolution test in a separate folder:

```sh
npm run demo -- --scale 0.5 --out output/quick-preview
```

Speech cache keys include text, language, voice, and provider. Revisions reuse unchanged source audio. All generated outputs and caches are Git-ignored.

## Review or change the plan

```sh
npm run plan
```

This copies the original 30-second water-cycle fixture to `output/plan.json`; it does not pretend to generate a new idea with AI. Review both languages and edit the JSON if needed. Water-cycle plans keep the five ordered phases. Concept-flow plans use 3–6 scenes with phase `concept`; both support 2–6 paired narration phrases per scene. The studio is the easiest way to select the longer sample plans.

```sh
npm run render -- --plan output/plan.json --spoken en --approve
```

Without `--approve`, rendering is refused before any speech generation. `--spoken en` or `--spoken te` selects narration and subtitles together; the old `--captions` argument is rejected. `--accent Indian` and `--accent Neutral` are separate preferences for live English delivery; offline speech does not simulate an Indian accent. Native Telugu delivery takes precedence for Telugu narration.

## Try real AI planning and narration later

### Connect the ElevenLabs account first

Open ElevenLabs **Developers → API Keys**, create a key named `VideoCraft`, and enable Text to Speech, Voices read, and User read. Copy the full key when it is first shown; an existing key's ID or masked suffix is not the secret. Save it as `ELEVENLABS_API_KEY` in `.env.local`. The preferred Telugu voices have been added to this workspace's ElevenLabs library and saved as separate settings:

| Voice | Voice ID | Local setting |
|---|---|---|
| Madhavi - Clear & Natural Conversation (female) | `4XvBGCPMXWyVQa75dbZg` | `ELEVENLABS_VOICE_MADHAVI_ID` |
| Bharadwaj - Profound Telugu Mythology (male) | `RoLT1qx7XJRXxWSIG5hS` | `ELEVENLABS_VOICE_BHARADWAJ_ID` |

```sh
npm run connect:elevenlabs
```

This checks authentication, subscription metadata, access to both voice IDs, and whether their returned names match Madhavi/Bharadwaj. It makes only read requests, generates no speech, and never prints the API key. Both voice IDs and names were verified on 19 October 2026; the public library marked both voices eligible for free users. This metadata check does not switch the renderer to ElevenLabs narration or prove pronunciation, accent quality, or commercial-use rights. [Official key instructions](https://elevenlabs.io/docs/help-center/technical/how-do-i-authorize-myself-using-an-api-key).

### Configure Gemini

Create an API key in [Google AI Studio](https://aistudio.google.com/apikey) for a project whose billing/free-tier settings you have checked. Set these in `.env.local`, not in source code or chat:

```dotenv
GEMINI_API_KEY=your-local-key
GEMINI_FREE_TIER_CONFIRMED=true
GEMINI_PLANNING_MODEL=gemini-3.8-flash
GEMINI_SPEECH_MODEL=gemini-3.8-flash-tts
GEMINI_VOICE=Kore
REMOTION_FREE_LICENSE_CONFIRMED=true
```

```sh
npm run plan -- --mode gemini --idea "Explain the water cycle to beginners" --out output/ai-plan.json
```

Read the saved AI plan and translations, then explicitly approve each desired run:

```sh
npm run render -- --mode gemini --plan output/ai-plan.json --spoken en --approve --out output/gemini-water-cycle-en
npm run render -- --mode gemini --plan output/ai-plan.json --spoken te --approve --out output/gemini-water-cycle-te
```

The code cannot inspect Google billing. The confirmation flag is an explicit operator assertion, not a guarantee about Google's billing configuration. No paid provider fallback, automatic top-up, or automatic API retry is implemented. Missing keys, unconfirmed free-tier status, 429 responses, unsupported models, or malformed audio fail clearly.

**Live Gemini generation has not been verified yet.** A key is configured locally and model metadata access was checked; free-tier project confirmation remains pending. Offline samples do not verify live generation.

Restart the studio after changing `.env.local`. Select **Live Gemini**, choose a visual template, and enter your own idea. The same review/approval/render flow is used. The code follows Google's [structured-output contract](https://ai.google.dev/gemini-api/docs/structured-output) and [speech-generation contract](https://ai.google.dev/gemini-api/docs/speech-generation), with the [free-tier pricing page](https://ai.google.dev/gemini-api/docs/pricing) rechecked on 19 October 2026. Mocked contract tests do not prove account access or voice quality.

### Real ElevenLabs voice test

The saved Madhavi and Bharadwaj voice IDs are verified in the account, but their real synthesis attempt was blocked by HTTP 402 `payment_required`: Voice Library voices cannot be synthesized through a free-tier API account, even when credits remain and metadata allows adding the voices. See [ElevenLabs' Voice Library restriction](https://elevenlabs.io/docs/eleven-creative/voices/voice-library). The current prototype deliberately rejects paid accounts; changing that requires revisiting the agreed zero-spend scope.

For the user-authorized free test, the account's built-in **Alice — Clear, Engaging Educator** voice was selected. Real Telugu synthesis with `eleven_v3` succeeded on 19 October 2026. Alice's source voice is British English; Telugu pronunciation needs native-speaker review. The saved preferred Telugu voice IDs remain available for future use with an eligible account. Run this test with matching Telugu narration/captions and diagrams timed to the measured speech clips:

```sh
npm run render -- --mode elevenlabs --plan fixtures/water-cycle.json --spoken te --voices free --natural-duration --approve --out output/elevenlabs-water-cycle --scale 1
```

`--voices free` uses `ELEVENLABS_FREE_VOICE_ID` and `ELEVENLABS_FREE_VOICE_NAME` from `.env.local`. `--natural-duration` permits the actual narration length above the nominal target, up to 90 seconds, without cutting or speeding speech. The command checks the account is on the free tier and reserves a conservative credit allowance before generation. It never activates top-ups or silently switches voices/providers. Unchanged speech is cached locally for render retries. The curated script does not call Gemini. The finished test appears in the local studio library; the dashboard's generation controls still expose offline/Gemini modes. Legacy `--voices madhavi`, `--voices bharadwaj`, and `--voices both` still select the preferred voices and report the provider's paid-access restriction on this free account.

## Visual inspection and checks

```sh
npm run typecheck
npm test
npm run studio -- --props=output/offline-water-cycle/en-en.props.json
```

Remotion Studio previews the same local composition and audio. It is a developer preview, not the future customer dashboard. `manifest.json` records actual video dimensions, H.264/AAC codecs, duration, audible audio level, completion/failure, and sample frame names. Inspect the rendered Telugu captions and listen to narration; automated media checks cannot prove pronunciation or educational quality.

The automated suite covers both lessons at all three durations in both spoken languages using real offline speech, subtitle timing, invalid media, API gates/contracts, project persistence, stale saves/approvals, recovery after restart, HTTP byte ranges, and local file boundaries. Local HTTP tests and Chrome rendering may need permission to run outside an execution sandbox on Windows.

## What's next

Run the two matching-language outputs with a real free-tier Gemini key, review voices/Telugu with the team, record findings, and refine [ARCHITECTURE.md](ARCHITECTURE.md). Then build the Next.js workspace around the proven pipeline. Authentication, MongoDB, Cloudflare R2, Vercel deployment, and Instagram connection are later milestones, not secretly mocked integrations in this prototype.

## Dependency notices

Remotion has its own organization-based license. The offline speech engine is [eSpeak NG](https://github.com/espeak-ng/espeak-ng) through [Echogarden's Emscripten build](https://github.com/echogarden-project/espeak-ng-emscripten), GPL-3.0. Fontsource Noto fonts are distributed with their upstream font licenses in the installed packages. This local diagnostic adapter is not a decision to ship that dependency in the public product.

F13b2 palette rendering: New projects can capture the saved shared palette (or opt out). Existing and recovered drafts retain their captured settings. Exact colors and font pins enter the separately approved video input; changing team branding does not change older projects or outputs. Branded jobs require a restarted worker advertising render:brand-palette-v1. Logos are a later increment. Root offline diagnostic renders remain separate from dashboard-ready neural videos and require no speech/inference provider calls. See PROJECT_STATUS.md for actual verification and pending live acceptance.

F13b3 logo preparation is available in Settings: bounded PNG/JPEG/WebP uploads are decoded and cleaned into a private canonical PNG, stored with R2 read-back verification and previewed only for active team members. Upload ID/file metadata recover in the same tab after reload; unknown outcomes require status checks and possibly reselecting the original file. This prepares an asset only; attaching logos to saved brands/videos is the next increment. Run web:db:migrate before starting an upgraded checkout. Generic signed-upload jobs, cleanup and deployment body-limit acceptance remain future work; see PROJECT_STATUS.md and API_DESIGN.md for evidence and limits.

## Renderer shutdown uncertainty

A rejected browser-close operation stops the generation worker with EXECUTOR_STOP_UNCONFIRMED. Its active job/reservation/project pointer stay retained, including cancellation requests; restarting a worker or waiting for lease expiry does not free physical capacity. Font preflight now enters validating while Chrome may be alive. Do not clear these leases to unblock the queue. A failed final close invalidates the local manifest and cannot promote a new video. This protects uncertainty; it is not a process-tree recovery implementation. Existing ready videos stay usable with the generation worker stopped.

Explicit offline Windows interruption check: `node --import tsx --test tests/render-cancellation.integration.ts`. It uses sine audio, tracks only its own Chrome/media PID/creation-time identities, requests graceful render cancellation and checks their subsequent absence plus a non-ready cancelled manifest. No provider, database, R2 or retained user-file access. It leaves generated test artifacts in ignored cache and does not prove every host-kill scenario.

## Supervised local executor

Apply/audit migration 026 and restart the generation worker after updating. New approvals require executor:windows-job-v1/current build. Actual preflight/render children are suspended in an owned Windows Job until durable admission, run without provider keys, and must drain all Job processes before stop acknowledgement. Cancellation targets only that Job. Recovery of expired supervised work verifies the exact local host/root/owner/epoch identity and OS stop evidence before freeing capacity; legacy or unknown executors remain blocked. No speech/render retry is introduced. This MVP executor is Windows-only; hosted execution remains separate work.

Native integration checks: `node --import tsx --test tests/windows-executor.integration.ts`. Fixtures cover suspended admission, normal drain, owned subtree cancellation, supervisor loss, name collision, real Telugu font preflight and cancellation of a real offline diagnostic render. They create new ignored test artifacts and never use providers or delete retained user projects.
