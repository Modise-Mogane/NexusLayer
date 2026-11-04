# NexusLayer Design System

Version 2.0 — UI Experience Overhaul. Goal: human-designed engineering
software, not a generic dashboard. Precision, technical credibility,
readability, hierarchy. v2.0: bright light shell with dark technical
enclaves, editorial Overview, refined controls, tokenized motion, reliable
voice playback states.

## Tokens (Tailwind `nx.*` + CSS)

The shell is bright and neutral; hierarchy comes from spacing, type, and
composition — hairline separators only where function needs them. No card
shadows, no decorative fills, no glow, no gradients except data-driven
signal shading.

| Token | Value | Use |
| --- | --- | --- |
| `workspace` | `#e8eff3` | App background |
| `panel` | `#f8fafb` | Panels, nav, headers |
| `raised` | `#ffffff` | Editable fields, menus, wells |
| `line` | `#ccd9df` | Hairlines, dividers (use sparingly) |
| `ink` | `#142f40` | Primary text, headings |
| `body` | `#355160` | Secondary text |
| `muted` | `#5d7380` | Labels, meta, placeholders (4.5:1 on panel) |
| `accent` | `#0b7465` | Teal: selection, active, primary action (sole dominant accent) |
| `accentdim` | `#085c51` | Accent hover/pressed |
| `ok` | `#0b7465` | Connected, backup, success |
| `warn` | `#886019` | Attention, standby, unsuitable |
| `bad` / `badink` | `#a63d36` / `#912f2a` | Failures, errors (ink for text on light) |

The Architecture Studio uses a pale blue-gray canvas and white device nodes,
with dark, high-contrast text and status-colored links. The Physics Lab retains
a dark instrument stage. The 3D environment uses its own daylight scene
lighting and does not inherit interface colors.

## Typography

- Interface: IBM Plex Sans (400/500/600/700), bundled via Fontsource (offline-safe).
- Technical values, labels, IDs: IBM Plex Mono.
- Scale: page title 15px semibold tight; section labels 11px mono uppercase
  tracked; body 12px; meta 10–11px mono. Overview may use a 24px section heading to anchor its world preview.

## Layout

- Workbench shell: TopBar (brand, project, save state, actions) + 68px icon
  NavRail + contextual left panel + central workspace + contextual right
  inspector + collapsible BottomDock + 32px status footer.
- Canvas priority: the 2D/3D workspace dominates (~70–80% of the viewport
  with panels collapsed); side panels and dock are collapsible
  and must never squeeze the canvas into a sliver.
- Responsive: below 1024px the side panels become absolute overlays and
  default to collapsed (a stored open/closed preference always wins); the
  workspace stays fully interactive with panels closed.
- Inspector pattern: narrow right panel, 10–12px technical type, tab bars
  for multi-facet objects (link: Overview/Medium/Calculations/Protocols/
  Security/Costs/Refs). Engineering values render as mono label/value rows
  with units; unknowable values show "Not calculated" + missing inputs,
  never a fabricated number.
- Density over whitespace: 12px base, 8px panel padding. Panels: 6px radius
  (`rounded-md`), 1px `line` borders, flat (no shadows except canvas node
  elevation and small-screen overlays).

## Components

- Buttons: `.nx-btn-primary` (deep teal, white text), `.nx-btn-ghost`
  (raised + hairline); disabled at 40% opacity with `cursor-not-allowed`;
  every destructive action uses the bad color and, for deletes, a confirm step.
- Fields: `.nx-field` (white fill, hairline, accent focus + soft ring).
  Read-only values render on workspace gray, muted — never editable-looking.
- Engineering controls (`components/ui/controls.tsx`, live at `/design`):
  `NxField` label/hint/error wrapper; `NxTextInput` + `NxNumberInput` with
  attached unit cells and inline range validation (commit on blur/Enter);
  `NxSelect` (native, styled, keyboard-accessible); `NxToggle` (switch role);
  `NxSegmented` (radio group); `NxSlider` (range + editable number);
  `NxSearchSelect` (combobox with filter), `NxTextarea` (multiline).
  Forms always carry visible labels — placeholder-only fields are banned.
  Read-only values render muted — never editable-looking. Icon-only buttons
  always carry an explicit `aria-label` (emoji/title alone is not a name).
  Lists read as hairline rows with status pills, never solid gray slabs;
  user-facing text never embeds raw JSON — structured data goes behind an
  explicit technical-details disclosure.
- Notes: `.nx-note-ok/info/warn/bad` — tinted fills, never bare colored text.
- Canvas: pale blue-gray background, dot grid, Fit/Center/Snap overlay, light
  controls + minimap, status legend. 2D nodes: icon tile + label + mono type
  line + status dot; selected = accent border + ring.
