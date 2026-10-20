# VideoCraft — Brand Guidelines: Midnight Frame

| Field | Value |
|---|---|
| Date | 20 October 2026 |
| Status | C — Midnight Frame selected and approved by the user |
| Active Stitch design system | `assets/6834094657248016190` — VideoCraft — Midnight Frame (Approved) |
| Stitch project | Generate AI Video — `14828656073434697599` |
| Current deliverable | Approved C brand, product homepage, and complete numbered application UI review set in Stitch |
| Next step | Designs approved; implement incrementally using PROJECT_STATUS.md and the API/database contracts |

These guidelines explore the application brand. They do not change the [PRD](PRD.md), [system design](SYSTEM_DESIGN.md), [API design](API_DESIGN.md), or [database design](DATABASE_DESIGN.md). The team's video brand kit remains a separate product feature; dashboard branding does not automatically override generated-video branding.

## 1. Brand foundation

**Product:** VideoCraft turns an idea into an educational motion explainer, with matching narration and subtitles and a simple Plan → Generate → Publish workflow.

**Personality:** Clear, creative, confident, calm, and professional. The futuristic quality comes from precise geometry, purposeful motion, and strong composition.

**Working headline:** “Make ideas move.”

**Supporting line:** “Clear explanations. Thoughtful motion.”

Use plain, helpful copy: “Create video”, “Review plan”, “Approve and generate”, “Download video”, and “Schedule post”. Explain waiting and failures with a next action. Essential actions and status descriptions must remain understandable without icons or color.

## 2. Approved direction and decision history

| Direction | Character | Headings | Body / interface | Recommendation |
|---|---|---|---|---|
| A — Cobalt Studio | Light, crisp, confident; blue with small lime highlights | Space Grotesk, 600 | Inter, 400/500/600 | REJECTED — historical reference only |
| B — Warm Signal | Warm, editorial, approachable; teal with coral highlights | Manrope, 600/700 | DM Sans, 400/500/600 | REJECTED — historical reference only |
| C — Midnight Frame | Dark, precise, immersive; soft violet with mint highlights | Sora, 600 | Inter, 400/500/600 | SELECTED AND APPROVED — sole active direction |

The user selected C on 20 October 2026 and requested a product homepage with a prominent hero. **Only C is active.** A/B and earlier C exploration boards remain as historical references; do not use them for new pages or offer theme switching. Noto Sans Telugu remains the Telugu font. The canonical C tokens below supersede minor differences in earlier boards.

### A — Cobalt Studio palette (REJECTED / archive)

| Role | Color | Use |
|---|---|---|
| Canvas | `#F6F7F9` | Main background |
| Surface | `#FFFFFF` | Panels and cards |
| Ink | `#141D28` | Main text, dark text on lime |
| Muted | `#536174` | Secondary text |
| Primary | `#1E4FDB` | Primary actions, links, selection, focus |
| Primary hover | `#173FAF` | Interactive hover state |
| Accent | `#C3EF66` | Small diagram highlights and motion details |
| Decorative border | `#DCE1E8` | Nonessential dividers and card edges |

White text on primary: **6.57:1**. Muted on canvas: **5.88:1**. Ink on lime: **12.83:1**. Buttons/fields: 10px radius; cards: 16px. Signature motif: frame corners and a short motion path.

### B — Warm Signal palette (REJECTED / archive)

| Role | Color | Use |
|---|---|---|
| Canvas | `#F7F4ED` | Warm main background |
| Surface | `#FFFEFA` | Panels and cards |
| Ink | `#172E2C` | Main text, dark text on coral |
| Muted | `#52635F` | Secondary text |
| Primary | `#006B5E` | Primary actions, links, selection, focus |
| Primary hover | `#005348` | Interactive hover state |
| Accent | `#EB835F` | Small diagram highlights and annotations |
| Decorative border | `#DEDCD3` | Nonessential dividers and card edges |

White text on primary: **6.43:1**. Muted on canvas: **5.78:1**. Ink on coral: **5.43:1**. Buttons/fields: 8px radius; cards: 12px. Signature motif: annotation brackets and short coral motion trails.

### C — Midnight Frame palette (APPROVED / canonical)

| Role | Color | Use |
|---|---|---|
| Canvas | `#101218` | Main background and dark button text |
| Surface | `#1B1E27` | Panels and cards |
| Elevated | `#242936` | Controls and secondary surfaces |
| Ink | `#F4F2FA` | Main text |
| Muted | `#AAB1C0` | Readable neutral secondary text |
| Primary | `#B7A4FF` | Primary actions and selection; dark text |
| Primary hover | `#C4B5FD` | Hover state; dark text |
| Accent | `#7EDDCF` | Small diagram highlights; dark text |
| Decorative border | `#343946` | Nonessential dividers and card edges |

