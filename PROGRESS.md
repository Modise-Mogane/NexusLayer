# NexusLayer progress and current state

Checked on 4 November 2026 after the comprehensive UI/UX audit
(Research/Hardware forms labeled + unit-aware, raw-JSON render fixes,
empty-state guidance). Backend suite (**152 passed, 4 skipped**),
production frontend build, Docker images, and browser e2e (**28/28**) all
verified. Containers left running for inspection (`docker compose down`
stops them). Phase 2C Stage D (GNSS/positioning + coverage experiments)
remains planned.

## What the project is today

NexusLayer is a working multi-device network engineering platform: a repaired
and redesigned Architecture Studio, a 10-endpoint shared 3D world (ship,
aircraft, car, phones, laptop, pedestrian, rural settlement) on one
persistent Port Meridian geography with per-endpoint routing, traffic
profiles, and fair-share backhaul; a persistent streaming AI chat grounded
in live engineering tools; an FTS-indexed knowledge base fed by uploads plus
33/34 ingested authoritative sources; and a coverage research module with
ranked proposals and opt-in scheduled jobs; a shell-level Live voice
assistant; a Communications Physics Lab (copper/optical/RF/fiber/
satellite/quantum); and an inter-device messaging engine with hop-traced
delivery over the live network graph. All figures remain synthetic
planning estimates unless labeled measured.

## Completed (UI Experience Overhaul)

### Natural AI replies (no more raw dicts)

- Root cause: the chat prompt dumped `str(tool_result)` dicts labeled
  "authoritative, quote exactly" — the model obeyed literally. Fixed: system
  prompt rewritten (synthesize prose, never paste JSON/dicts/code),
  evidence relabeled INTERNAL, local composer narrates selections in
  natural language (`_narrate_link`) with what-if awareness, plus a
  deterministic `is_raw_dump` backstop that substitutes the local summary
  (persisted + `done.corrected_text`, which both UIs and voice adopt).
- Verified live against Meta muse-spark-1.3: link explanation + follow-up
  in natural prose, real values, zero dump markers; local fallback covers
  no-AI operation. 7 new backend tests (prompt contract, detector,
  prose/what-if replies, stream correction, truncation signaling).

### Reliable voice playback

- Root causes: (1) 1200-char `speakable()` slice truncated long replies;
  (2) single-utterance `speak()` hit the Chrome long-speech stall;
  (3) Live-mode listen restarts called `stopSpeaking()`, cancelling TTS
  every recognition cycle; (4) mid-stream provider errors/length cutoffs
  were silent. Fixed: new `lib/speech.ts` controller (explicit
  idle/speaking/paused/error machine, sentence-boundary queue with retained
  refs, streaming pushText + final-flush finishStream, Chrome resume timer,
  completion only on drain-after-stream-end); mic suspends while speaking
  and resumes on drain; cancels only on user stop / barge-in / new
  request / live-off / unmount; pause/resume/repeat controls; truncation
  and stream errors now append honest tail notes + `finish_reason`.
- 4 new Playwright voice specs (stubbed synth): complete multi-segment
  speech, navigation survival + repeat, deliberate interruption, no-TTS
  fallback. Audible output still unverified (headless has no audio).

### Bright identity + editorial Overview

- `DESIGN_SYSTEM.md` v2.0: light shell (`#e9ebee`/`#fbfcfd`/white, deep
  teal `#0b7a68`), dark `.nx-darkstage` enclaves for the 2D canvas, 3D
  viewport, and the new Physics instrument slab; hairlines over fills;
  motion tokens + `.nx-view/.nx-select-ring/.nx-toast`.
- Overview rewritten: live SVG world strip (real counts, labeled
  illustrative positions, SMIL motion, static under reduced-motion),
  network-now briefing, event timeline, continue-working rail, workspace/
  research status, demonstration path. Controls refined (white fields,
  focus rings, visible toggle); selected arch edges animate teal;
  drawer offers "Open in Physics Lab" for the selected link.

### Full-interface audit fixes (follow-up)

- Whole-app browser audit (14 routes, desktop + tablet, console sweep):
  zero page errors. Verified working as-is: light identity end-to-end,
  Architecture selection/inspector/art (coordinate-click probe), arch↔world
  deep links, tablet panel behavior (sim runs 15 FPS at tablet size).
