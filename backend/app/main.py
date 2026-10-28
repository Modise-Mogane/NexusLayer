"""NexusLayer Simulation API - FastAPI application."""

import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .models import Topology
from .topology import load_topology

app = FastAPI(title="NexusLayer Simulation API")

cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "NexusLayer Simulation API"}


@app.get("/api/topology", response_model=Topology)
def get_topology() -> Topology:
    try:
        return load_topology()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail="Default scenario file not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=f"Invalid scenario file: {exc}") from exc
