# VideoCraft manual acceptance — 26 October 2026

Status: **Manual pass recorded; live-video acceptance blocked. This is not full acceptance.** Feature development/Instagram work remains paused. English plan version 2 was explicitly approved and tested; its measured narration exceeded the selected duration. No Telugu generation or project deletion was approved or performed.

Baseline: dev commit 2a28a24342037e35a9b3b175b4338386a414d747 plus published autosave fix c51b78f0f6a5ca17bee2e98ada9a7c8c2399e9a8. Environment: local production build, existing approved Google account, development MongoDB/private R2 and in-app Chromium. The 22 October report remains historical; its unimplemented-feature list is no longer current.

## Provider observation and readiness

- Google AI Studio, imported Default Gemini Project: Free tier; Gemini 3.5 Flash Lite showed 0/500 RPD, 0/15 RPM and 0/250K TPM. The dashboard says usage data can lag up to 15 minutes. Confirmed the local configured key matches the visible masked suffix without printing it. Local free-tier confirmation was already true. Saved a fresh operator observation of 500 at budget revision 8, expiring 2026-10-26T06:17:26.874Z. No quota was invented from model metadata.
- ElevenLabs live metadata refresh confirmed a free account, 8,987 remaining credits and Alice evaluation availability. Madhavi/Bharadwaj remain unavailable for free API testing. No paid fallback or account/billing change.
- Initial provider CLI check failed generically; the metadata recheck succeeded. Do not count the failed check as a pass.
- Generation heartbeat was stale with zero queued/active runs. Started planning, generation and private-storage workers; no cleanup worker was started. Live video generation still requires the exact reviewed plan approval.
- Quota evidence: `.cache/proofs/manual-2026-10-26-gemini-quota.png` (ignored local proof).
- Final metadata refresh at 09:25 UTC reported **7,208 free ElevenLabs credits**. Gemini's earlier operator observation expired; planning is now correctly paused with FREE_ALLOWANCE_UNVERIFIED. The old 0/500 observation is historical, not a fresh remaining-quota claim. No new Gemini request was made after expiry.

## Reproduced defect and correction

**Autosave treated a known voice refusal as an unknown write outcome.** An expired voice observation made project PATCH return the documented pre-write 503 VOICE_UNAVAILABLE. ProjectEditor treated every 5xx as potentially committed and retained the rejected pending command, even after the user changed the draft. The UI showed “Changes not confirmed” and replayed the old command.

ProjectEditor now uses the existing shared canCorrectSaveFailure classifier, as the composer/settings already do. This exact pre-write refusal clears the rejected command and shows the useful provider message; unknown 5xx, network and session outcomes keep their existing recovery rules. No provider checks/approval gates are relaxed.

Browser retest used a supporting CLI fault injection to expire only the cached ElevenLabs observation, guarded by zero active generation work. The editor showed the explicit refusal. Changing to a valid unselected-voice draft then saved the corrected 30-second settings successfully; this would previously replay the rejected command. A real Refresh availability restored the provider observation, and Alice/source-voice settings saved again. The local draft survived the preceding failure and a stale-revision conflict. One direct service diagnostic wrote the intended English QA audience/voice at revision 2; this supporting service write is not counted as a manual UI save.

Verification: all 119 unit tests (including existing 503/unknown-outcome classification coverage) and the final production build/TypeScript passed. Browser correction/save and fresh-voice restoration passed. Proof: `.cache/proofs/manual-2026-10-26-autosave-recovered.png`.

## Manual cases so far

| Case | Result | Evidence / boundary |
|---|---|---|
| Existing signed-in page and saved English plan | Pass | Existing QA copy loads saved plan version 2; original content untouched |
| Project library | Pass | Six original projects displayed before QA creation |
| Empty project creation | Pass | Native required-field validation blocked submission |
| English QA creation | Pass | Persisted new 30-second project; shared palette captured |
| Empty search | Pass | Unique absent title shows real no-results state and clear-search action |
| Telugu QA creation | Pass | Persisted new 30-second project; Telugu narration/Telugu subtitles label |
| Separate voice/accent choices | Pass | Selecting Alice does not automatically select an accent |
| Autosave voice refusal | Failed, then fixed/retested | Explicit stale-capability fault described above |
| Stale revision comparison | Pass | Newer saved revision displayed; Keep my edits for review paused saving; Save my edits committed |
| Corrected draft/autosave/reload | Pass | Corrected values saved and reloaded without losing audience/settings |
| Personal invalid timezone | Pass | Invalid IANA zone rejected before save |
| Personal timezone save/reload | Pass | UTC saved at revision 6 and survived Reload my preferences |
| Personal timezone restoration | Pass | Restored null/team inheritance at revision 7 |
| Telugu live AI planning | Pass | Three-scene plan version 1 completed through persisted worker job |
| Telugu video-input check | Pass | Three scenes, Telugu narration/subtitles, 1080x1920/30fps, captured palette and 480x180 logo; approval button enabled |
| English brainstorming/planning | Pass | Three suggested ideas; selected water-drop idea saved; three-scene AI plan completed |
| Plan editing and narration line breaks | Pass | English v2 and Telugu v2 saved corrected precipitation mechanism; matching-language input checks passed |
| Immutable plan history/restore | Pass | Telugu v1 preview was read-only; restore created v3; restoring corrected v2 created current v4; earlier versions retained |
| Rename validation/save | Pass | Blank title refused; bilingual Telugu QA title saved |
| Duplicate independence | Pass | New copy had its own v1 and no generated media; copy audience edit did not change original English audience/v2 |
| Search after creation/rename | Pass | QA title search displayed exactly the three labelled QA projects |
| Shared defaults validation/inheritance | Pass | Invalid timezone refused; 30-second default saved at workspace revision 4 and observed in new composer; restored 60 seconds at revision 5 |
| Loaded brand palette edit/save | Pass | Low contrast refused; primary #B7A4FE saved at brand revision 7; original #B7A4FF restored by a second save at revision 8, retaining logo and other colors |
| Private logo display | Pass | Rendered authenticated preview loaded 480x180 pixels; both prepared inputs pinned that logo |
| Sign-out/protected pages/re-login | Pass | App sign-out redirected to sign-in; direct Settings navigation stayed protected; existing approved Google account re-entered the nine-project library |
| Narrow English editor | Pass, limited | Requested 390px/320px widths produced measured content widths 375px/305px; scrollWidth equalled clientWidth in each case. Not a full cross-device accessibility audit |
| Console | Pass, limited | Inspected English tab returned no captured warn/error entries |
| Incomplete reference validation/correction | Pass | Empty reference refused with bounded-text message; removing it restored All changes saved without altering copy's saved audience |
| Offline/same-tab reload draft recovery | Not completed this pass | Dirty-page reload was cancelled by the unload guard. A fresh tab has separate sessionStorage and does not establish same-tab recovery; no recovery pass is claimed |
| English live speech | Pass | One approved v2 run; three settled speech attempts; checksum-verified local WAVs total 35.44 seconds |
| English video assembly | Blocked by actual duration | 35.44 seconds of speech exceeds 30-second target plus allowed tolerance; local assembly safely refused before rendering |
| Ready-video playback/download/history/reuse | Not reached | No ready MP4/R2 bundle exists for this run; no additional generation was submitted |
| Telugu live generation | Not performed | User approved English only; Telugu remains current v4, ungenerated |
| Deletion confirmation/cancel | Pass | Copy had zero queued work; final delete disabled without consent; user chose Keep; Keep project closed confirmation |
| Permanent deletion/physical cleanup | Not performed | User expressly chose to retain the duplicate; no project/file/R2 asset deleted |