- Fixed: Research Lab + Hardware Engineering forms were placeholder-only
  (a11y defect) — migrated to labeled Nx controls (`NxTextarea` added) with
  unit-aware fields (Mbps/W/dBm/USD/km); findings list de-slabbed into
  hairline rows with status pills; Analysis handover history rendered raw
  `JSON.stringify` link arrays (fixed to joined IDs) and empty states now
  link into Simulation; Coverage job config rendered as readable key=value.
- 3 new e2e (`e2e/audit.spec.ts`): labeled research/hweng forms submit and
  check, analysis guidance. Suite sizes: backend 152 passed/4 skipped,
  Playwright 28/28; `tsc` clean. THREE.Clock/PCFSoft warnings are
  library-internal (three 0.187/r3f), not app code; min worker cap keeps
  the suite deterministic under SwiftShader.

## Completed (Phase 2C Stage C)

### C1 — Form system, motion, global voice assistant

- New `components/ui/controls.tsx`: NxField/Text/Number(with unit)/Select/
  Toggle/Segmented/Slider/SearchSelect with inline validation + read-only
  vs editable states; `/design` showcase page linked from Settings.
- Motion system in `globals.css` (nx-slide/fade/pop/drawer/live-dot/wave/
  shimmer/flow/ping/photon) + panel motion in WorkbenchShell; all gated
  by `prefers-reduced-motion`. Settings migrated to Nx controls.
- Global assistant: `AssistantProvider` mounted in root layout (survives
  route changes), top-bar Live OFF/ON + conversation drawer, Web Speech
  STT feature-detected + speechSynthesis TTS with honest unsupported
  states, no raw audio retention, mic never auto-opens. Selection context
  (node/link/region/entity/experiment) published from Simulation,
  Architecture, and Physics; server-side `sanitize_context` allowlist —
  frontend state is never dumped into prompts. `useAi` toggle: local
  deterministic compose vs provider streaming; optimistic user bubble +
  thinking indicator.

### C2 — Device imagery + Architecture↔World sync

- `DeviceArt` grew 8 → 19 bespoke blueprint families (laptop/desktop/car/
  train/access point/antenna/server/sensor/camera/cloud/person + prior);
  Architecture and Simulation inspectors show art + deep link to the
  canonical Hardware Library record (`?device=`).
- Deep links: Simulation `?focus=` (select/follow/unplaced-tower placement
  offer), Architecture `?select=` (select/frame/open); Simulation polls
  world version every 12 s and refreshes in place; WorldScene updates via
  R3F reconciliation (no scene rebuild). Arch "View in 3D" / Sim "Open in
  Architecture" share canonical device IDs.

### C3 — Communications Physics Lab

- New `backend/app/physics_lab.py`: deterministic LabResults for copper
  (Ohm/attenuation/thermal noise), optical link budget, fiber guidance,
  radio Friis + free-space, satellite bent-pipe delay/budget, quantum
  teleportation (Bell pair + 2 classical bits, no FTL) and BB84 key
  sifting — each with equations, inputs/units, assumptions, references;
  "Not calculated" with missing inputs, never fabricated values.
- 7 POST endpoints `/api/physics/*`; `/physics` workspace (experiment
  library left, visualization center, parameters right, timeline bottom);
  NavRail entry; LinkInspector "Explore Physics" + `?scenario=&link=`
  prefill from real link parameters. L1 conceptual animations labeled as
  such; L2 engineering calculations editable.

### C4 — Inter-device messaging

- New `backend/app/messaging.py` + `simulation.py` device-route store:
  eligible device routes over the live graph (fair-share backhaul,
  transfer time, cost, security scope, diagnostics); `POST
  /api/messages/send`, `GET /api/messages`; Simulation Messages panel
  (source/dest/kind/size, per-hop trace with physics links, history);
  WorldScene single-pulse flow with latency-proportional timing and a
  stated time-scale; failures animate nothing. Standard phones never
  assume direct satellite — routes must terminate real interfaces.

## Completed (Phase 2C Stage B)

### Unified persistent world (Port Meridian)

- New `backend/app/region.py`: one fictional region (km x-east/y-north,
  harbor-mouth origin, Null Island latlon mapping for future real data),
  7 registered regions (city/suburb/rural/harbor/airport/corridor/offshore)
  with bounds, camera presets, and coverage notes; scenario→focus mapping
  (scenario = activity + camera, never a new landscape).
- New endpoints `GET /api/world`, `/api/world/regions`, `/api/world/focus`;
  `world_position` accepted on node PATCH with fork-on-PATCH preserved.
