# Live video acceptance — 27 October 2026

Scope: the existing English rain QA project (`6720a6f0-0d89-4f4e-adec-22f6a0871910`), Alice's free evaluation voice, matching English subtitles, captured palette/logo and 30-second target. The user separately approved exact versions 3 and 4. No Telugu generation, paid fallback, deletion or Instagram action is authorized by these approvals.

## Findings and retained evidence

- The existing app process occupied port 3000. A redundant startup correctly refused that occupied port. The initially stale generation-status read kept the editor locked; its subsequent successful refresh restored editing. No locking safeguard was bypassed.
- Real ElevenLabs metadata initially reported 7,208 free credits. Gemini's quota confirmation remained expired; no Gemini inference was requested.
- Saved version 3 manually shortened narration while preserving headings, diagrams, brand and prior versions. The user approved it before submission. Run `0ee033b7-0019-4503-81f3-e7de828ea2fc` settled three speech attempts (422,444 / 361,004 / 418,604 WAV bytes). Checksum-verified speech totals 25.04 seconds and local timeline assembly passed.
- Version 3 nevertheless failed during actual-font layout: the complete scene captions cannot fit the renderer's two-line readable caption area. The local failed manifest records `failedStage: layout`; the job currently exposes the generic `GENERATION_INTERRUPTED` error. No ready artifact or R2 upload was produced. Both the pre-speech layout-preflight gap and generic layout failure reporting remain product follow-ups; this pass does not claim to fix them.
- A local-only layout diagnostic reconstructed verified saved audio and reused the local renderer bundle. It reproduced the original text-fit refusal, then verified proposed shorter captions with installed fonts. This check made no speech requests and did not render new text against old speech or create a ready-video record. A harmless Puppeteer page-close warning occurred between the failing original and passing candidate check.
- Version 4 was saved with the three preflighted captions/narrations below. The user explicitly approved this version before submission. Earlier plans, failed runs and settled speech receipts remain intact.

1. Sunlight turns surface water into vapour that rises into the air.
2. Water vapour cools and condenses into droplets, forming clouds.
3. Cloud droplets grow and fall as rain. Water collects below.

Real metadata after version 3 reported 5,903 free evaluation credits. This is a dated observation, not a future allowance guarantee. The generation worker was started only after a status read confirmed zero queued/active runs; it retains the original free-provider, immutable approval and executor-stop gates.

## Acceptance outcome

**English version 4 technical end-to-end acceptance passed.** This is one approved English evaluation video, not acceptance of Telugu, revision reuse, every failure mode or commercial publication.

| Check | Actual evidence |
| --- | --- |
| Live speech | Run `e7304196-f2f2-4971-ad03-7f93a7a3ad3a`, three settled attempts, 215,084 / 241,964 / 218,924 WAV bytes; verified speech duration 14.08 seconds |
| Timeline | Approved source text retained; 900 frames at 30 fps, with reading holds to reach the 30-second target; phrase/sample anchors, not word-level forced alignment |
| Validated MP4 | 1080×1920 H.264/yuv420p, AAC 48 kHz, 30.016-second container duration, decoded audio RMS approximately -25.21 dBFS; validation manifest is `validated_local`, not diagnostic |
| Private R2 | Bundle is `stored`; all five actual objects were read back and matched expected byte lengths/SHA256: MP4 911,582 bytes, SRT 288, input 4,971, timing 3,927, manifest 826 |
| Immutable ready record | Exactly one ready record for the run, video `e7ae1972-44c7-43f1-b64a-dff482a91b2f`, ready version 1; bundle/run/input identity and pinned MP4 checksum match |
| Browser playback | Actual player reached end: currentTime/duration 30.016, ended true, readyState 4, error null, decoded dimensions 1080×1920; subsequent reload playback and native keyboard seek also worked |
| MP4 download | App's Download MP4 completed to `C:/Users/HP/Downloads/videocraft-v1-en.mp4`; SHA256 `f0327854972df2bc454105829d1c0efaed4eecb8858e5e726aae6e9f0ae00736` matches local manifest and R2 object pin |
| SRT download | App's subtitle download completed to `C:/Users/HP/Downloads/videocraft-v1-en.srt`; SHA256 `d9a3879ea7cfbc6d75ffa1773d5d2c4841d9c710d8da405780e885477be24861` matches renderer output; all three approved English captions retained with readable line wrapping |
| Caption/scene alignment | Downloaded SRT changes at 0.367 / 9.833 / 19.900 seconds and ends 29.467; these match the measured scene/timing manifest boundaries. This establishes phrase/scene synchronization, not subjective listening or word-level timing certification |
| Visual review | Actual scene-1/2/3 PNGs inspected: title/logo, headings, sequence/cycle diagrams and two-line captions fit without clipping/overlap in these three frames |
| Persistence/history | Full project reload restored plan 4 and Ready version 1. Video history listed version 1; selecting it resolved the ready video and Return to latest restored the latest view without generation |
| Access protection | Unauthenticated playback, MP4 download and SRT download each returned 401 with private/no-store; no credentials/cookies were copied into test tooling |
| End state | Zero active/queued generation runs. Latest real metadata at 08:16 UTC reported 5,042 free ElevenLabs credits; Gemini stayed paused. No paid fallback or Gemini inference |

Proof: ignored `.cache/proofs/live-video-ready-2026-10-27.png`. Local output folder: `output/dashboard-renders/e7304196-f2f2-4971-ad03-7f93a7a3ad3a/e7ae1972-44c7-43f1-b64a-dff482a91b2f`. Private ignored diagnostics `.cache/qa-layout-check.mts` and `.cache/qa-video-acceptance.mts` print only scoped IDs/checks and safe results; they do not print credentials, object keys or signed URLs.

## Limits and follow-ups

- This test uncovered a real pre-speech caption-fit validation gap and generic layout-error reporting. Version 4 demonstrates the current supported short-caption path; it does not fix longer narration support. Add actual-font preflight before speech and actionable layout failures in a separate implementation increment.
- The deliberately short test narration has roughly five-second reading holds between scenes. Product pacing/subjective voice quality and Indian accent/pronunciation still need human listening review; no native-accent certification is claimed.
- Browser requests intermittently stalled and transient planning/generation refresh messages appeared; refreshing recovered and all final reads/downloads passed. One CUA call stalled unusually long. The renderer worker eventually exited with its redacted diagnostic after successful completion; its cause was not established. Do not describe it as an always-on healthy deployment. App playback of stored videos remained usable after it exited.
- Only the native seek UI was checked; no separate authenticated HTTP 206/HEAD test, expired-media-access test or interrupted download fault was performed in this pass. Unauthenticated route refusal and real full playback/download bytes were verified.
- Telugu live generation, targeted revision speech reuse/multiple ready-version comparisons, active-executor cancellation and destructive cleanup remain untested. Existing nine projects and prior artifacts were retained. Instagram/publication, billing changes and deployment remain outside this test.
- No application code, dependency or schema changed. Verification used real browser/provider/storage evidence and checksum checks; automated suites/build were not rerun for this documentation-only milestone.