- Links by technology (dash) × status (color): fiber/Ethernet solid, cellular
  long-dash, Wi-Fi dotted, satellite long-dash-dot, microwave/radio dashed,
  experimental fine-dotted.
- 3D: active route = solid tube + traveling pulses; backup green, unsuitable
  amber, down red; coverage rings from RF ranges; labels with dark outline.
- 3D labels (Stage B): screen-space arbitration — rank order selected /
  unreachable / on-route (always) > infra + vehicles > AP/router +
  no-route alert > clients > onboard gear > region names; distance gates
  per tier; viewport-edge culling; hysteresis with reset on camera jumps.
  No-route endpoints render amber text + red ring. Region names are
  high-floating area tags, overview-only; underserved regions win ties.
- States: every async surface has loading / empty / error / offline variants;
  save state always visible in editors (Saved time / Unsaved changes / Saving).
- Global assistant: shell-level session + top-bar Live control (OFF by
  default; mic never auto-opens) + right conversation drawer overlay. Voice
  phase machine — idle/listening/thinking/speaking/paused/error — one state
  visible at a time with a text equivalent: listening (waveform + interim
  transcript), thinking/streaming, speaking (stop/pause/repeat), paused,
  error (plain-language cause + text fallback). Replies are natural prose;
  tool evidence hides behind "Show technical evidence". Voice capability is
  feature-detected and reported honestly; text always works.
- Physics Lab: experiment library (left) + dark instrument slab with the L1
  conceptual visualization (center, fullscreen-capable) + unit-aware
  parameters and L2 results (right) + equation timeline (dock). Fidelity
  badges on everything: L1 = conceptual animation, L2 = deterministic
  calculation.
- Overview: editorial briefing, never a tile grid — live world strip (SVG,
  real counts, labeled illustrative positions) + network-now briefing +
  event timeline + continue-working actions + workspace/research rail.
- Message flow: one accent pulse per traced session; hop timing proportional
  to modeled latency with a stated time-scale factor; path links join the
  focus set. Failed sessions animate nothing — the panel states the reason.

## Iconography & imagery

- UI/device glyphs: original `DeviceIcon` stroke set (24 families) — no emoji.
- Catalog art: original `DeviceArt` blueprint illustrations (CC0), framed
  glyph fallback elsewhere. AI concepts labeled as concepts, never products.
- Device imagery (Stage C): 19 bespoke families (satellite, tower, router,
  switch, dish, phone, aircraft, ship, laptop, desktop, car, train, access
  point, antenna, server, sensor, camera, cloud, person) shown in the
  Architecture and Simulation inspectors, deep-linked to the canonical
  Hardware Library record via `?device=`. Satellite/vehicle art follows
  placement rules, never misrepresents scale.
- 3D models: low-poly originals; quality setting + reduced-motion respected.

## Interaction

- Immediate feedback for every action (appear/select/inspect/persist).
- Canvas: drag, pan, zoom, multi-select (Shift), Del, undo/redo (Ctrl+Z/Y),
  snap-to-grid, click empty space to deselect.
- Focus-visible accent outline everywhere; `prefers-reduced-motion` disables
  pulses and animation.
- Motion tokens (`--nx-dur-instant/fast/med`, `--nx-ease-out/spring`):
  one family of durations/easing for the whole product; nothing bouncy,
  nothing perpetual except live-state pulses.
- Motion utilities (globals.css), all state-driven, never decorative:
  `.nx-view` (route settle), `.nx-panel-left/right` (panel mount),
  `.nx-swap` (inspector content change — key by selected id), `.nx-pop`
  (menus), `.nx-drawer` (assistant), `.nx-select-ring` (canvas selection
  answer), `.nx-toast` (event notices), `.nx-live-dot` (live pulse),
  `.nx-wave-bar` (voice activity), `.nx-shimmer` (loading),
  `.nx-flow/.nx-ping/.nx-photon` (physics L1 signal motion).

## Data visualization

- Bars/timelines only from real state; mono numerals; synthetic values always
  labeled; costs carry currency + units with capex/opex/usage separated.

## Visual reference work (November 2026)

The workspace uses light blue-gray surfaces and dark text. Architecture nodes
and canvas use light surfaces with status colors; labels can be hidden on dense
networks. The 3D environment uses daylight, a shaped coast, instanced water
highlights, procedural vegetation and a lightweight water material. Scenic
objects do not define connectivity. Wireless paths are dashed and wired active
paths are solid; both derive from the scenario and simulation state. Motion is
reduced when the browser requests it. Graphics quality controls retain the
low/standard path without dynamic shadows and cap pixel density.

The current Overview illustration remains a labeled illustrative preview rather
than a second 3D renderer. See `demo/reference-implementation-checklist.md` for
reference coverage and visual limitations.