- Seeds extended by rigid shift only (relative geometry/handover timing
  preserved): rural Saltmeadow settlement (local Wi-Fi, no backhaul by
  design), airport AP, second city cell; maritime v4 + vehicle v2 reseeds.
- 3D: instanced city/suburb/harbor/airport/corridor geography with roads,
  railway reserve, runway, piers, vegetation, and key buildings; satellite
  stays a labeled schematic (link budgets use slant range, never render
  distance). Follow/focus/full-screen/top-view cameras; parent-child
  movement (onboard gear rides ship/aircraft/car).
- World↔Architecture sync: placeable towers/APs (Place in world → Save
  placement) persist `world_position` to the scenario; RF distances follow.

### Label declutter + overlays + inspector (Stage B2)

- Screen-space label arbiter (`WorldScene.tsx`): every label registers its
  anchor + rank; one per-frame pass projects to pixels and hides colliding
  lower-rank labels, with distance gates (infra <110, AP/router <70,
  clients <45, onboard gear <30, region names >80 only), viewport-edge
  culling, behind-camera rejection, hysteresis, and arbitration reset on
  camera jumps. No-route endpoints get an "alert" tier (rank 2, gate 45)
  with amber text + red ring so the rural coverage gap reads in-world.
- 7 overlay modes (clean/active/selected/coverage/health/topology/traffic);
  coverage overlay with fixed-anchored rings + underserved tint (clickable
  region panel); contextual inspector (world/device/link/building/region).
- AI network summary leads with an accessible assessment, expandable
  technical evidence; authoritative values unchanged.

## Completed (Phase 2C Stage A)

### Workbench shell redesign (layout, not just colors)

- New shared shell (`WorkbenchShell`: TopBar, 60px NavRail, collapsible
  left/right panels, BottomDock, StatusBar); Architecture and Simulation
  migrated onto it with canvas priority (~70–80% viewport when collapsed).
- Panel/dock state persists in localStorage; below 1024px panels default to
  collapsed and open as overlays so the workspace stays usable on tablets.
- Verified with before/after desktop screenshots plus a tablet-viewport check.

### Device / interface / port engineering (Stage A2)

- Typed backend models: `NodePortConfig` (10 validated kinds incl. microwave/
  bluetooth/lpwan; VLAN/MTU/duplex validation), `LinkSecurityConfig`
  (+ confidentiality/integrity flags), link `source_port`/`target_port`/
  `protocols`/`security`/`experimental`.
- Compatibility engine: disabled-port and power-port rejection, Wi-Fi channel /
  fiber wavelength / cellular band matching, cross-kind links require a
  conversion path or explicit experimental flag; wired into routing
  feasibility and topology validation.
- PATCH node/link endpoints; patching `maritime_failover` forks a copy so
  the regression seed stays pristine (tested).
- 2D Studio inspector edits interfaces per node (add/remove/enable/disable,
  kind-appropriate RF/wired fields) with save + reload persistence; canvas
  edits flush before PATCH so nothing is lost.

### Physical-layer inspector (Stage A3)

- New `phy.py` service + `GET .../links/{lid}/physics`: per-link medium
  explainer (guided-EM wording for copper, optical budget for fiber, scheduled
  access for cellular, geometry-dominated latency for satellite), distance
  from world geometry, link budget with formula/inputs/units/assumptions,
  propagation delay, wavelength, live simulation state, protocol list,
  hop-scoped security view with scope warning, costs, and source references.
- Honest gaps: SNR, Shannon capacity, and packet loss render "Not calculated"
  with the missing variables named — never fabricated.
- 7-tab link inspector UI (Overview/Medium/Calculations/Protocols/Security/
  Costs/Refs); protocols and security editable; security tab cites 3GPP TS
  33.501 / TLS 1.3 / WPA3 and warns hop security is not end-to-end.
- Frontend/backend schemas aligned after E2E caught drift (security field
  names, port-kind enum, canonical-form dirty tracking).

## Completed (Phase 2B)

### Stage A — Architecture Studio repair + design system

- P0 root cause: React Flow 12 hides nodes until dimensions are reported
  (`visibility: hidden` without measured size); the canvas dropped
  `dimensions` changes in its change handler, so nodes never became visible.
  Rewrote `ArchitectureCanvas.tsx` on the controlled-flow pattern
  (`applyNodeChanges`/`applyEdgeChanges`).
- Studio now: visible topology, add/select/move/connect/delete/duplicate,
  Fit/Center/Snap, zoom/pan, multi-select, 50-step undo/redo, save state,
  validation, `?add=device_id` deep link from Hardware Library, empty/error
  states, E2E-proven add→connect→save→reload round trip.
