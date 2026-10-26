# VideoCraft manual acceptance — 26 October 2026

Status: **In progress. This is not full acceptance.** Feature development/Instagram work is paused for this pass.

Baseline: dev commit 2a28a24342037e35a9b3b175b4338386a414d747 plus the autosave recovery fix documented below. Environment: local production build, existing approved Google account, development MongoDB/private R2 and in-app Chromium. The 22 October report remains historical; its unimplemented-feature list is no longer current.

## Provider observation and readiness

- Google AI Studio, imported Default Gemini Project: Free tier; Gemini 3.5 Flash Lite showed 0/500 RPD, 0/15 RPM and 0/250K TPM. The dashboard says usage data can lag up to 15 minutes. Confirmed the local configured key matches the visible masked suffix without printing it. Local free-tier confirmation was already true. Saved a fresh operator observation of 500 at budget revision 8, expiring 2026-10-26T06:17:26.874Z. No quota was invented from model metadata.
- ElevenLabs live metadata refresh confirmed a free account, 8,987 remaining credits and Alice evaluation availability. Madhavi/Bharadwaj remain unavailable for free API testing. No paid fallback or account/billing change.
- Initial provider CLI check failed generically; the metadata recheck succeeded. Do not count the failed check as a pass.
- Generation heartbeat was stale with zero queued/active runs. Started planning, generation and private-storage workers; no cleanup worker was started. Live video generation still requires the exact reviewed plan approval.
- Quota evidence: `.cache/proofs/manual-2026-10-26-gemini-quota.png` (ignored local proof).

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
| English brainstorming/planning | In progress | Free-tier request submitted through UI |
| Plan editing/history/restore | Pending | Use QA content only |
| Rename/duplicate/search/recovery | Pending | Use labelled QA projects |
| Branding/logo/shared defaults | Pending | Restore any changed shared values |
| Sign-out/protected pages/re-login | Pending | Preserve QA drafts before signing out |
| Responsive/keyboard/console checks | Pending | Desktop and narrow viewports |
| Live generation/playback/download/revisions | Blocked on exact test-plan approval | No new generation run submitted yet |
| Permanent deletion/physical cleanup | Pending specific disposable-project confirmation | No existing project/asset will be used as a deletion target |

## QA data and restoration ledger

- Original six projects are retained. New English QA project: `6720a6f0-0d89-4f4e-adec-22f6a0871910`.
- New Telugu QA project: `335000be-ff5d-4ff3-8fa4-2bc0a9bf4ba0`, plan version 1 ready; no generation approval submitted.
- Personal overrides restored to null inheritance at revision 7. Shared defaults/branding remain unchanged so far (baseline workspace revision 3; brand revision 6).
- Explicitly expired provider observation was restored with real provider metadata. Planning budget was renewed only from the observed matching free-tier project.
- No existing project, local media, R2 object or source/reference record has been deleted. No Instagram action, billing change or deployment.

Remaining cases will be updated with actual results; a pending/blocked row is not a pass. Prior automated suites are supporting evidence, not substitutes for this browser pass.