## Live English generation finding

The first approval attempt returned an explicit pre-write speech-availability refusal. Refresh availability succeeded; submitting the same approved English v2 then created one run, `a056d5d9-bd46-4d64-94b9-3a4ae164478d`.

The run reached rendering and ended failed with GENERATION_INTERRUPTED. All three speech attempts were settled (579,884 / 510,764 / 610,604 WAV bytes). A read-only database lookup plus checksum-verified local speech reconstruction reproduced the exact assembly refusal: “Measured narration exceeds the selected target tolerance. Shorten and approve a new plan.” Total speech alone is 35.44 seconds against a 30-second target; adding required timing gaps cannot satisfy the 33-second ceiling. No timing constraint was weakened and speech was not cut off or accelerated.

**Usability defect found during this pass:** the live job stores/displays a generic failure instead of the actionable measured-duration reason. The implementation follow-up below addresses new runs; this historical run remains unchanged. Input checks only validate the plan; they cannot guarantee duration before real speech exists. A shorter reviewed plan, a new explicit approval, and a healthy worker are required before completing live playback/storage/download acceptance. Do not blindly repeat this unchanged plan or claim R2 video integration passed. The generation worker was later observed stopped with its redacted diagnostic; it was not restarted to submit further work. No raw provider exception or credential was logged.

Proof: `.cache/proofs/manual-2026-10-26-english-failed-mobile.png` records the narrow English scene layout. Other ignored proofs cover quota, autosave recovery and both prepared plans. Screenshots alone do not prove audio synchronization or playback.

## QA data and restoration ledger

- Original six projects are retained. New English QA project: `6720a6f0-0d89-4f4e-adec-22f6a0871910`.
- New Telugu QA project: `335000be-ff5d-4ff3-8fa4-2bc0a9bf4ba0`, renamed “QA 26 Oct — వర్షం (Telugu)”, current plan v4 restored from corrected v2; no generation approval submitted.
- Retained new copy: `597288ab-12bd-4e07-a38b-e588b6072b4a`, “QA 26 Oct — Disposable duplicate”, saved revision 2 and independent audience. Copied plan v1 is correctly outdated after the brief edit. Empty test reference was removed. The user explicitly chose to keep this project.
- English remains plan v2; its failed run and all three settled speech attempts are retained. No automatic retry/new approval was submitted.
- Personal overrides restored to null inheritance at revision 7. Shared defaults restored to English/60 seconds/no voice/no accent/Asia-Kolkata at workspace revision 5. Original brand colors/logo restored at immutable brand revision 8 (baseline revision 6 is retained). Saved QA projects keep their captured palette revision 6.
- Explicitly expired provider observation was restored with real provider metadata. Planning budget was renewed only from the observed matching free-tier project.
- No existing project, local media, R2 object or source/reference record has been deleted. No Instagram action, billing change or deployment.

## Duration reporting implementation follow-up

Typed measured-duration refusals now pass through the local adapter as NARRATION_DURATION_EXCEEDED. New failed jobs carry a bounded safe message explaining that narration must be shortened, saved as a new plan version, checked and explicitly approved. No automatic retry, caption/narration rewriting, clipping, speed-up, timing relaxation or provider fallback was added. Historical failures and settled speech receipts remain unchanged. Automated evidence and publication are recorded in PROJECT_STATUS.md; no new live speech/render/storage request was submitted for this correction. This does not turn the earlier failed run into a ready video.

Remaining acceptance: a newly reviewed/approved shorter English plan, ready MP4/R2/player/download checks, approved Telugu media evaluation, live targeted speech reuse and selected-video history, same-tab offline recovery, broader keyboard/accessibility checks, and separately authorized destructive lifecycle testing. Prior automated suites are supporting evidence, not substitutes for these live checks. Instagram remains deferred.
