"""Engineering knowledge base: uploads, chunking, lexical retrieval.

Documents (uploads, fetched references, approved findings) are stored with
their originals under var/uploads/, split into passages, and indexed with
SQLite FTS5. Retrieval is lexical (BM25-ranked) with snippet citations — a
defined upgrade path to vector embeddings exists, but no embedding call is
made until a provider is configured and approved.

Retrieved text is untrusted data: it is cited, never executed as instruction.
"""

import csv
import io
import re
import uuid
from pathlib import Path

from . import database as db

UPLOAD_DIR_NAME = "uploads"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
CHUNK_CHARS = 1200
CHUNK_OVERLAP = 200

TEXT_EXTENSIONS = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".csv": "text/csv",
}
PARSEABLE_EXTENSIONS = {
    **TEXT_EXTENSIONS,
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def upload_dir() -> Path:
    path = db.db_path().parent / UPLOAD_DIR_NAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def _extract_text(filename: str, raw: bytes) -> tuple[str, list[tuple[str, int, str]]]:
    """Return (full_text, [(heading, page, text)] segments) for chunking."""
    suffix = Path(filename).suffix.lower()
    if suffix == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(raw))
        segments = []
        for i, page in enumerate(reader.pages):
            text = (page.extract_text() or "").strip()
            if text:
                segments.append((f"Page {i + 1}", i + 1, text))
        return "\n\n".join(t for _, _, t in segments), segments
    if suffix == ".docx":
        from docx import Document

        doc = Document(io.BytesIO(raw))
        segments = []
        heading = ""
        buf: list[str] = []
        for para in doc.paragraphs:
            text = para.text.strip()
            if not text:
                continue
            if para.style.name.startswith("Heading"):
                if buf:
                    segments.append((heading, 0, "\n".join(buf)))
                    buf = []
                heading = text
            else:
                buf.append(text)
        if buf:
            segments.append((heading, 0, "\n".join(buf)))
        return "\n\n".join(t for _, _, t in segments), segments
    if suffix == ".csv":
        text = raw.decode("utf-8-sig", errors="replace")
        rows = list(csv.reader(io.StringIO(text)))
        lines = [f"Row {i}: {', '.join(cells)}" for i, cells in enumerate(rows) if any(cells)]
        joined = "\n".join(lines)
        return joined, [("CSV rows", 0, joined)]
    # Plain text / markdown: split on markdown headings when present.
    text = raw.decode("utf-8-sig", errors="replace")
    if suffix in (".md", ".markdown"):
        segments = []
        heading = ""
        buf = []
        for line in text.splitlines():
            match = re.match(r"^#{1,3}\s+(.*)", line.strip())
            if match:
                if buf:
                    segments.append((heading, 0, "\n".join(buf).strip()))
                    buf = []
                heading = match.group(1).strip()
            else:
                buf.append(line)
        if buf and "\n".join(buf).strip():
            segments.append((heading, 0, "\n".join(buf).strip()))
        return text, segments or [("", 0, text)]
    return text, [("", 0, text)]


def _chunk_segments(segments: list[tuple[str, int, str]]) -> list[tuple[str, int, str]]:
    chunks: list[tuple[str, int, str]] = []
    for heading, page, text in segments:
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            continue
        start = 0
        while start < len(text):
            end = min(start + CHUNK_CHARS, len(text))
            if end < len(text):
                space = text.rfind(" ", start + CHUNK_CHARS - 200, end)
                if space > start:
                    end = space
            chunks.append((heading, page, text[start:end].strip()))
            if end >= len(text):
                break
            start = max(end - CHUNK_OVERLAP, start + 1)
    return chunks


def store_document(
    title: str,
    filename: str,
    raw: bytes,
    source_type: str = "upload",
    source_ref: str = "",
    mime: str = "",
) -> dict:
    """Validate, store the original, extract, chunk, and FTS-index a document."""
    suffix = Path(filename).suffix.lower()
    if suffix not in PARSEABLE_EXTENSIONS:
        raise ValueError(
            f"Unsupported file type {suffix!r}; "
            f"accepted: {sorted(PARSEABLE_EXTENSIONS)}"
        )
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ValueError(f"File exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit")
    if not raw.strip():
        raise ValueError("File is empty")
    doc_id = _new_id("doc")
    stored = upload_dir() / f"{doc_id}{suffix}"
    stored.write_bytes(raw)
    try:
        full_text, segments = _extract_text(filename, raw)
    except Exception as exc:
        stored.unlink(missing_ok=True)
        raise ValueError(f"Could not parse {suffix} file: {type(exc).__name__}") from exc
    if not full_text.strip():
        stored.unlink(missing_ok=True)
        raise ValueError("No extractable text found in file")
    chunks = _chunk_segments(segments)
    conn = db.connect()
    try:
        ts = db.now_iso()
        conn.execute(
            "INSERT INTO documents (id, title, source_type, source_ref, filename, mime,"
            " status, error, meta_json, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, 'indexed', '', ?, ?)",
            (doc_id, title or filename, source_type, source_ref, filename,
             mime or PARSEABLE_EXTENSIONS[suffix],
             db.dump_json({"chars": len(full_text), "chunks": len(chunks),
                           "stored_as": stored.name}), ts),
        )
        for idx, (heading, page, text) in enumerate(chunks):
            chunk_id = f"{doc_id}-c{idx:04d}"
            conn.execute(
                "INSERT INTO chunks (id, doc_id, idx, heading, page, text)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (chunk_id, doc_id, idx, heading, page, text),
            )
            conn.execute(
                "INSERT INTO chunks_fts (text, heading, doc_id, chunk_id)"
                " VALUES (?, ?, ?, ?)",
                (text, heading, doc_id, chunk_id),
            )
        conn.commit()
    finally:
        conn.close()
    return {"id": doc_id, "title": title or filename, "chunks": len(chunks),
            "chars": len(full_text), "status": "indexed"}


