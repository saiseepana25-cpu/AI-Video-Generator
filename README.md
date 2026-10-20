# VideoCraft

Development progress, feature scope, verification and next steps live in **[PROJECT_STATUS.md](PROJECT_STATUS.md)**. Update that file alongside each feature change.

## Dashboard application — authentication and database foundation

The new Next.js application lives in `apps/web`, separate from the existing video prototype. From the repository root:

```sh
npm ci --prefix apps/web
npm run web:db:migrate
npm run web:dev
```

Open **http://127.0.0.1:3000/sign-in**. The Midnight Frame sign-in flow and server authorization protect Projects / Calendar / Settings. Follow **[AUTH_SETUP.md](AUTH_SETUP.md)** to configure the separate web environment file, Google OAuth client, exact team email allowlist and MongoDB database before migrating/starting. Follow **[DATABASE_SETUP.md](DATABASE_SETUP.md)** for explicit migrations, checks and local transaction tests. The primary Google/MongoDB login flow is live-verified; see PROJECT_STATUS.md for evidence and deferred checks. Project APIs/UI and dashboard generation remain later features. The root URL temporarily redirects toward Projects until the product homepage feature is built.

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
