# NexusLayer

NexusLayer is an AI-assisted heterogeneous network engineering and simulation platform.
Engineers design network architectures, browse and draft communication hardware,
submit research findings, and watch connectivity decisions play out in an interactive
3D world simulation — across terrestrial, satellite, maritime, aviation, and other
environments.

> All link values (latency, bandwidth, reliability, cost, RF budgets) in the bundled
> scenarios are explicitly synthetic example numbers for engineering and simulation
> development. They are NOT measured real-world performance. The UI labels synthetic
> data wherever it appears, and RF results are simplified planning estimates, not
> high-fidelity simulation.

## Modules

| Route | Module | What it does |
| --- | --- | --- |
| `/` | Overview | Project status and entry points into the workflow |
| `/architecture` | Network Architecture Studio | 2D canvas: add/connect/remove devices, validate, save, export/import |
| `/hardware` | Hardware Library | Searchable catalog of representative illustrative devices |
| `/hardware-engineering` | Hardware Engineering Studio | Draft device specs, feasibility checks, AI concept proposals |
| `/research` | Research Lab | Submit findings, stored assessments, human approve/reject/revise |
| `/scenarios` | Scenarios | Saved scenarios, environment templates, edit/simulate/analyze entry |
| `/simulation` | 3D Simulation | Maritime + connected-vehicle worlds, RF handovers, link inspection, live parameter control |
| `/ai` | AI Engineering | Five agent capabilities behind one orchestration layer |
| `/analysis` | Analysis | Route/handover history, availability, latency, assumptions |
| `/settings` | Settings | Routing policy + weights, 3D quality, provider status, data notes |

## Architecture

```
NexusLayer/
├── frontend/          Next.js + TypeScript + Tailwind + React Flow + Three.js/R3F
│   └── src/
│       ├── app/       App Router pages (overview, architecture, hardware, ...)
│       ├── components/ Shared 3D world (sim3d/), 2D canvas, panels, shell
│       ├── e2e/smoke.spec.ts Playwright browser suite (needs running stack)
│       └── lib/api.ts Backend client
├── backend/           FastAPI + Pydantic + NetworkX + SQLite (stdlib)
│   ├── app/
│   │   ├── main.py        REST API (topology, simulation, scenarios, hardware,
│   │   │                  research, agents, validation, RF presets)
│   │   ├── simulation.py  Per-scenario sessions: mobility, RF suitability, failover,
│   │   │                  live link/node parameter updates
│   │   ├── routing.py     Policies: latency, bandwidth, reliability, cost, balanced
│   │   ├── rf.py          Simplified link-budget models (FSPL, RX, margin, hysteresis)
│   │   ├── mobility.py    Kinematic + range/hysteresis suitability models
│   │   ├── compatibility.py Technology/interface feasibility checks
│   │   ├── hardware.py    Device library + spec feasibility checks
│   │   ├── scenarios.py   Saved scenarios + environment templates
│   │   ├── research.py    Finding workflow + deterministic assessments
│   │   ├── agents.py      Five agent capabilities: deterministic base + validated AI proposals
│   │   ├── providers.py   Meta (live-verified) + Baseten adapters, streaming, fallback status
│   │   ├── chat.py        Persistent conversational assistant: tools, citations, proposals
│   │   ├── knowledge.py   Uploads + chunking + FTS5 citation-aware retrieval
│   │   ├── sources.py     34-source allowlisted registry + ingestion service
│   │   ├── coverage.py    Gap classification + ranked proposals + scenario export
│   │   ├── jobs.py        Durable opt-in scheduler (source refresh, reassessment)
│   │   ├── world.py       Shared 8-endpoint multi-device world seed
│   │   ├── traffic.py     Application traffic profiles + fair-share backhaul
│   │   ├── report.py      After-action engineering reports from recorded history
│   │   ├── validation.py  Architecture validation + recommendations
│   │   └── database.py    SQLite persistence (upgrade path: PostgreSQL)
│   ├── data/devices.json  25 representative illustrative devices
│   ├── scenarios/         Bundled maritime_failover.json regression scenario
│   └── tests/             pytest suite (106 tests + 4 opt-in live AI tests)
└── compose.yaml       Backend :8001 + frontend :3000, SQLite volume, AI env_file
```

## Requirements

- Node.js 20+ and npm
- Python 3.11+ (3.12 verified)
- Git, Docker (optional, for Compose)

## Installation

```bash
git clone <repo-url>
cd NexusLayer
```

Backend:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

Frontend:

```bash
cd frontend
npm install
```

Environment variables (optional for local defaults):

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env.local
```

See [.env.example](/.env.example) for documented variables. AI credentials
(`MODEL_API_KEY`, `META_MODEL`, optional `MODEL_BASE_URL` over the documented
`https://api.meta.ai/v1` default) live in `backend/.env` (gitignored) and are
injected into the backend container at runtime via Compose `env_file`; without
them the platform runs fully in deterministic local mode. The AI page offers a
live provider verification button.

## Running the project

### Docker

From the repository root:

```bash
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000) in a browser. The API is at
[http://localhost:8001](http://localhost:8001). SQLite persists in the
`backend-data` volume. Stop with `docker compose down`.

### Without Docker

Start the backend (from the repo root):

```bash
source .venv/bin/activate
python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

Start the frontend (from `frontend/`):

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in a browser.

### Demonstration path

