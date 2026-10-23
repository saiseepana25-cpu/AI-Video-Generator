# VideoCraft manual test report

Date: 22 October 2026 (Asia/Kolkata)

Code tested: `65c97a79c9a8586c4b4a4f457a0b02b7e73db3a7` on `dev`

Environment: local production application at `http://127.0.0.1:3000`, configured development MongoDB and private R2 logo, existing approved Google account, in-app Chromium browser.

## Result

The implemented dashboard workflows exercised in this pass worked. No reproducible application-code defect was found in these scenarios. This is **not full V1 acceptance**: no newly approved speech/render/storage job or completed-video playback/download was submitted. Planned features F14–F20 remain planned.

Two operational conditions were identified:

1. **Gemini free quota confirmation expired.** The provider catalog correctly pauses new planning. Attempting Prepare my plan returned an explanatory refusal and unlocked the editor. Refresh availability does not read Google's remaining quota. A fresh operator quota observation is required before another live AI plan; no budget was renewed or invented during testing.
2. **Generation worker became inactive.** A read-only status check showed `draining`, an expired heartbeat, and zero queued/active runs. Restarted the local worker without bypassing approval or lease-recovery safeguards. A later status check confirmed `healthy`, fresh heartbeat, and zero queued/active runs. This establishes current local readiness, not unattended service supervision or durability through future network failures.

## Browser scenarios

| Area | Actions and observations | Result |
|---|---|---|
| Existing session | Reloaded an existing English project; saved brief, four-scene plan and controls loaded | Pass |
| Sign-out | Signed out through the app; reached the team sign-in screen | Pass |
| Protected page | Requested Settings directly after sign-out; redirected to sign-in without exposing Settings | Pass |
| Google login | Continued with the existing approved Google account; OAuth returned to the shared Projects dashboard with enabled controls | Pass |
| Empty create | Submitted the empty composer; required-field validation prevented creation | Pass |
| Project creation | Created one explicitly labeled QA project; opened its real persisted detail page | Pass |
| Project search | Searched `google`; only the Google Maps project matched | Pass |
| Empty search | Searched a unique absent title; saw the real no-results state and clear-search links | Pass |
| Brief autosave | Edited audience, selected Telugu and 30 seconds; saw saved revision advance | Pass |
| Matching language | English showed English subtitles; selecting Telugu showed Telugu subtitles | Pass |
| Voice/accent | Selected Alice and its original delivery independently; saved choices without claiming a verified Indian accent | Pass |
| Incomplete reference | Added an empty reference alongside a valid unsaved audience change; validation refused saving without hiding either edit | Pass |
| Draft recovery | Left and reopened the test project, restored the offered local draft, and recovered the audience change plus empty reference | Pass |
| Draft correction | Filled the recovered reference with Telugu text; autosave completed and controls unlocked | Pass |
| Planning refusal | Attempted planning with expired free-quota confirmation; useful error appeared and editor remained usable | Pass: expected refusal |
| English plan check | Checked the existing four-scene English plan; canonical video input, captured palette and logo were prepared without generating audio | Pass |
| Revision comparison | Opened What changed? before the first completed video; saw the correct no-baseline explanation | Pass |
| Plan history | Listed and opened the saved English version; current-version restore action was disabled | Pass |
| Telugu plan editor | Opened narration, headings, layout/labels and static diagram previews for the existing three-scene Telugu plan | Pass: editor display |
| Narration formatting | Added a line break to Telugu scene 1; matching subtitle preview preserved it; saved new immutable version 4 | Pass |
| Formatted plan check | Checked saved version 4; compiler accepted supported narration whitespace and prepared Telugu narration with Telugu subtitles | Pass |
| Plan restore | Opened historical version 3 and restored it as version 5; original versions stayed available | Pass |
| Finished-video empty state | Finished-video panel and video history correctly reported no completed video | Pass: empty state only |
| Shared defaults | Existing English/60-second/Asia-Kolkata defaults loaded; remained revision 3 | Pass: read/inheritance; no shared-default write in this pass |
| Invalid timezone | Entered an invalid personal timezone; save was refused with useful validation | Pass |
| Preference persistence | Saved temporary UTC preference, reloaded, confirmed it persisted, then reset and saved original team inheritance | Pass |
| Palette validation | Set primary color equal to background; contrast validation refused save | Pass |
| Palette save regression | Loaded saved branding, edited one color and saved revision 5 without UNKNOWN_FIELD; changed it back and saved revision 6 | Pass |
| Private logo | Selected saved logo displayed with actual decoded image dimensions; browser confirmed image complete/nonzero natural width | Pass: existing authenticated R2 read |
| Calendar | Navigation opened a truthful scheduling-not-implemented state | Pass: planned-feature state |
| Mobile Telugu | Inspected Telugu project at 390px viewport; page client/scroll widths both 375px; native-script heading and navigation displayed | Pass |
| Mobile Settings | At 390px client/scroll widths both 375px; at 320px both 305px | Pass: no page overflow |
| Mobile Calendar/Projects | At 320px client/scroll widths both 305px; library and navigation rendered | Pass: no page overflow |
| Browser warnings | Final inspected desktop and mobile/auth tabs returned no captured warning/error entries | Pass for inspected final logs; not a complete network trace |