- `DESIGN_SYSTEM.md`: graphite workspace, warm panels, single teal accent,
  amber warnings, muted status colors, IBM Plex Sans/Mono (bundled offline),
  semantic `nx.*` tokens, full interaction-state coverage.
- Original CC0 stroke icon set (24 families) + blueprint device illustrations;
  no hotlinked or copyrighted manufacturer imagery; license metadata in UI.

### Stage B — Unified multi-device simulation

- Engine generalized to per-endpoint routing (`simulation.py`): every endpoint
  type gets an independent route to internet with its own dwell/hysteresis;
  legacy single-route fields mirror the primary endpoint (maritime regression
  unchanged: 45/855 ms). Route-through-unrelated-endpoint rejected.
- `world.py` shared-world seed: ship + phone + onboard Wi-Fi/router/LTE/VSAT,
  airliner + cabin clients (satellite-only, honestly single-homed), car +
  hotspot + passenger phone, pedestrian + laptop; waypoint patrol loops with
  deterministic cycling; operator course overrides; followers ride leaders.
- Traffic profiles (`traffic.py`): voice/video-call/messaging/browsing/
  file-transfer/telemetry/emergency; fair-share backhaul splitting; per-route
  suitability with reasons (e.g. video call flagged on GEO latency).
- After-action reports (`report.py` + UI overlay + JSON export): per-endpoint
  latency/handovers/outages/technologies, capex/opex from catalog bindings,
  priced links, rule-based recommendations, assumptions, low confidence.
- 3D: combined coast/road/town/sea shell, aircraft/phone/person/laptop/AP/
  router models, co-location fan-out, fixed-anchored coverage rings, selected-
  route highlight, follow-selected, camera presets (overview/top/coast/
  offshore), full-screen, collapsible panel, per-endpoint inspector + traffic
  switching. Analysis page: per-endpoint cards, endpoint-tagged histories.

### Stage C — Conversational AI + knowledge

- Persistent chat (`chat.py` + `/ai` Conversation tab): multi-turn history,
  real SSE streaming (provider tokens, or chunked deterministic delivery),
  conversation sidebar with titles/delete, scenario context, auto capability
  classification with override, six read-only tools (scenario/routes/run/
  devices/knowledge/findings), citation display, proposal payloads with
  explicit Approve (saves via normal APIs + audit note) / Reject.
- Providers: `AI_PROVIDER` selects meta/baseten; per-provider status +
  separate `/api/agents/verify/{provider}`; streaming via SSE parsing.
  Meta `muse-spark-1.3` re-verified live (LINK_OK + grounded chat turn).
  Baseten: key authenticates for `/models`, but `/chat/completions` returns
  403 ("check the api-key") — inference NOT verified; reported as
  partially_configured, never claimed working.
- Knowledge (`knowledge.py` + `/knowledge`): PDF/DOCX/MD/TXT/CSV upload
  (10 MB cap, originals in volume-persisted `var/uploads/`), heading/page
  chunking, FTS5 BM25 search with AND→OR fallback and snippets.
- Sources (`sources.py`): all 34 seeded with org/category/license/trust;
  allowlisted fetcher (robots.txt, public-IP-only with redirect re-checks,
  2 MB/30 s caps, HTML/PDF/text only). Sweep: **33/34 indexed**
  (Cloudflare Radar 403 bot-block honestly recorded).

### Stage D — Coverage research + jobs

- `coverage.py` + `/coverage`: 3 illustrative sample regions (explicitly
  labeled, replaceable via API); gap classifier separating no_data /
  low_adoption / coverage_gap / adequate; 4 deterministic solution templates
  ranked by feasibility + cost-per-coverage-point with catalog capex/opex,
  issues, and assumptions; one-click save-proposal-as-scenario (runnable
  rural topology) for simulation.
- `jobs.py`: durable SQLite job queue (source_refresh, coverage_reassess),
  both OFF by default; manual Run-now, enable/disable, interval ≥ 5 min,
  per-run logs, in-process scheduler thread on app lifespan. Jobs refresh
  data and write reports only — no deploys, no auto-approvals, AI summaries
  off unless explicitly enabled.

### Phase 2A foundation (retained)

- Live-AI single-shot console kept as the "Single run" tab; RF link budgets,
  maritime + vehicle worlds, deterministic fallbacks, maritime regression.

## Partially implemented