Dark text on primary: **8.71:1**. Muted on surface: **7.74:1**. Dark text on mint: **11.71:1**. Buttons/fields: 10px radius; cards: 12px; hero media: 16px. Signature motif: framing corners and precise diagram paths, without neon glow.

The refined C exploration had a mauve secondary-text token. The approved system restores neutral `#AAB1C0` for clearer secondary text. All new designs use this canonical C palette; A/B values are archived, not fallback options.

## 3. Color and accessibility rules

- Aim for roughly 80% neutral surface area, 15% structural ink/primary color, and 5% accent. This is a composition guide, not a measured pixel requirement.
- Accent colors highlight teaching content and occasional identity details. They are not universal success indicators.
- Use at least 4.5:1 for normal text and 3:1 for large text and necessary control boundaries. Verify actual component states and adjacent colors during homepage design; the calculations above check only the listed pairs, not whole-board compliance.
- Pale decorative borders do not define an input's only visible boundary. Proposed light control outline: `#8793A3` on white (3.12:1); dark control outline: `#7B8498` on `#1B1E27` (4.44:1). Validate on the actual chosen field surface.
- Use a visible 2px focus outline with separation from the component. Keep focus visible on both filled and unfilled controls.
- Draft, generating, ready, warning, and failure each need a readable text label and an appropriate icon. Define final semantic foreground/background tokens after selecting the direction.
- Do not communicate selected language, errors, status, or progress through color alone.

## 4. Typography

| Role | Size / line height | Weight |
|---|---|---|
| Product-homepage display | 64 / 72px desktop; 36 / 44px mobile | Sora 600 |
| Brand-board / compact display | 48 / 56px | Sora 600 |
| Page heading | 32 / 40px | 600 |
| Section heading | 24 / 32px | 600 |
| Body | 16 / 24px | 400 |
| Interface labels | 14 / 20px | 500 or 600 |
| Secondary metadata | 13 / 20px | 400 or 500 |
| Telugu sample body | 18px / 1.7 | 400 or 500 |

Use the heading family for short headings and the body family for controls and long copy. On narrow screens, reduce large headings to 28–32px without shrinking essential text. Monospace is optional for durations or technical tokens on the guidelines board, not the default interface voice.

Telugu uses Noto Sans Telugu, normal letter spacing, adequate vertical padding, and content-driven height. Avoid forced uppercase, fixed-height text boxes, and clipping vowel signs or conjuncts. Set the language of Telugu content appropriately. Use a system sans-serif fallback for Latin and a Telugu-capable fallback such as Nirmala UI for native script while fonts load.

The board's English and Telugu specimens are separate font examples. The product still uses one selected language for both narration and subtitles; it has no separate subtitle-language selector or transliteration mode.

## 5. Layout, components, and shapes

- Spacing scale: **4, 8, 12, 16, 24, 32, 48, 64px**.
- Desktop board: fluid width, maximum 1360px, 32px gutters; compact screens use 16–24px gutters. Application workspaces may use available width where the task benefits.
- Use a clear hierarchy, aligned edges, restrained shadows, and 1px decorative separators. Allow captions, headings, badges, and controls to wrap.
- Buttons and touch controls target at least **44 × 44px**. Avoid pill shapes for every container; reserve them for compact badges or suitable segmented controls.
- Primary button: solid action color; secondary button: neutral surface with a clear boundary; destructive action: distinct semantic treatment with explicit wording.
- Inputs show labels, typed content, helper/error text, focus, saving, and disabled states. Placeholders never replace labels.
- Language control: **English / తెలుగు**. Duration: **30s / 60s / 90s**. Voice and accent are distinct compatible controls; sample voice inventories must not imply unverified provider availability.
- A project card uses a useful video thumbnail, title, language, actual/target duration as applicable, and a labeled status. Avoid decorative metrics or invented performance statistics.
- Approved icon direction: consistent simple outline icons, 1.75px stroke at 24px. Essential icon buttons have accessible names and appropriate visible labels/tooltips.

## 6. Illustration, identity, and motion

Use clear flat diagrams, arrows, labels, charts, and geometric illustrations that explain a concept. Consistent line weight and meaningful color matter more than decoration. Portrait previews should show recognizably educational content.

Use the C geometric frame/play mark with the VideoCraft wordmark. Maintain readable wordmark spacing and a clear small-size silhouette; do not rely on tiny decorative details.

Interface transitions generally use **160–220ms**, with an ease-out curve such as `cubic-bezier(0.2, 0, 0, 1)`. The homepage hero may use a deliberate 8–10-second diagram sequence: idea, visual scene, narration waveform, and matching subtitles. Provide Pause animation, no autoplay audio, and a complete static reduced-motion alternative. Respect reduced-motion preferences by removing travel, looping decoration, and nonessential transitions. Verify any live motion in the Stitch preview before claiming it works. Video narration/scene timing is governed by the media pipeline, not this interface duration token.