Widths exclude the browser's vertical scrollbar. Temporary viewport overrides were reset. This is browser responsive testing, not physical-device or comprehensive accessibility testing.

## Supporting service checks

These supplement manual UI testing; they are not counted as manual interactions.

| Check | Result |
|---|---|
| Authentication configuration and live MongoDB ping | Passed; no secret values printed |
| Database integrity check | Passed migration checksums, replica-set topology, strict validators, named indexes, existing row shapes and uniqueness |
| Provider metadata | Alice available for free evaluation; Madhavi/Bharadwaj unavailable for free API testing; Gemini paused for unverified remaining free allowance |
| Unauthenticated personal-preference GET/PATCH | Both 401 with private/no-store and request IDs |
| Unauthenticated voice catalog | 401 with private/no-store and request ID |
| Browser bundle scan | All 18 built JavaScript bundles scanned; no exact configured-secret matches |
| Storage queue | Zero pending/uploading/failed/stored bundles at inspection |
| Final database state audit | Original Telugu version-3 plan equals current version-5 plan; personal overrides all null; shared settings revision 3; brand revision 6; five live projects; zero generation runs |

Initial sandbox-only network checks were blocked. The same checks were rerun with network permission and passed; sandbox refusals were not treated as application failures. Automated unit/DB suites and production build were not repeated in this documentation-only step; their prior milestone results remain in Project Status.

## Data changes and final state

- One saved project remains: **QA manual test — explain how rain forms.**, ID `68820fc5-827a-4fb6-8f73-8e5aaee0196d`. It has Telugu/30-second settings, Alice/source-voice, a Telugu reference and the QA audience. It has no generated plan or video. Safe deletion is not implemented yet, so no direct database deletion was used for cleanup.
- The existing Telugu water-cycle project retains the original text/diagrams through restored plan version 5. Versions 3 and 4 remain immutable history; project revision advanced from 10 to 12.
- Personal overrides are restored to all-null inheritance at personal revision 5.
- Shared brand colors and selected logo are restored to their original values through immutable brand revision 6. Prior project brand snapshots were not rewritten. Shared defaults remain unchanged at revision 3.
- Signed back into the original approved account. The final Projects tab is left available for review.
- No Gemini inference, speech synthesis, new video render, R2 video upload, Instagram post, billing change or deployment occurred. Existing private logo reads and provider metadata checks were performed.

## Not verified by this pass

- Full exact-plan approval → live neural speech → measured synchronization/captions → render → R2 → ready-video playback/seek/MP4/SRT download.
- Actual completed-video history, targeted revision comparison against a completed video, and live verified speech reuse. There are no generation runs in the development workspace.
- New logo upload, invalid-image upload cases, two-tab write conflicts, actual offline network injection, lost acknowledgements, concurrent physical rendering, crash/lease takeover and revocation during remote retrieval. Existing automated coverage is not a substitute for these unperformed live scenarios.
- Multi-account/blocked/expired-account scenarios previously deferred by the user, load/scaling/security/accessibility audits, and deployment.
- Project rename/duplicate/delete, activity drawer, Instagram connection/publishing/scheduling and public homepage: not yet implemented.

The next live media acceptance step needs an exact reviewed plan approved by the user, current free-provider readiness and running local workers. New AI planning additionally needs a current verified Google free-quota observation. The next coding feature remains F14a project rename.

## Local visual evidence

Screenshots are ignored local proof artifacts; they are not published to the public Git repository:

- `.cache/proofs/manual-qa-desktop-final.png` — signed-in Projects after OAuth verification.
- `.cache/proofs/manual-qa-telugu-mobile.png` — Telugu project at 390px.
- `.cache/proofs/manual-qa-projects-mobile.png` — Projects at 320px.
