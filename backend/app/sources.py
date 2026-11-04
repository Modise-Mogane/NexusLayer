"""Engineering Knowledge Sources: managed registry + allowlisted ingestion.

The registry seeds 34 authoritative starting points. Ingestion fetches only
registered URLs (plus same-host pages discovered from registry seeds during
an approved sync), and always:

- checks robots.txt and honors Disallow for our user agent,
- blocks private/loopback/link-local targets (DNS-resolved, no TOCTOU bypass
  via redirect: redirects are re-checked),
- caps redirects, size (2 MB), and time (30 s),
- accepts only HTML/PDF/plain-text content,
- stores source URL, retrieval date, and license metadata with each document,
- treats retrieved text as untrusted data (cited, never executed).

Sources whose license forbids copying keep metadata + external link only.
"""

import html as html_lib
import io
import ipaddress
import re
import socket
import urllib.parse
import urllib.request
from html.parser import HTMLParser

from . import database as db
from . import knowledge

USER_AGENT = "NexusLayer-KnowledgeBot/1.0 (+research use; rate-limited)"
FETCH_TIMEOUT_S = 30
MAX_FETCH_BYTES = 2 * 1024 * 1024
MAX_REDIRECTS = 3
SYNC_DELAY_S = 1.0

# (id, name, organization, url, category, data_type, access, license, trust, refresh)
SEED_SOURCES: list[tuple[str, ...]] = [
    ("rfc-editor", "RFC Editor", "IETF Trust", "https://www.rfc-editor.org/",
     "internet_protocols", "standards_library", "public", "rfc_license_mixed",
     "authoritative", "monthly"),
    ("rfc-4271", "RFC 4271 — BGP-4", "IETF", "https://www.rfc-editor.org/rfc/rfc4271.html",
     "internet_protocols", "rfc", "public", "ietf_trust_legal",
     "authoritative", "on_demand"),
    ("rfc-9293", "RFC 9293 — TCP", "IETF", "https://www.rfc-editor.org/rfc/rfc9293.html",
     "internet_protocols", "rfc", "public", "ietf_trust_legal",
     "authoritative", "on_demand"),
    ("rfc-4861", "RFC 4861 — IPv6 Neighbor Discovery", "IETF",
     "https://www.rfc-editor.org/rfc/rfc4861.html",
     "internet_protocols", "rfc", "public", "ietf_trust_legal",
     "authoritative", "on_demand"),
    ("iana-protocols", "IANA Protocol Registries", "IANA", "https://www.iana.org/protocols",
     "internet_protocols", "registry", "public", "public_facts",
     "authoritative", "monthly"),
    ("iana-proto-numbers", "IANA Protocol Numbers", "IANA",
     "https://www.iana.org/assignments/protocol-numbers",
     "internet_protocols", "registry", "public", "public_facts",
     "authoritative", "monthly"),
    ("3gpp-36300", "3GPP TS 36.300 — LTE/E-UTRAN", "3GPP",
     "https://portal.3gpp.org/desktopmodules/Specifications/SpecificationDetails.aspx?specificationId=2430",
     "cellular", "spec_portal", "public_with_terms", "spec_license_check",
     "authoritative", "on_demand"),
    ("3gpp-38300", "3GPP TS 38.300 — 5G NR/NG-RAN", "3GPP",
     "https://portal.3gpp.org/desktopmodules/Specifications/SpecificationDetails.aspx?specificationId=3191",
     "cellular", "spec_portal", "public_with_terms", "spec_license_check",
     "authoritative", "on_demand"),
    ("3gpp-38821", "3GPP TR 38.821 — Non-Terrestrial Networks", "3GPP",
     "https://portal.3gpp.org/desktopmodules/Specifications/SpecificationDetails.aspx?specificationId=3525",
     "cellular", "spec_portal", "public_with_terms", "spec_license_check",
     "authoritative", "on_demand"),
    ("etsi-catalogue", "ETSI Standards Catalogue", "ETSI", "https://www.etsi.org/standards/",
     "cellular", "standards_library", "public", "spec_license_check",
     "authoritative", "monthly"),
    ("ieee-802-3", "IEEE 802.3 Ethernet Working Group", "IEEE",
     "https://ieee802.org/3/",
     "wireless_optical", "standards_portal", "public", "spec_license_check",
     "authoritative", "monthly"),
    ("ieee-802-11", "IEEE 802.11 Wireless LAN Working Group", "IEEE",
     "https://www.ieee802.org/11/",
     "wireless_optical", "standards_portal", "public", "spec_license_check",
     "authoritative", "monthly"),
    ("srsran-docs", "srsRAN Documentation", "SRS", "https://docs.srsran.com/projects/project/en/latest/",
     "cellular", "implementation_docs", "public", "open_source_docs",
     "reference", "monthly"),
    ("itu-p525", "ITU-R P.525 Free-space attenuation", "ITU",
     "https://www.itu.int/rec/R-REC-P.525/en",
     "rf_propagation", "recommendation_page", "public_with_terms", "itu_terms_check",
     "authoritative", "on_demand"),
    ("itu-p618", "ITU-R P.618 Earth-space propagation", "ITU",
     "https://www.itu.int/rec/R-REC-P.618/en",
     "rf_propagation", "recommendation_page", "public_with_terms", "itu_terms_check",
     "authoritative", "on_demand"),
    ("itu-p676", "ITU-R P.676 Atmospheric gas attenuation", "ITU",
     "https://www.itu.int/rec/R-REC-P.676",
     "rf_propagation", "recommendation_page", "public_with_terms", "itu_terms_check",
     "authoritative", "on_demand"),
    ("itu-p452", "ITU-R P.452 Terrestrial interference", "ITU",
     "https://www.itu.int/rec/r-rec-p.452",
     "rf_propagation", "recommendation_page", "public_with_terms", "itu_terms_check",
     "authoritative", "on_demand"),
    ("itu-p837", "ITU-R P.837 Precipitation characteristics", "ITU",
     "https://www.itu.int/rec/R-REC-P.837",
     "rf_propagation", "recommendation_page", "public_with_terms", "itu_terms_check",
     "authoritative", "on_demand"),
    ("itu-rr", "ITU Radio Regulations", "ITU", "https://www.itu.int/pub/R-REG-RR/en",
     "rf_propagation", "regulation_portal", "public_with_terms", "itu_terms_check",
     "authoritative", "monthly"),
    ("nasa-scan", "NASA Space Communications and Navigation", "NASA",
     "https://www.nasa.gov/glenn/glenn-expertise-space-exploration/scan/",
     "satellite", "agency_docs", "public", "us_public_domain",
     "authoritative", "monthly"),
    ("celestrak-elements", "CelesTrak Orbital Element Data", "CelesTrak",
     "https://celestrak.org/norad/elements/index.php?FORMAT=json",
     "satellite", "dataset", "public", "redistribution_terms_check",
     "reference", "weekly"),
    ("celestrak-formats", "CelesTrak GP Data Formats", "CelesTrak",
     "https://celestrak.org/NORAD/documentation/gp-data-formats.php",
     "satellite", "format_docs", "public", "reference_fair_use",
     "reference", "on_demand"),
    ("ns3-docs", "ns-3 Documentation", "ns-3 Consortium", "https://www.nsnam.org/documentation/",
     "simulation", "simulator_docs", "public", "open_source_docs",
     "reference", "monthly"),
    ("ripe-atlas-api", "RIPE Atlas API Manual", "RIPE NCC",
     "https://beta-ui.atlas.ripe.net/docs/apis/rest-api-manual/introduction",
     "measurement", "api_docs", "public", "open_docs",
     "reference", "monthly"),
    ("caida-topology", "CAIDA Internet Topology Data Kit", "CAIDA",
     "https://www.caida.org/catalog/datasets/internet-topology-data-kit/",
     "measurement", "dataset_catalog", "public_with_terms", "data_use_agreement",
     "reference", "monthly"),
    ("mlab-data", "Measurement Lab Datasets", "M-Lab", "https://www.measurementlab.net/data/",
     "measurement", "dataset_catalog", "public", "open_data",
     "reference", "monthly"),
    ("cloudflare-radar", "Cloudflare Radar Outage Center", "Cloudflare",
     "https://radar.cloudflare.com/outage-center",
     "measurement", "status_dashboard", "public", "tos_check",
     "reference", "weekly"),
    ("itu-stats", "ITU Global Connectivity Statistics", "ITU",
     "https://www.itu.int/en/ITU-D/Statistics/pages/stat/default.aspx",
     "coverage", "statistics_portal", "public_with_terms", "itu_terms_check",
     "authoritative", "quarterly"),
    ("gsma-coverage", "GSMA Network Coverage Maps", "GSMA",
     "https://www.gsma.com/coverage/?lang=en",
     "coverage", "coverage_maps", "public", "tos_check",
     "reference", "quarterly"),
    ("fcc-broadband-map", "FCC National Broadband Map Help", "FCC",
     "https://help.bdc.fcc.gov/hc/en-us/articles/10467446103579-How-to-Use-the-FCC-s-National-Broadband-Map",
     "coverage", "map_docs", "public", "us_public_domain",
     "authoritative", "quarterly"),
    ("worldbank-internet", "World Bank Internet Usage Data", "World Bank",
     "https://data.worldbank.org/indicator/IT.NET.USER.ZS",
     "coverage", "statistics_portal", "public", "cc-by-4.0",
     "authoritative", "quarterly"),
    ("osm-copyright", "OpenStreetMap Copyright and License", "OSMF",
     "https://www.openstreetmap.org/copyright",
     "coverage", "license_page", "public", "odbl",
     "authoritative", "on_demand"),
    ("openinframap", "Open Infrastructure Map", "OpenInfraMap",
     "https://openinframap.org/about",
     "coverage", "project_docs", "public", "open_data_mixed",
     "reference", "quarterly"),
    ("opencellid", "OpenCellID Coverage Docs", "Unwired Labs",
     "https://docs.opencellid.org/docs/getting-started/coverage",
     "coverage", "project_docs", "public", "cc-by-sa_mixed",
     "reference", "quarterly"),
]


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag in ("script", "style", "nav", "footer", "noscript"):
            self._skip += 1
        elif tag in ("p", "br", "li", "h1", "h2", "h3", "h4", "tr", "div", "section"):
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "nav", "footer", "noscript"):
            self._skip = max(0, self._skip - 1)
        elif tag in ("p", "li", "h1", "h2", "h3", "h4", "tr", "div", "section"):
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip == 0:
            self.parts.append(data)

    def text(self) -> str:
        raw = html_lib.unescape("".join(self.parts))
        raw = re.sub(r"[ \t]+", " ", raw)
        raw = re.sub(r"\n\s*\n+", "\n\n", raw)
        return raw.strip()