- Phase 2C Stage D not started: GNSS positioning + coverage
  experiments (urban/open/enhanced/connectivity-loss scenarios, before/
  after proposal comparisons). Stage C messaging endpoints are ready
  addressable participants.
- Physics Lab what-if AI experiments (C3 §6.8) are manual: engineers
  adjust parameters and ask the assistant; no auto-generated experiment
  configs yet.
- Close-range labels can still partially occlude behind buildings at some
  angles (depth-tested text; resolves on orbit/zoom). Central region names
  (harbor/corridor) lose the overview arbitration to neighbors — the
  Regions panel lists all.
- Environment templates beyond maritime/vehicle/shared_world generate valid
  topologies on the shared Port Meridian geography with scenario focus, but
  have no dedicated camera presets of their own.
- AI topology proposals are single-shot (no retry-with-corrections on
  validation failure); conversational refinement exists via chat context.
- Named application-aware routing presets still expressed via manual balanced
  weights; traffic profiles evaluate suitability but don't re-rank routes.
- RF: no fading, shadowing, interference, antenna patterns, or SINR/capacity
  mapping; satellite remains a static GEO abstraction.
- Retrieval is lexical (FTS5/BM25); vector embeddings are a defined future
  upgrade, not implemented. No model fine-tuning exists (by design).
- Coverage regions ship with illustrative samples; real ITU/World Bank/GSMA
  figures must be entered per region.
- Cloudflare Radar source uninterpolated (403); Baseten inference unverified
  (403) — both honestly reported in UI/API.

## Planned (Phase 3)

1. Named application-aware routing presets; switching-cost/handover penalties.
2. Aviation/railway/rural 3D shells; richer terrain.
3. Run comparison across architectures/hardware/policies; persistent run UI.
4. Pluggable RF extensions (shadowing, rain fade) behind the same interfaces.
5. Failure/event scripting per scenario; advanced playback (scrub/replay).
6. Vector-embedding retrieval upgrade; measurement ingestion and calibration.
7. Region evidence importers (World Bank API, OpenCellID) with provenance.

## Verification (this session)

- Backend: **152 passed, 4 skipped** — prior 145 plus 7 reply-quality
  tests (prompt contract, dump detector, prose/what-if local replies,
  stream correction, truncation + error signaling).
- Browser (system Chrome, software WebGL): **25/25 Playwright e2e** — 21
  prior plus 4 voice-lifecycle specs (complete speech, nav survival +
  repeat, deliberate interruption, no-TTS fallback). Suite workers capped
  at 3: uncapped SwiftShader workers starved sim tests rotationally
  (each failure passed alone); 25/25 stable after the cap. Zero page
  errors throughout.
- Screenshots reviewed (desktop 1600×900 + tablet 1024×768): new
  Overview briefing, tablet + reduced-motion Overview, light arch/sim/
  physics/hardware, physics instrument slab, control showcase, drawer
  with live AI prose reply + evidence toggle.
- Frontend: `tsc --noEmit` clean, `npm run build` passes (production
  Docker images rebuilt from it). Docker: stack healthy.
- Live AI: Meta muse-spark-1.3 `verified`; link explanation + same-thread
  follow-up returned natural prose with real values, no dump markers.
  One transient stream failure observed (fell back to local, correctly
  labeled); one mid-formula cutoff motivated the truncation notes.
  Baseten 403 unverified; 33/34 sources carried over unverified.
- Voice: lifecycle verified via stubbed synth (segments incl. final,
  drain-to-idle, no stray cancels); real mic + audible TTS untested
  (headless has no audio; STT permission-blocked there). FPS 7–8 under
  SwiftShader (scene-dependent; real GPUs unmeasured).

## Run and inspect

```bash
docker compose up --build
```

Open `http://localhost:3000`. API at `http://localhost:8001`.
`docker compose down` stops the stack. AI features need `backend/.env` with
`MODEL_API_KEY` + `META_MODEL`; everything else works without it.
Set `AI_PROVIDER=baseten` + `BASETEN_API_KEY` + `BASETEN_MODEL` only with a
verified inference-enabled key (current key returns 403 on inference).

## Reliability sprint — partial implementation (2026-11-04)