1. Hardware Library: inspect the coastal base station, maritime VSAT terminal,
   multi-WAN gateway, and ship communication system.
2. Network Architecture: view the maritime topology, add a device, validate, save.
3. 3D Simulation (Maritime Failover): Run at 5×, Sail out until the link budget
   drops below the margin threshold, and watch the automatic satellite handover
   with its recorded RX/margin reason. Click a link to inspect signal estimates.
4. Sail back and observe policy-driven re-evaluation with anti-flapping.
5. 3D Simulation (Vehicle Corridor): run the car east and watch the west→east
   cell handover on the same engine.
6. Analysis: review handover history, availability, and assumptions.
7. AI Engineering: verify the live provider, run the architect agent, and accept
   a validated topology proposal as a scenario.
8. Research Lab: submit a finding, request deterministic and AI assessments.

## Backend endpoints

Simulation (all accept optional `?scenario_id=`; default is the maritime session):

- `GET /health`
- `GET /api/topology` — bundled regression scenario
- `GET /api/simulation/state`, `GET /api/simulation/events`, `GET /api/simulation/analysis`
- `POST /api/simulation/start|pause|reset`
- `POST /api/simulation/fail-link|restore-link` (`{"link_id": "..."}`)
- `POST /api/simulation/step` (`{"ticks": n, "dt_seconds": s}`) — advance mobility
- `POST /api/simulation/course` (`{"node_id","velocity_x_kmh","velocity_y_kmh"}`)
- `POST /api/simulation/policy` (`{"policy", "weights?"}`)
- `POST /api/simulation/link-params` — live cost/metric/RF updates per link
- `POST /api/simulation/node-position` — move nodes (tower placement)
- `GET /api/policies`, `GET /api/rf/presets`

Platform:

- `/api/scenarios` — CRUD, duplicate, templates, from-template
- `/api/hardware` — list/search/get/create, `/check` feasibility, `/categories`
- `/api/research` — submit/list/get, `/{id}/assess`, `/{id}/assess-ai`, `/{id}/assessments`, `/{id}/review`
- `/api/agents/status`, `POST /api/agents/run`, `POST /api/agents/verify`
- `POST /api/architecture/validate`

Example — step the vessel one simulated hour:

```bash
curl -s -X POST localhost:8000/api/simulation/step \
  -H 'Content-Type: application/json' -d '{"ticks":1,"dt_seconds":3600}' | head -c 300
```

## Simulation engine

- Deterministic graph routing over per-link latency, bottleneck bandwidth,
  reliability product, and summed synthetic cost.
- Policies: `lowest_latency`, `highest_bandwidth`, `highest_reliability`,
  `lowest_cost`, `balanced` (explicit normalized weights; units never mixed raw).
- Technically infeasible routes (incompatible interfaces, radio families chained
  without a gateway) are rejected before ranking; every decision carries a
  human-readable explanation.
- Anti-flapping: hysteresis margin plus minimum dwell time for voluntary changes;
  forced switches on infeasibility always apply.
- RF suitability: simplified link budgets (FSPL + TX/gains/sensitivity/margins,
  uplink-evaluated, dB hysteresis, slant range for satellite) with per-technology
  presets; range-threshold fallback preserved. See `GET /api/rf/presets` for
  formulas. Illustrative planning estimates, not high-fidelity simulation.
- Mobility: constant-velocity/waypoint kinematics; live course, link-parameter,
  and node-position updates; GNSS positioning modeled separately from data
  connectivity.
- Per-scenario sessions; the maritime regression (45 ms terrestrial / 855 ms
  satellite) is preserved and covered by tests.

## AI engineering

- Provider: Meta Model API (`https://api.meta.ai/v1/chat/completions`,
  OpenAI-compatible), model `muse-spark-1.3`, verified live.
- Every capability returns a deterministic local result plus, when configured,
  a schema-validated model proposal (`ai_verified` provenance); failures name
  the exact limitation and keep the deterministic result.
- Architect proposals validate against topology schemas + compatibility rules
  before preview; the engineer explicitly accepts to save. Research AI reviews
  are stored labeled (`ai:<model>`) and never auto-accept findings.

## Tests

```bash
source .venv/bin/activate
pip install -r backend/requirements-dev.txt
cd backend && python -m pytest tests/ -q
```

106 tests (4 live-AI tests skipped by default): regression failover, routing,
hysteresis/dwell, compatibility, mobility + RF handovers, vehicle corridor,
shared multi-device world, traffic/fair-share, scenarios, hardware, research,
agents (mocked provider), chat, knowledge/RAG, sources, coverage, jobs,
validation, endpoints.
Live AI tests: `NEXUS_LIVE_AI_TESTS=1` with `backend/.env` credentials.

Browser tests (require a running stack):

```bash
cd frontend
npx playwright install chromium  # or set PLAYWRIGHT_CHROMIUM_PATH to system Chrome
npm run test:e2e
```

10 tests: overview, hardware, maritime handover in 3D, vehicle handover,
architecture add/connect/undo/save/reload, research submission + assessment,
shared-world offshore failover + report, chat stream + persist, knowledge
upload/search/registry, coverage analyze → scenario + job run.

## Status and next steps

See [PROGRESS.md](/PROGRESS.md) for completed, partial, and planned work.
Phase 2 priorities: validated AI provider calls, richer mobility/propagation
models, more vehicle/environment scenarios, and result comparison across runs.