def html_to_text(html: str) -> str:
    parser = _TextExtractor()
    parser.feed(html[:500_000])
    return parser.text()


def _is_public_url(url: str) -> tuple[bool, str]:
    """Allow only http(s) URLs resolving exclusively to public IPs."""
    try:
        parsed = urllib.parse.urlparse(url)
    except ValueError as exc:
        return False, f"bad_url: {exc}"
    if parsed.scheme not in ("http", "https"):
        return False, f"blocked_scheme: {parsed.scheme}"
    if not parsed.hostname:
        return False, "no_hostname"
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
    except socket.gaierror:
        return False, "dns_failed"
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            return False, "bad_resolved_ip"
        if not ip.is_global:
            return False, f"blocked_non_public_ip: {ip}"
    return True, ""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _robots_allowed(url: str, timeout: int = 15) -> tuple[bool, str]:
    parsed = urllib.parse.urlparse(url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    ok, reason = _is_public_url(robots_url)
    if not ok:
        return False, reason
    try:
        req = urllib.request.Request(robots_url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status != 200:
                return True, "no_robots"
            body = resp.read(256 * 1024).decode("utf-8", errors="replace")
    except Exception:
        return True, "robots_unreachable_assume_allowed"
    path = parsed.path or "/"
    group_relevant = False
    disallows: list[str] = []
    for line in body.splitlines():
        line = line.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        field, _, value = line.partition(":")
        field, value = field.strip().lower(), value.strip()
        if field == "user-agent":
            group_relevant = value in ("*", "nexuslayer-knowledgebot")
        elif field == "disallow" and group_relevant and value:
            disallows.append(value)
    for rule in disallows:
        if path.startswith(rule):
            return False, f"robots_disallow: {rule}"
    return True, ""


def fetch_url(url: str) -> dict:
    """Fetch one URL with redirect/size/type guards. Returns {ok, ...}."""
    ok, reason = _is_public_url(url)
    if not ok:
        return {"ok": False, "error": reason}
    allowed, reason = _robots_allowed(url)
    if not allowed:
        return {"ok": False, "error": reason}
    opener = urllib.request.build_opener(_NoRedirect)
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        ok, reason = _is_public_url(current)
        if not ok:
            return {"ok": False, "error": reason}
        req = urllib.request.Request(current, headers={"User-Agent": USER_AGENT})
        try:
            resp = opener.open(req, timeout=FETCH_TIMEOUT_S)
        except urllib.error.HTTPError as exc:
            if exc.code in (301, 302, 303, 307, 308):
                location = exc.headers.get("Location", "")
                if not location:
                    return {"ok": False, "error": "redirect_without_location"}
                current = urllib.parse.urljoin(current, location)
                continue
            return {"ok": False, "error": f"http_{exc.code}"}
        except Exception as exc:
            return {"ok": False, "error": f"{type(exc).__name__}"}
        with resp:
            if resp.status in (301, 302, 303, 307, 308):
                location = resp.headers.get("Location", "")
                if not location:
                    return {"ok": False, "error": "redirect_without_location"}
                current = urllib.parse.urljoin(current, location)
                continue
            if resp.status != 200:
                return {"ok": False, "error": f"http_{resp.status}"}
            content_type = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if content_type not in (
                "text/html", "text/plain", "application/pdf",
                "application/json", "text/markdown", "text/csv",
            ):
                return {"ok": False, "error": f"unsupported_content_type: {content_type}"}
            raw = resp.read(MAX_FETCH_BYTES + 1)
            if len(raw) > MAX_FETCH_BYTES:
                return {"ok": False, "error": "too_large"}
            return {"ok": True, "url": current, "content_type": content_type, "raw": raw}
    return {"ok": False, "error": "too_many_redirects"}


def _registered_hosts() -> set[str]:
    return {urllib.parse.urlparse(s[3]).hostname or "" for s in SEED_SOURCES}


def ensure_registry() -> int:
    """Insert missing seed sources; returns total registry size."""
    conn = db.connect()
    try:
        for sid, name, org, url, cat, dtype, access, lic, trust, refresh in SEED_SOURCES:
            conn.execute(
                "INSERT OR IGNORE INTO sources"
                " (id, name, organization, url, category, data_type, access, license,"
                " trust, refresh_policy, status, enabled)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1)",
                (sid, name, org, url, cat, dtype, access, lic, trust, refresh),
            )
        conn.commit()
        count = conn.execute("SELECT COUNT(*) AS n FROM sources").fetchone()["n"]
        return count
    finally:
        conn.close()


def list_sources() -> list[dict]:
    ensure_registry()
    conn = db.connect()
    try:
        rows = conn.execute("SELECT * FROM sources ORDER BY category, name").fetchall()
        return [db.row_to_dict(r) for r in rows]
    finally:
        conn.close()


def get_source(sid: str) -> dict | None:
    conn = db.connect()
    try:
        row = conn.execute("SELECT * FROM sources WHERE id = ?", (sid,)).fetchone()
        return db.row_to_dict(row) if row else None
    finally:
        conn.close()


def set_source_enabled(sid: str, enabled: bool) -> bool:
    conn = db.connect()
    try:
        cur = conn.execute(
            "UPDATE sources SET enabled = ? WHERE id = ?", (1 if enabled else 0, sid)
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def _mark_source(sid: str, status: str, error: str = "", doc_delta: int = 0) -> None:
    conn = db.connect()
    try:
        conn.execute(
            "UPDATE sources SET status = ?, last_error = ?, last_checked = ?,"
            " doc_count = doc_count + ? WHERE id = ?",
            (status, error[:500], db.now_iso(), doc_delta, sid),
        )
        conn.commit()
    finally:
        conn.close()


def ingest_source(sid: str) -> dict:
    """Fetch + index one registered source. Honors enabled flag and licenses."""
    src = get_source(sid)
    if src is None:
        raise KeyError(f"Unknown source {sid!r}")
    if not src["enabled"]:
        return {"id": sid, "status": "skipped", "reason": "disabled"}
    host = urllib.parse.urlparse(src["url"]).hostname or ""
    if host not in _registered_hosts():
        _mark_source(sid, "failed", "host_not_allowlisted")
        return {"id": sid, "status": "failed", "reason": "host_not_allowlisted"}
    fetched = fetch_url(src["url"])
    if not fetched.get("ok"):
        _mark_source(sid, "failed", str(fetched.get("error", "")))
        return {"id": sid, "status": "failed", "reason": fetched.get("error")}
    raw: bytes = fetched["raw"]
    content_type: str = fetched["content_type"]
    try:
        if content_type == "text/html":
            text = html_to_text(raw.decode("utf-8", errors="replace"))
        elif content_type == "application/pdf":
            text, _ = knowledge._extract_text("source.pdf", raw)
        else:
            text = raw.decode("utf-8", errors="replace")
    except Exception as exc:
        _mark_source(sid, "failed", f"parse_error: {type(exc).__name__}")
        return {"id": sid, "status": "failed", "reason": "parse_error"}
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) < 200:
        _mark_source(sid, "failed", "too_little_text")
        return {"id": sid, "status": "failed", "reason": "too_little_text"}
    doc = knowledge.store_text_document(
        title=src["name"], text=text[:200_000],
        source_type="source", source_ref=f"{sid} :: {fetched['url']}",
    )
    _mark_source(sid, "ok", "", doc_delta=1)
    return {"id": sid, "status": "ok", "doc_id": doc["id"], "chunks": doc["chunks"]}