- Scenario full saves now require the loaded revision and use a conditional SQLite update; stale saves return 409. Architecture Studio retains the draft and offers Save copy. Server-side node/link patches also use the revision they read.
- Legacy seeds are no longer deleted automatically when their bundled seed version increases. This conservative safeguard preserves edits, but automatic untouched-seed upgrades and separate seed revision metadata remain outstanding.
- Required startup initialization now logs and fails on error; `/ready` reports readiness and optional-service degradation while `/health` remains a liveness endpoint.
- Provider replies are buffered until the existing raw-dump check completes before being sent to the conversational display and speech. This reduces streaming responsiveness and is not a complete structured-output security boundary.
- Physics Lab discards obsolete calculation responses and clears old results when inputs change. The simulation page starts before scheduling sequential steps and invalidates old loop results; server-side session synchronization remains outstanding.
- Backend suite: 154 passed, 4 skipped after the initial changes; TypeScript and production build passed before the latest simulation-controller edits. Compose configuration validated. Browser/audio verification, migration work, and regression tests for the latest controller remain outstanding.

Verification update: the backend suite subsequently passed with 155 tests and 4 skips, including the isolated legacy-seed regression. The browser suite could not be completed: Playwright's bundled Chromium was absent; with system Chrome, the first research test was interrupted after approximately one minute and the remaining tests did not run. No browser or audio reliability claim is made. The initial post-controller build was disrupted by a concurrently running Next development server; the build was restarted after stopping that server.
The subsequent production build completed successfully after the development server stopped; the standalone TypeScript check also passed.

## Reference-directed world update (2026-11-05)

- The existing procedural world now has a brighter coastal atmosphere, instanced water highlights, offshore islets, a scenic harbor crossing, a denser background skyline and roof caps. These are scenery only; device identities, positions and route state continue to come from scenario and simulation data.
- Region camera presets ease toward their target and respect reduced-motion settings; manual orbit interrupts a transition. Low/standard quality cap pixel density and avoid dynamic shadows, while High opts in to shadows and antialiasing.
- Architecture Studio can hide dense link labels and spread the existing 2D arrangement without moving world positions. A 27-node, 28-link copy of the shared-world scenario was used for isolated verification; `demo/nexuslayer-demo-v2-scenario.json` is an importable topology copy.
- Verification: backend tests 155 passed / 4 skipped; TypeScript and production build passed; two targeted Playwright tests passed. Browser checks opened Overview, Architecture, Simulation, Physics and AI, confirmed that spacing and saving retained world positions, and reported no page errors. The software WebGL renderer showed approximately 9–10 fps; no hardware-integrated GPU measurement was available.
- This is an incremental low-poly procedural improvement, not a complete reproduction of the reference's photorealistic environment or a wholesale UI redesign. The configured AI providers were unavailable during verification.

## UI and digital-twin visual pass (2026-11-05)

- Returned the shared workspace to light neutral surfaces, with a light topology
  canvas and nodes, clearer device artwork, more legible navigation and a
  direct Overview action into the live world. Hardware now distinguishes an
  initial load from an empty search.
- Replaced the straight terrain boundary with a shaped coastline and beach,
  added mixed broadleaf/conifer foliage, refined tower and ship silhouettes, and
  kept water highlights instanced and reduced-motion aware. A first animated
  shader was removed after it reduced software-rendered responsiveness.
- Wireless paths use dashed lines based on link medium; pulses remain tied to
  simulation state and are limited to selected routes and traffic views.
- Added `demo/nexuslayer-digital-twin-example.json`, an importable layout for the
  existing 27-node / 28-link shared topology. The validator reports zero errors
  and four missing wireless-range warnings; no existing scenario is replaced.
- Baseline and current browser captures are under `demo/screenshots/ux-before`
  and `demo/screenshots/ux-after`. `demo/reference-implementation-checklist.md`
  maps the references to current behavior and explicitly lists gaps.
- The visual result remains stylized and substantially less detailed than the
  supplied reference. The Overview is still an illustrative 2D preview, not
  an interactive digital twin, and a complete UI/asset redesign is unfinished.
- Verification for this pass: 155 backend tests passed, 4 skipped; TypeScript
  passed. Playwright passed Architecture edit/save, Physics calculation,
  Architecture↔World deep-link, Hardware Library, 3D overlay/focus, and the
  new layout/world-position regression. The tablet check showed the global
  assistant control within the 820px viewport; reduced-motion CSS computed to
  0.00001 seconds and no page errors were reported in the screenshot pass.
  Headless software WebGL reported roughly 5–13 fps under varying load; no
  physical integrated-GPU benchmark was available.
- The final production build passed after the last world-geometry changes. The
  final screenshot pass completed without page errors and retained all twelve
  requested views plus a tablet view. No video was created or edited in this pass.
