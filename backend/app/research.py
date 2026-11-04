"""Research lab: finding submission + deterministic assessment workflow.

Assessments produced locally are LABELED as deterministic heuristic
reviews (not AI verification). When an AI provider is configured, the
agents layer may attach an additional model review; both are stored and
a human verdict (approve/reject/revise) is required before any claim
changes status.
"""

import re
import uuid

from pydantic import BaseModel, Field

from . import database as db

CATEGORIES = (
    "propagation", "protocols", "hardware", "routing",
    "measurement", "hypothesis", "other",
)
VERDICTS = ("plausible", "needs_experiments", "unsupported", "contradicted")
STATUSES = ("submitted", "assessed", "approved", "rejected", "revised")


class ResearchSubmission(BaseModel):
    title: str = Field(min_length=4, max_length=200)
    category: str = "hypothesis"
    problem: str = ""
    assumptions: str = ""
    measurements: str = ""
    references: str = ""
    use_cases: str = ""
    impact: str = ""
    confidence: str = "low"
    limitations: str = ""


class ResearchFinding(ResearchSubmission):
    id: str
    status: str = "submitted"
    created_at: str = ""
    updated_at: str = ""


class Assessment(BaseModel):
    id: str
    finding_id: str
    created_by: str
    verdict: str
    claims: list[str] = Field(default_factory=list)
    contradictions: list[str] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)
    experiments: list[str] = Field(default_factory=list)
    compatible_devices: list[str] = Field(default_factory=list)
    summary: str = ""
    created_at: str = ""


CONTRADICTION_RULES: tuple[tuple[str, str], ...] = (
    (r"passive.{0,20}adapter.{0,60}(lte|cellular).{0,60}satellite", "A passive adapter cannot convert LTE radio into satellite waveforms; transceivers plus gateway termination are required."),
    (r"(faster|beyond).{0,20}(light|speed of light)|ftl", "Claims exceeding the speed of light contradict established physics."),
    (r"perpetual|free energy|over-?unity", "Over-unity energy claims contradict conservation of energy."),
    (r"gps.{0,20}(internet|broadband|data channel)", "GPS/GNSS provides positioning signals, not an internet data channel."),
    (r"decrypt.*without.*key|break.*aes.*instantly", "Breaking modern encryption instantly contradicts established cryptographic results."),
)

SUPPORT_KEYWORDS = ("measured", "dbm", "mhz", "ghz", "mbps", "ms latency", "packet loss", "experiment", "testbed")


def scan_text(text: str) -> dict:
    """Deterministic pre-scan shared by local assessment and the AI agent."""
    contradictions = [msg for pattern, msg in CONTRADICTION_RULES if re.search(pattern, text, re.IGNORECASE)]
    lowered = text.lower()
    return {
        "contradictions": contradictions,
        "has_evidence_keywords": any(k in lowered for k in SUPPORT_KEYWORDS),
    }


def assess_finding(finding_id: str, submission: ResearchSubmission) -> Assessment:
    text = " ".join([
        submission.title, submission.problem, submission.assumptions,
        submission.measurements, submission.impact,
    ])
    claims = [c.strip() for c in re.split(r"[.\n]+", submission.problem) if len(c.strip()) > 12][:8]
    if not claims:
        claims = [submission.title.strip()]
    scan = scan_text(text)
    contradictions = scan["contradictions"]
    missing: list[str] = []
    if not submission.measurements.strip():
        missing.append("No measurements or test results provided.")
    if not submission.assumptions.strip():
        missing.append("No explicit technical assumptions stated.")
    if not submission.limitations.strip():
        missing.append("No known limitations declared.")
    if not submission.references.strip():
        missing.append("No supporting references provided.")
    lowered = text.lower()
    has_evidence = any(k in lowered for k in SUPPORT_KEYWORDS) or bool(submission.measurements.strip())

    experiments = [
        "Define a falsifiable hypothesis with numeric pass/fail thresholds.",
        "Build a NexusLayer scenario reproducing the claimed link budget or topology.",
        "Run the simulation with declared assumptions and record route/availability metrics.",
        "Compare against a baseline (existing technology) under identical conditions.",
    ]
    if "satellite" in lowered:
        experiments.append("Model satellite path latency/geometry separately from terrestrial measurements.")
    compatible_devices = ["gen-gateway-multiwan-01"]
    if "lora" in lowered or "iot" in lowered:
        compatible_devices.append("gen-iot-gateway-01")
    if "maritime" in lowered or "ship" in lowered or "vessel" in lowered:
        compatible_devices.append("gen-ship-comms-01")

    if contradictions:
        verdict = "contradicted"
    elif not has_evidence:
        verdict = "needs_experiments"
    elif missing:
        verdict = "unsupported"
    else:
        verdict = "plausible"
    summary = (
        f"Deterministic heuristic review ({len(claims)} claim(s)): verdict {verdict}. "
        f"{len(contradictions)} contradiction(s), {len(missing)} gap(s). "
        "Requires human review; not experimental verification."
    )
    aid = str(uuid.uuid4())[:8]
    assessment = Assessment(
        id=aid, finding_id=finding_id, created_by="local_deterministic",
        verdict=verdict, claims=claims, contradictions=contradictions,
        missing=missing, experiments=experiments,
        compatible_devices=compatible_devices, summary=summary,
        created_at=db.now_iso(),
    )
    conn = db.connect()
    try:
        conn.execute(
            "INSERT INTO assessments (id, finding_id, created_by, data_json, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (aid, finding_id, "local_deterministic", db.dump_json(assessment.model_dump(mode="json")), assessment.created_at),
        )
        conn.execute(
            "UPDATE research_findings SET status = 'assessed', updated_at = ? WHERE id = ?",
            (db.now_iso(), finding_id),
        )
        conn.commit()
    finally:
        conn.close()
    return assessment