Keep decorative effects restrained: no heavy glass panels, pervasive gradients, neon bloom, robot art, or repeated sparkle motifs. Prefer a small reusable signature such as frame corners or a short motion trail.

## 7. Product rules carried into the homepage

- Preserve Plan → Generate → Publish inside the project workspace, with combined plan review.
- The user explicitly selected a product homepage with hero on 20 October 2026. This is separate from the signed-in Projects landing surface. Its Open studio action uses the existing authentication/allowlisted-team entry; it does not introduce public signup, a waitlist, or a new backend API.
- Show real loading, saving, progress, error, and empty states when designing actual pages. Do not invent overall generation percentages or completion times.
- Keep free-provider evaluation restrictions truthful. A visual mockup does not establish a voice's availability or publication rights.
- V1 has no customer billing, credit meter, upgrade CTA, or subscription cards.
- App identity and video brand-kit customization remain separate.

## 8. Review artifacts and next step

Stitch project: [Generate AI Video](https://stitch.withgoogle.com/projects/14828656073434697599).

Historical source boards (the approved design-system asset above is authoritative):

| Board | Stitch screen ID |
|---|---|
| REJECTED — VideoCraft Brand Direction A — Cobalt Studio (Refined) | `075257a2862a4fdeb41b9af311aa00bc` |
| REJECTED — VideoCraft Brand Direction B — Warm Signal (Refined) | `f3979532ea1649b78a4dfd1000761df1` |
| Selected source — VideoCraft Brand Direction C — Midnight Frame (Refined) | `88490b194139455fa5fbe38e072666fd` |

The rendered boards were visually reviewed and refined for clipping, example copy, and truthful voice controls. Palette text-pair calculations passed the normal-text contrast threshold for the specified pairs. Interactive accessibility and full responsive behavior still need verification on actual page designs and implementation.

Board microcopy remains illustrative. Incidental references to 60fps rendering, WebM, classroom/LMS streaming, or a ready video already being published do not define product capabilities. Before homepage design, use the approved V1 contract: 1080×1920 at 30fps, H.264/AAC MP4, ready versus published as separate states, and explicit Instagram publishing/scheduling approval.

**Brand decision complete:** C and the application/homepage designs are approved; A and B are rejected. The homepage includes hero and studio entry; clearly illustrative educational video examples; Plan → Generate → Publish; English and Telugu with same-language subtitles; review/download/Instagram publishing and scheduling; concise FAQ; final studio CTA and footer. Follow PROJECT_STATUS.md for feature-by-feature implementation and contract reconciliation.

The user approved the Midnight Frame application designs and requested incremental implementation. The numbered screens and mobile counterparts are listed in [UI_REVIEW.md](UI_REVIEW.md). Their illustrative controls do not expand the API/database contracts; feature progress and reconciliation decisions are tracked in [PROJECT_STATUS.md](PROJECT_STATUS.md).

### Current review artifacts

| Artifact | Stitch screen ID | Review link |
|---|---|---|
| VideoCraft — Midnight Frame — Approved Brand Guidelines | `aab6bb8b19b444a7898399c6b290659e` | [Brand board](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=aab6bb8b19b444a7898399c6b290659e) |
| VideoCraft — Product Homepage — Midnight Frame (Review) | `8f86a379e42f45a180a0c710da2ca7ef` | [Desktop homepage](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=8f86a379e42f45a180a0c710da2ca7ef) |
| VideoCraft — Product Homepage — Mobile (Review) | `3860407831e84e1187506aace7812b39` | [Mobile companion](https://stitch.withgoogle.com/preview/14828656073434697599?node-id=3860407831e84e1187506aace7812b39) |

The homepage is a separate product page, not the signed-in project dashboard. Its primary action is Open studio; the final application will resolve `/sign-in` against the product's own origin. A relative sign-in link inside Stitch is a design destination, not a deployed application login. No signup, billing, capture form, or new backend contract is introduced by this design.

The hero pairs “Make ideas worth watching.” with a sunlight → solar panel → electricity diagram, portrait frame, waveform and matching English subtitle. The preview uses live CSS animation with pause/resume and declares a static reduced-motion alternative. Pause/resume state and native FAQ expansion were checked in the polished desktop Stitch preview. The mobile companion's menu expansion/collapse and pause/resume state were also checked; both previews declare reduced-motion CSS. This validates the design preview only; production motion, reduced-motion behavior, keyboard/focus behavior and integration still need testing during implementation. The illustrative graphics are not generated-video playback or live publishing records.

Stitch currently stores the mobile companion as a desktop-sized canvas containing the narrow stacked composition. Use its mobile content/layout as the reference; canvas device metadata does not prove responsive rendering. Its Open studio links currently point to a local `#open-studio` design anchor. During reconciliation, wire every studio CTA consistently to the product-origin `/sign-in` entry, and test 375/390/430px widths plus desktop. These are implementation/handoff checks, not additional product features.
