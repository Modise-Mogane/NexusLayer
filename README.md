# NexusLayer

NexusLayer is an AI-assisted heterogeneous network engineering and simulation platform.
The long-term goal is to let engineers design, simulate, analyze, and optimize
communication architectures combining terrestrial, satellite, maritime, and aerial networks.

This MVP (built for the Meta Global AI Developer Hackathon) demonstrates maritime
connectivity and intelligent network failover: a vessel with a terrestrial cellular
primary link and a satellite backup link, visualized as an interactive topology.

> All link values (latency, bandwidth, reliability) in the bundled scenario are
> explicitly synthetic example numbers for UI/simulation development. They are
> NOT measured real-world performance.

## Architecture

```
NexusLayer/
├── frontend/                 Next.js + TypeScript + Tailwind CSS + React Flow
│   └── src/
│       ├── app/              App Router pages (dashboard)
│       ├── components/       Toolbar, sidebar, canvas, panels, status bar
│       └── lib/api.ts        Backend client (health + topology)
├── backend/                  FastAPI + Pydantic (+ NetworkX, planned use)
│   ├── app/
│   │   ├── main.py           FastAPI app, CORS, /health, /api/topology
│   │   ├── models.py         Pydantic topology models
│   │   └── topology.py       Scenario file loader
│   ├── scenarios/
│   │   └── maritime_failover.json   Initial synthetic scenario
│   └── requirements.txt
├── .venv/                    Project Python environment (created on setup)
├── .env.example              Documented environment variables (no secrets)
└── README.md
```

The frontend fetches topology JSON from the backend at runtime and renders it
with React Flow. No database, no authentication in this MVP.

## Requirements

- Node.js 20+ and npm
- Python 3.11+ (3.12 verified)
- Git

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
cp .env.example .env            # backend: API_HOST, API_PORT, CORS_ORIGINS
cp frontend/.env.example frontend/.env.local   # frontend: NEXT_PUBLIC_API_URL
```

See [.env.example](/.env.example) for the documented variables. Defaults work
for local development without any files.

## Running the project

Start the backend (from the repo root):

```bash
source .venv/bin/activate
python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

Backend endpoints:

- `GET /health` → `{"status": "ok", "service": "NexusLayer Simulation API"}`
- `GET /api/topology` → nodes + links of the maritime failover scenario

Start the frontend (from `frontend/`):

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in a browser.

Verify manually:

1. The dashboard loads (toolbar, sidebar, workspace, properties panel, status bar).
2. The status bar shows "Backend connected".
3. The topology canvas shows 5 nodes (ship, base station, satellite, gateway,
   internet) with labeled links.
4. Clicking a node or link shows its details in the properties panel.

## Implemented features

- Engineering dashboard layout: top toolbar, left sidebar, central React Flow
  workspace, right properties panel, backend connectivity status bar.
- Backend-driven topology: the graph is fetched from `GET /api/topology`, not
  hardcoded in the frontend.
- `maritime_failover.json` scenario with latency, bandwidth, reliability,
  status, and technology attributes per link (synthetic values).
- CORS configured for local frontend↔backend development.
- Graceful error states (backend unreachable → status bar + canvas retry UI).

## Planned features (not implemented)

- Network simulation engine (failover behavior, deaths/coverage, metrics).
- AI agent for network analysis and optimization (Meta Model API / Muse Spark).
- Scenario editor (create/edit topologies in the UI).
- Additional domains: aerial and full terrestrial/satellite constellations.
- Authentication, persistence/database, cloud deployment.
