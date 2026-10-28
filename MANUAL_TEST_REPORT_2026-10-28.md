# English bounded-pacing live acceptance — 28 October 2026

Scope: existing rain QA project `6720a6f0-0d89-4f4e-adec-22f6a0871910`, saved English plan 5, three scenes, 30-second target, Alice/source-voice evaluation delivery, matching English subtitles and the existing captured palette/logo. The user explicitly approved only version 5 for one free-evaluation attempt. Telugu, deletion, publication and paid fallback remain outside this approval.

## Preparation

- The working tree started clean after pacing implementation commit `30910a4`.
- Provider metadata was first refused under sandbox constraints; the required escalated metadata-only retry passed. The observed available free evaluation allowance was 5,042 credits; Gemini remained paused with unverified quota. No Gemini planning or speech probe was submitted.
- The first unsaved draft failed actual-font caption fitting. A revised 54-word draft (101 / 96 / 92 characters) passed the real local spatial preflight without speech requests. No measured duration was inferred from that pass or the word count.
- Saved the revised narration through the actual signed-in editor as plan 5, project revision 17. Earlier versions and Ready video version 1 stayed available. The source brief/settings/diagrams/branding were retained.
- Worker status confirmed zero active/queued generation runs before starting the updated worker. The signed-in Check video plan compiled plan 5 and enabled approval. Screenshot: ignored `.cache/proofs/pacing-v5-ready.png`.
- Transient planning/generation status reads initially kept the editor locked; successful refresh restored access. No pending-command, lease, approval, quota or provider gate was bypassed.

Approved narration:

1. Sunlight warms liquid water in lakes. This water turns into invisible vapour that rises into the air.
2. High in the sky, it is cool. Vapour turns into tiny liquid drops. These tiny drops form a cloud.
3. Tiny drops in clouds join and grow. Big drops fall as rain. The rain fills rivers and lakes.

## Outcome

Passed the English bounded-pacing technical acceptance for this exact approved plan. Run `63091941-520c-4b68-94d4-b1f2f17130ce` produced artifact/Ready video `647c99ab-9a04-4acd-a704-81d8a35bf0ef`, video version 2, project revision 20. All three speech attempts settled once; checksum-verified source speech totals 23.52 seconds. No second generation was submitted.

- Completed manifest records policy `bounded-scene-holds-v1`, 1.86 seconds of hold per scene, 5.58 seconds total added hold, and a 30-second minimum. Output is H.264/AAC, 1080 × 1920, 30 fps / 900 frames, 30.016 seconds including encoding, 48 kHz decoded audio, mean volume −23.23 dB. Timing remains measured phrase-level, not word alignment.
- Inspected all three real rendered scene PNGs: retained title/logo/palette, legible headings/diagram labels and two-line matching English captions; no visible clipping in those inspected frames. This is not exhaustive frame-by-frame motion review.
- Ran exact-run storage and promotion commands after render completion; they did not submit speech or rendering. Independently read all five private R2 objects and verified sizes/checksums: MP4 964,165 bytes, SRT 390, input 5,175, timing 4,115 and manifest 1,000. Exactly one Ready record exists for this run; zero active generation runs were observed.
- MP4 SHA-256 matches the completed manifest and immutable bundle: `c6676145103cc53174950bb52e9b542e093db26356957b2c140056b5685d4046`. Actual dashboard MP4 and SRT downloads landed in the user's Downloads folder and matched the pinned output bytes. SRT SHA-256: `28338f40e91273c68ba1ae60a8f59272c60492cb65201fc678655aad5629bc11`.
- File checks verified approved narration/caption text, rounded measured sample-to-frame anchors, consecutive scene windows and 1.86-second hold metadata. Unauthenticated playback/MP4/SRT requests each returned private/no-store 401.
- In the actual signed-in browser, video reached `ended: true`, `currentTime: 30.016`, `readyState: 4`, no media error and native 1080 × 1920 dimensions. Native Home/ArrowRight seek changed the timeline. Reload retained Ready version 2. History showed versions 1 and 2; selecting version 1 loaded Ready version 1, then returning to latest restored Ready version 2. Neither earlier output nor plan history was removed.
- Stopped the test generation worker process with Ctrl+C after completion and zero active work. Follow-up status showed zero queued/active jobs and no fresh heartbeat, but its registry row retained `healthy`; a clean registry-stop transition is not verified. Production web app remains running; another generation requires starting its worker again. No process supervisor/host-fault acceptance is claimed.

Evidence: ignored `.cache/check-paced-run.mts`, `.cache/qa-paced-acceptance.mts`, `.cache/check-paced-files.mjs` and `.cache/proofs/pacing-v5-ready.png`; completed output is retained under the run/artifact folder. Final browser proof is `.cache/proofs/pacing-v5-finished.png`. Helpers and user media are excluded from publication.

Limits/next steps: this is internal evaluation audio (`publicationAllowed: false`). A human still needs to listen for pronunciation, perceived pauses and educational quality. No claim of native Indian accent or Telugu quality. Telugu generation and revision/speech-reuse live acceptance still need exact-plan approvals; remaining source/scratch/orphan cleanup, active-executor cancellation, Instagram connection/publication/scheduling, homepage and deployment/final acceptance remain pending. Free allowance was observed before this attempt, not remeasured afterward. No paid fallback, Gemini inference, deletion, Instagram action or deployment occurred. No application code changed in this acceptance milestone, so unit/build suites were not rerun; the preceding implementation's recorded results remain applicable.