def submit_finding(submission: ResearchSubmission) -> ResearchFinding:
    if submission.category not in CATEGORIES:
        raise ValueError(f"Unknown category {submission.category!r}")
    fid = str(uuid.uuid4())[:8]
    finding = ResearchFinding(**submission.model_dump(), id=fid, status="submitted", created_at=db.now_iso(), updated_at=db.now_iso())
    conn = db.connect()
    try:
        conn.execute(
            "INSERT INTO research_findings (id, title, status, data_json, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (fid, finding.title, "submitted", db.dump_json(finding.model_dump(mode="json")), finding.created_at, finding.updated_at),
        )
        conn.commit()
    finally:
        conn.close()
    return finding


def list_findings() -> list[ResearchFinding]:
    conn = db.connect()
    try:
        rows = conn.execute("SELECT data_json FROM research_findings ORDER BY created_at DESC").fetchall()
        return [ResearchFinding.model_validate(db.load_json(r["data_json"])) for r in rows]
    finally:
        conn.close()


def get_finding(fid: str) -> ResearchFinding | None:
    conn = db.connect()
    try:
        row = conn.execute("SELECT data_json FROM research_findings WHERE id = ?", (fid,)).fetchone()
        return ResearchFinding.model_validate(db.load_json(row["data_json"])) if row else None
    finally:
        conn.close()


def set_finding_status(fid: str, status: str) -> ResearchFinding | None:
    if status not in STATUSES:
        raise ValueError(f"Unknown status {status!r}")
    finding = get_finding(fid)
    if finding is None:
        return None
    finding.status = status
    finding.updated_at = db.now_iso()
    conn = db.connect()
    try:
        conn.execute(
            "UPDATE research_findings SET status = ?, data_json = ?, updated_at = ? WHERE id = ?",
            (status, db.dump_json(finding.model_dump(mode="json")), finding.updated_at, fid),
        )
        conn.commit()
    finally:
        conn.close()
    return finding


def store_ai_assessment(finding_id: str, model: str, review: dict) -> Assessment:
    """Persist a model review as a labeled second opinion (never auto-accept)."""
    claims = [str(c.get("claim", ""))[:300] for c in (review.get("claims_analysis") or [])][:8]
    contradictions = [
        str(c.get("reason", ""))[:300]
        for c in (review.get("claims_analysis") or [])
        if str(c.get("status", "")).lower() == "contradicted"
    ][:8]
    assessment = Assessment(
        id=str(uuid.uuid4())[:8],
        finding_id=finding_id,
        created_by=f"ai:{model}",
        verdict=str(review.get("verdict", "needs_experiments")),
        claims=claims or ["see model review"],
        contradictions=contradictions,
        missing=[str(c)[:300] for c in (review.get("caveats") or [])][:8],
        experiments=[str(e)[:300] for e in (review.get("experiments") or [])][:8],
        compatible_devices=[],
        summary=str(review.get("disclaimer", "Model second opinion; not experimental validation."))[:500],
        created_at=db.now_iso(),
    )
    conn = db.connect()
    try:
        conn.execute(
            "INSERT INTO assessments (id, finding_id, created_by, data_json, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (assessment.id, finding_id, assessment.created_by,
             db.dump_json(assessment.model_dump(mode="json")), assessment.created_at),
        )
        conn.execute(
            "UPDATE research_findings SET status = 'assessed', updated_at = ? WHERE id = ?",
            (db.now_iso(), finding_id),
        )
        conn.commit()
    finally:
        conn.close()
    return assessment


def list_assessments(finding_id: str) -> list[Assessment]:
    conn = db.connect()
    try:
        rows = conn.execute(
            "SELECT data_json FROM assessments WHERE finding_id = ? ORDER BY created_at ASC", (finding_id,)
        ).fetchall()
        return [Assessment.model_validate(db.load_json(r["data_json"])) for r in rows]
    finally:
        conn.close()
    return []
