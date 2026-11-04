"""SQLite persistence with stdlib sqlite3 (upgrade path: PostgreSQL).

Tables: scenarios, devices, research_findings, assessments, simulation_runs,
conversations, chat_messages, documents, chunks (+ FTS5 index), sources.
Schema version is tracked in a meta table; init_db() applies migrations.
"""

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 2


def db_path() -> Path:
    override = os.getenv("NEXUS_DB_PATH")
    if override:
        return Path(override)
    # Runtime state lives in var/ (a Docker volume); seed data stays in data/.
    return Path(__file__).resolve().parent.parent / "var" / "nexuslayer.db"


def connect() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    init_db(conn)
    return conn


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db(conn: sqlite3.Connection | None = None) -> None:
    own = conn is None
    conn = conn or connect()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY, value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS scenarios (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                environment TEXT NOT NULL DEFAULT 'generic',
                version INTEGER NOT NULL DEFAULT 1,
                data_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS devices (
                id TEXT PRIMARY KEY,
                device_id TEXT UNIQUE NOT NULL,
                origin TEXT NOT NULL DEFAULT 'library',
                data_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS research_findings (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'submitted',
                data_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS assessments (
                id TEXT PRIMARY KEY,
                finding_id TEXT NOT NULL,
                created_by TEXT NOT NULL DEFAULT 'local_deterministic',
                data_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS simulation_runs (
                id TEXT PRIMARY KEY,
                scenario_id TEXT NOT NULL,
                policy TEXT NOT NULL,
                result_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                scenario_id TEXT NOT NULL DEFAULT '',
                capability TEXT NOT NULL DEFAULT 'simulation',
                provider TEXT NOT NULL DEFAULT '',
                model TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                tool_calls_json TEXT NOT NULL DEFAULT '[]',
                citations_json TEXT NOT NULL DEFAULT '[]',
                proposal_json TEXT NOT NULL DEFAULT '',
                provenance TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                source_type TEXT NOT NULL DEFAULT 'upload',
                source_ref TEXT NOT NULL DEFAULT '',
                filename TEXT NOT NULL DEFAULT '',
                mime TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'stored',
                error TEXT NOT NULL DEFAULT '',
                meta_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS chunks (
                id TEXT PRIMARY KEY,
                doc_id TEXT NOT NULL,
                idx INTEGER NOT NULL,
                heading TEXT NOT NULL DEFAULT '',
                page INTEGER NOT NULL DEFAULT 0,
                text TEXT NOT NULL
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
                text, heading, doc_id UNINDEXED, chunk_id UNINDEXED
            );
            CREATE TABLE IF NOT EXISTS sources (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                organization TEXT NOT NULL DEFAULT '',
                url TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT '',
                data_type TEXT NOT NULL DEFAULT '',
                access TEXT NOT NULL DEFAULT '',
                license TEXT NOT NULL DEFAULT '',
                trust TEXT NOT NULL DEFAULT '',
                refresh_policy TEXT NOT NULL DEFAULT '',
                last_checked TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                last_error TEXT NOT NULL DEFAULT '',
                doc_count INTEGER NOT NULL DEFAULT 0,
                enabled INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS regions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                data_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS coverage_reports (
                id TEXT PRIMARY KEY,
                region_id TEXT NOT NULL,
                created_by TEXT NOT NULL DEFAULT 'deterministic',
                data_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                name TEXT NOT NULL,
                config_json TEXT NOT NULL DEFAULT '{}',
                interval_seconds INTEGER NOT NULL DEFAULT 86400,
                enabled INTEGER NOT NULL DEFAULT 0,
                last_run TEXT NOT NULL DEFAULT '',
                next_run TEXT NOT NULL DEFAULT '',
                last_status TEXT NOT NULL DEFAULT 'never_run',
                last_result_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS job_runs (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                started_at TEXT NOT NULL,
                finished_at TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'running',
                log TEXT NOT NULL DEFAULT ''
            );
            """
        )
        conn.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)",
            (str(SCHEMA_VERSION),),
        )
        conn.commit()
    finally:
        if own:
            conn.close()


def row_to_dict(row: sqlite3.Row) -> dict:
    return {key: row[key] for key in row.keys()}


def dump_json(data: dict) -> str:
    return json.dumps(data, sort_keys=True)


def load_json(text: str) -> dict:
    return json.loads(text)