def store_text_document(
    title: str, text: str, source_type: str, source_ref: str = ""
) -> dict:
    """Index already-extracted text (fetched references, approved findings)."""
    if not text.strip():
        raise ValueError("No text to index")
    doc_id = _new_id("doc")
    stored = upload_dir() / f"{doc_id}.txt"
    stored.write_text(text, encoding="utf-8")
    chunks = _chunk_segments([("", 0, text)])
    conn = db.connect()
    try:
        ts = db.now_iso()
        conn.execute(
            "INSERT INTO documents (id, title, source_type, source_ref, filename, mime,"
            " status, error, meta_json, created_at)"
            " VALUES (?, ?, ?, ?, '', 'text/plain', 'indexed', '', ?, ?)",
            (doc_id, title, source_type, source_ref,
             db.dump_json({"chars": len(text), "chunks": len(chunks),
                           "stored_as": stored.name}), ts),
        )
        for idx, (heading, page, chunk_text) in enumerate(chunks):
            chunk_id = f"{doc_id}-c{idx:04d}"
            conn.execute(
                "INSERT INTO chunks (id, doc_id, idx, heading, page, text)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (chunk_id, doc_id, idx, heading, page, chunk_text),
            )
            conn.execute(
                "INSERT INTO chunks_fts (text, heading, doc_id, chunk_id)"
                " VALUES (?, ?, ?, ?)",
                (chunk_text, heading, doc_id, chunk_id),
            )
        conn.commit()
    finally:
        conn.close()
    return {"id": doc_id, "title": title, "chunks": len(chunks),
            "chars": len(text), "status": "indexed"}


def list_documents(source_type: str | None = None) -> list[dict]:
    conn = db.connect()
    try:
        if source_type:
            rows = conn.execute(
                "SELECT * FROM documents WHERE source_type = ? ORDER BY created_at DESC",
                (source_type,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM documents ORDER BY created_at DESC"
            ).fetchall()
        return [db.row_to_dict(r) for r in rows]
    finally:
        conn.close()


def get_document(doc_id: str) -> dict | None:
    conn = db.connect()
    try:
        row = conn.execute(
            "SELECT * FROM documents WHERE id = ?", (doc_id,)
        ).fetchone()
        if row is None:
            return None
        doc = db.row_to_dict(row)
        chunks = conn.execute(
            "SELECT idx, heading, page, substr(text, 1, 400) AS excerpt"
            " FROM chunks WHERE doc_id = ? ORDER BY idx",
            (doc_id,),
        ).fetchall()
        doc["passages"] = [db.row_to_dict(c) for c in chunks]
        return doc
    finally:
        conn.close()


def delete_document(doc_id: str) -> bool:
    conn = db.connect()
    try:
        row = conn.execute(
            "SELECT meta_json FROM documents WHERE id = ?", (doc_id,)
        ).fetchone()
        if row is None:
            return False
        try:
            stored = db.load_json(row["meta_json"]).get("stored_as", "")
            if stored:
                (upload_dir() / stored).unlink(missing_ok=True)
        except Exception:
            pass
        conn.execute("DELETE FROM chunks_fts WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
        conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        conn.commit()
        return True
    finally:
        conn.close()


def _fts_terms(query: str) -> list[str]:
    terms = re.findall(r"[A-Za-z0-9][A-Za-z0-9_.-]*", query.lower())
    return [t for t in terms if len(t) > 1][:10]


def _fts_query(query: str) -> str:
    """Convert free text into a safe FTS5 prefix query (AND of terms)."""
    terms = _fts_terms(query)
    if not terms:
        return ""
    return " AND ".join(f'"{t}"*' for t in terms)


def _fts_query_or(query: str) -> str:
    terms = _fts_terms(query)
    if not terms:
        return ""
    return " OR ".join(f'"{t}"*' for t in terms)


_SEARCH_SQL = (
    "SELECT c.id AS chunk_id, c.doc_id, c.idx, c.heading, c.page,"
    " d.title, d.source_type, d.source_ref,"
    " snippet(chunks_fts, 0, '[', ']', '…', 30) AS snippet,"
    " bm25(chunks_fts) AS rank"
    " FROM chunks_fts"
    " JOIN chunks c ON c.id = chunks_fts.chunk_id"
    " JOIN documents d ON d.id = chunks_fts.doc_id"
    " WHERE chunks_fts MATCH ?"
    " ORDER BY rank LIMIT ?"
)


def search(query: str, limit: int = 6) -> list[dict]:
    """BM25-ranked passage search with titles, headings, and snippets.

    Strict AND first; falls back to OR so multi-word questions still find
    the most relevant passages.
    """
    fts = _fts_query(query)
    if not fts:
        return []
    conn = db.connect()
    try:
        rows = conn.execute(_SEARCH_SQL, (fts, limit)).fetchall()
        if not rows and len(_fts_terms(query)) > 1:
            rows = conn.execute(_SEARCH_SQL, (_fts_query_or(query), limit)).fetchall()
        return [db.row_to_dict(r) for r in rows]
    except Exception:
        return []
    finally:
        conn.close()
