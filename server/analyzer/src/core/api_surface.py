"""
Static extraction of HTTP API surface (Version A): routes, webhooks, WebSockets.
Outputs api_surface.json + API_SURFACE.md. Epistemic labels align with dossier claims.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

SCAN_EXTENSIONS = {
    ".py", ".pyi", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".rb",
}
MAX_FILE_BYTES = 1_500_000


@dataclass
class Endpoint:
    method: str
    path: str
    auth: str  # AUTHENTICATED | OPEN | UNKNOWN
    confidence: str  # VERIFIED | INFERRED | UNKNOWN
    file: str
    line: int
    framework: str = ""
    request_shape: str = ""
    response_shape: str = ""

    def display(self) -> str:
        return f"{self.file}:{self.line}"

    def to_json(self) -> Dict[str, Any]:
        d = asdict(self)
        d["citation"] = self.display()
        return d


@dataclass
class Webhook:
    kind: str  # inbound | outbound
    name: str
    path_or_url: str
    auth: str
    confidence: str
    file: str
    line: int

    def to_json(self) -> Dict[str, Any]:
        d = asdict(self)
        d["citation"] = f"{self.file}:{self.line}"
        return d


@dataclass
class WsEntry:
    kind: str
    detail: str
    file: str
    line: int
    confidence: str

    def to_json(self) -> Dict[str, Any]:
        return {**asdict(self), "citation": f"{self.file}:{self.line}"}


@dataclass
class UnknownPartial:
    note: str
    file: str
    line: int

    def to_json(self) -> Dict[str, Any]:
        return {**asdict(self), "citation": f"{self.file}:{self.line}"}


def _read_text_safe(repo: Path, rel: str) -> Optional[str]:
    p = repo / rel
    try:
        if not p.is_file():
            return None
        if p.stat().st_size > MAX_FILE_BYTES:
            return None
        raw = p.read_bytes()
        if b"\x00" in raw[:4096]:
            return None
        return raw.decode("utf-8", errors="replace")
    except OSError:
        return None


def _window_text(lines: List[str], start_idx: int, n: int = 35) -> str:
    return "\n".join(lines[start_idx : start_idx + n])


def _fastapi_auth(lines: List[str], line_idx: int) -> str:
    w = _window_text(lines, line_idx, 40)
    if re.search(
        r"Depends\s*\([^)]*(HTTPBearer|OAuth2PasswordBearer|OAuth2|APIKey|Security\(|"
        r"get_current_user|get_current_active_user|require_|authenticate)",
        w,
        re.I,
    ):
        return "AUTHENTICATED"
    if "Depends(" in w:
        return "UNKNOWN"
    return "OPEN"


def _express_auth(lines: List[str], line_idx: int) -> str:
    w = _window_text(lines, max(0, line_idx - 5), 15)
    if re.search(
        r"(authenticate|authMiddleware|requireAuth|isAuthenticated|ensureAuth|verifyToken|passport\.authenticate)",
        w,
        re.I,
    ):
        return "AUTHENTICATED"
    return "UNKNOWN"


def _flask_auth(lines: List[str], line_idx: int) -> str:
    w = _window_text(lines, max(0, line_idx - 3), 25)
    if re.search(r"@login_required|@requires_auth|before_request.*session", w, re.I):
        return "AUTHENTICATED"
    return "UNKNOWN"


def scan_python_routes(
    content: str,
    rel: str,
    endpoints: List[Endpoint],
    unknowns: List[UnknownPartial],
    *,
    allow_django_urlpatterns: bool = False,
) -> None:
    lines = content.splitlines()
    # FastAPI / Starlette style: @router.get("/path") or @app.post('/path')
    rx_route = re.compile(
        r"^(\s*)@(\w+)\.(get|post|put|delete|patch|head|options)\(\s*"
        r'(?:"([^"]*)"|\'([^\']*)\')',
        re.I,
    )
    rx_api_route = re.compile(
        r"^(\s*)@(\w+)\.api_route\s*\(\s*"
        r'(?:"([^"]*)"|\'([^\']*)\')',
        re.I,
    )
    rx_ws = re.compile(
        r"^(\s*)@(\w+)\.(websocket)\(\s*"
        r'(?:"([^"]*)"|\'([^\']*)\')',
        re.I,
    )
    # Flask @app.route('/x', methods=['POST'])
    rx_flask = re.compile(
        r"^(\s*)@(\w+)\.(route)\(\s*"
        r'(?:"([^"]*)"|\'([^\']*)\')'
        r"(.*?)\)\s*$",
        re.I,
    )

    for i, line in enumerate(lines):
        m = rx_ws.match(line.strip() if line else "")
        if m:
            path = (m.group(4) or m.group(5) or "").strip() or "/"
            endpoints.append(
                Endpoint(
                    method="WEBSOCKET",
                    path=path,
                    auth=_fastapi_auth(lines, i),
                    confidence="VERIFIED",
                    file=rel,
                    line=i + 1,
                    framework="fastapi",
                    request_shape="WebSocket messages",
                    response_shape="WebSocket messages",
                )
            )
            continue

        m = rx_route.match(line.strip() if line else "")
        if m:
            path = (m.group(4) or m.group(5) or "").strip() or "/"
            method = (m.group(3) or "GET").upper()
            endpoints.append(
                Endpoint(
                    method=method,
                    path=path,
                    auth=_fastapi_auth(lines, i),
                    confidence="VERIFIED",
                    file=rel,
                    line=i + 1,
                    framework="fastapi",
                    request_shape="(see handler)",
                    response_shape="(see handler)",
                )
            )
            continue

        m = rx_api_route.match(line.strip() if line else "")
        if m:
            path = (m.group(3) or m.group(4) or "").strip() or "/"
            meth_block = line
            methods = ["GET"]
            if "methods=" in meth_block:
                mm = re.findall(r"['\"](GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)['\"]", meth_block, re.I)
                if mm:
                    methods = [x.upper() for x in mm]
            for meth in methods:
                endpoints.append(
                    Endpoint(
                        method=meth,
                        path=path,
                        auth=_fastapi_auth(lines, i),
                        confidence="VERIFIED",
                        file=rel,
                        line=i + 1,
                        framework="fastapi",
                        request_shape="(api_route)",
                        response_shape="(api_route)",
                    )
                )
            continue

        m = rx_flask.match(line.strip() if line else "")
        if m:
            path = (m.group(4) or m.group(5) or "").strip() or "/"
            rest = m.group(6) or ""
            methods = ["GET"]
            if "methods=" in rest:
                mm = re.findall(r"['\"](GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)['\"]", rest, re.I)
                if mm:
                    methods = [x.upper() for x in mm]
            for meth in methods:
                endpoints.append(
                    Endpoint(
                        method=meth,
                        path=path,
                        auth=_flask_auth(lines, i),
                        confidence="VERIFIED",
                        file=rel,
                        line=i + 1,
                        framework="flask",
                        request_shape="(request body / query)",
                        response_shape="(response)",
                    )
                )
            continue

        # Django urlpatterns — only in urls.py to avoid false positives (e.g. path= in tests)
        if allow_django_urlpatterns and re.match(r"^\s*(re_)?path\s*\(", line):
            pm = re.search(r'["\']([^"\']+)["\']', line)
            if pm:
                pth = pm.group(1)
                endpoints.append(
                    Endpoint(
                        method="HTTP",
                        path=pth,
                        auth="UNKNOWN",
                        confidence="INFERRED",
                        file=rel,
                        line=i + 1,
                        framework="django",
                        request_shape="(urlconf)",
                        response_shape="(view)",
                    )
                )


def scan_js_routes(content: str, rel: str, endpoints: List[Endpoint], unknowns: List[UnknownPartial]) -> None:
    lines = content.splitlines()
    rx_express = re.compile(
        r"(?:^|\b)(app|router)\.(get|post|put|delete|patch|all|use)\(\s*"
        r'(?:`([^`]+)`|["\']([^"\']+)["\'])',
        re.I,
    )
    for i, line in enumerate(lines):
        for m in rx_express.finditer(line):
            method = (m.group(2) or "get").upper()
            path = (m.group(3) or m.group(4) or "").strip()
            if not path or path == "*" or path == "/":
                if method == "USE":
                    continue
            if len(path) > 200:
                continue
            if method == "USE" and "(" in path:
                continue
            auth = _express_auth(lines, i)
            endpoints.append(
                Endpoint(
                    method=method if method != "ALL" else "ALL",
                    path=path or "/",
                    auth=auth,
                    confidence="VERIFIED",
                    file=rel,
                    line=i + 1,
                    framework="express",
                    request_shape="(req)",
                    response_shape="(res)",
                )
            )


def scan_ruby_routes(content: str, rel: str, endpoints: List[Endpoint]) -> None:
    lines = content.splitlines()
    rx = re.compile(r"^\s*(get|post|put|delete|patch|match|root)\s+['\"]([^'\"]+)['\"]", re.I)
    for i, line in enumerate(lines):
        m = rx.match(line)
        if m:
            method = m.group(1).upper()
            if method == "MATCH":
                method = "HTTP"
            if method == "ROOT":
                method = "GET"
                path = "/"
            else:
                path = m.group(2)
            endpoints.append(
                Endpoint(
                    method=method,
                    path=path,
                    auth="UNKNOWN",
                    confidence="INFERRED",
                    file=rel,
                    line=i + 1,
                    framework="rails",
                    request_shape="(rails)",
                    response_shape="(rails)",
                )
            )


def nextjs_api_from_path(rel: str) -> Optional[str]:
    norm = rel.replace("\\", "/")
    if "/app/api/" in norm or norm.startswith("app/api/"):
        base = norm.split("/app/api/", 1)[-1] if "/app/api/" in norm else norm[len("app/api/") :]
        if "/" in base:
            segs = base.split("/")
            if segs[-1] in ("route.ts", "route.js", "route.jsx", "route.tsx"):
                segs = segs[:-1]
                return "/api/" + "/".join(segs).rstrip("/") or "/api"
    if "/pages/api/" in norm or norm.startswith("pages/api/"):
        stem = norm.rsplit(".", 1)[0]
        sub = stem.split("/pages/api/", 1)[-1] if "/pages/api/" in stem else stem[len("pages/api/") :]
        return "/api/" + sub.replace("index", "").strip("/") or "/api"
    return None


def scan_next_route_handlers(content: str, rel: str, path: str, endpoints: List[Endpoint]) -> None:
    lines = content.splitlines()
    for meth in ("GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"):
        for i, line in enumerate(lines):
            if re.search(rf"export\s+(async\s+)?function\s+{meth}\b", line, re.I):
                endpoints.append(
                    Endpoint(
                        method=meth,
                        path=path,
                        auth="UNKNOWN",
                        confidence="VERIFIED",
                        file=rel,
                        line=i + 1,
                        framework="nextjs",
                        request_shape="(Request)",
                        response_shape="(Response)",
                    )
                )


def scan_webhooks_and_ws(
    content: str,
    rel: str,
    outbound: List[Webhook],
    inbound: List[Webhook],
    ws_entries: List[WsEntry],
) -> None:
    lines = content.splitlines()
    for i, line in enumerate(lines):
        if ("http://" in line or "https://" in line) and re.search(
            r"\b(fetch|axios|requests\.(get|post|put|patch|delete)|urllib)\b", line, re.I
        ):
            for url in re.findall(r"https?://[^\s\"')>]+", line):
                if "127.0.0.1" in url or "localhost" in url:
                    continue
                outbound.append(
                    Webhook(
                        kind="outbound",
                        name="http_call",
                        path_or_url=url[:240],
                        auth="UNKNOWN",
                        confidence="INFERRED",
                        file=rel,
                        line=i + 1,
                    )
                )
        if re.search(r"/webhook|webhooks/", line, re.I) and re.search(r"(post|POST|\.post\()", line):
            pm = re.search(r'["\'](/[^"\']*webhook[^"\']*)["\']', line, re.I)
            path = pm.group(1) if pm else "(webhook path in handler)"
            inbound.append(
                Webhook(
                    kind="inbound",
                    name="webhook_handler",
                    path_or_url=path,
                    auth="UNKNOWN",
                    confidence="INFERRED",
                    file=rel,
                    line=i + 1,
                )
            )
        if (
            re.search(r"\bsocket\.io\b", line, re.I)
            or re.search(r"\bnew\s+WebSocket\s*\(", line)
            or re.search(r'["\']wss?://', line)
            or "@websocket" in line
        ):
            ws_entries.append(
                WsEntry(
                    kind="websocket",
                    detail=line.strip()[:200],
                    file=rel,
                    line=i + 1,
                    confidence="INFERRED",
                )
            )


def extract_api_surface(repo_dir: Path, file_index: List[str]) -> Dict[str, Any]:
    repo = repo_dir.resolve()
    endpoints: List[Endpoint] = []
    outbound: List[Webhook] = []
    inbound: List[Webhook] = []
    ws_entries: List[WsEntry] = []
    unknowns: List[UnknownPartial] = []

    for rel in sorted(set(file_index)):
        low = rel.lower()
        ext = Path(rel).suffix.lower()
        if ext not in SCAN_EXTENSIONS and ext != "":
            if "routes.rb" not in low and "urls.py" not in low:
                if "/api/" not in low.replace("\\", "/"):
                    continue
        text = _read_text_safe(repo, rel)
        if text is None:
            continue
        if "routes.rb" in low:
            scan_ruby_routes(text, rel, endpoints)
        if ext in (".py", ".pyi"):
            scan_python_routes(
                text,
                rel,
                endpoints,
                unknowns,
                allow_django_urlpatterns=Path(rel).name == "urls.py" or rel.endswith("/urls.py"),
            )
        if ext in (".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"):
            scan_js_routes(text, rel, endpoints, unknowns)
            np = nextjs_api_from_path(rel)
            if np:
                scan_next_route_handlers(text, rel, np, endpoints)
        scan_webhooks_and_ws(text, rel, outbound, inbound, ws_entries)

    # Dedupe endpoints (method+path+file+line)
    seen: set = set()
    deduped: List[Endpoint] = []
    for e in endpoints:
        k = (e.method, e.path, e.file, e.line)
        if k in seen:
            continue
        seen.add(k)
        deduped.append(e)

    auth_counts: Dict[str, int] = {"AUTHENTICATED": 0, "OPEN": 0, "UNKNOWN": 0}
    for e in deduped:
        k = e.auth if e.auth in auth_counts else "UNKNOWN"
        auth_counts[k] = auth_counts.get(k, 0) + 1

    seen_w: set = set()
    w_out: List[Webhook] = []
    for w in outbound:
        k = (w.path_or_url, w.file, w.line)
        if k in seen_w:
            continue
        seen_w.add(k)
        w_out.append(w)
    outbound = w_out[:200]

    return {
        "schema_version": "1.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "endpoint_count": len(deduped),
            "authenticated": auth_counts["AUTHENTICATED"],
            "open": auth_counts["OPEN"],
            "unknown_auth": auth_counts["UNKNOWN"],
            "webhooks_outbound": len(outbound),
            "webhooks_inbound": len(inbound),
            "websocket_signals": len(ws_entries),
        },
        "endpoints": [e.to_json() for e in sorted(deduped, key=lambda x: (x.file, x.line))],
        "webhooks_outbound": [w.to_json() for w in outbound[:200]],
        "webhooks_inbound": [w.to_json() for w in inbound[:200]],
        "websocket": [w.to_json() for w in ws_entries[:100]],
        "unknown_or_partial": [u.to_json() for u in unknowns[:100]],
    }


def render_api_surface_md(data: Dict[str, Any]) -> str:
    s = data.get("summary") or {}
    n = s.get("endpoint_count", 0)
    xa, yo, zu = s.get("authenticated", 0), s.get("open", 0), s.get("unknown_auth", 0)
    lines = [
        "## API Surface",
        "",
        f"### Endpoints ({n} total — {xa} authenticated, {yo} open, {zu} unknown auth)",
        "",
        "| Method | Path | Auth | File | Confidence |",
        "|--------|------|------|------|------------|",
    ]
    ep_list = data.get("endpoints") or []
    md_cap = 300
    for e in ep_list[:md_cap]:
        path = str(e.get("path", "")).replace("|", "\\|")
        lines.append(
            f"| {e.get('method','')} | `{path}` | {e.get('auth','')} | `{e.get('citation','')}` | {e.get('confidence','')} |"
        )
    if n == 0:
        lines.append("| — | — | — | — | — |")
    elif len(ep_list) > md_cap:
        lines.append(f"| … | _{len(ep_list) - md_cap} more rows in `api_surface.json`_ | | | |")
    lines.extend(
        [
            "",
            "### Webhooks",
            "",
            "**Outbound** (events this system fires to external URLs)",
        ]
    )
    wo = data.get("webhooks_outbound") or []
    if not wo:
        lines.append("- _(none detected)_")
    else:
        for w in wo[:50]:
            lines.append(f"- {w.get('name','')} → `{w.get('path_or_url','')}` — `{w.get('citation','')}`")
    lines.extend(["", "**Inbound** (external systems can POST to these)"])
    wi = data.get("webhooks_inbound") or []
    if not wi:
        lines.append("- _(none detected)_")
    else:
        for w in wi[:50]:
            lines.append(
                f"- `{w.get('path_or_url','')}` — `{w.get('citation','')}` — {w.get('auth','UNKNOWN')}"
            )
    lines.extend(["", "### WebSocket / Realtime"])
    wss = data.get("websocket") or []
    if not wss:
        lines.append("- None detected")
    else:
        for w in wss[:40]:
            lines.append(f"- `{w.get('citation','')}` — {w.get('detail','')[:120]}")
    lines.extend(["", "### Unknown / Uninspected"])
    up = data.get("unknown_or_partial") or []
    if not up:
        lines.append("- _(none)_")
    else:
        for u in up:
            lines.append(f"- {u.get('note','')} — `{u.get('citation','')}`")
    lines.append("")
    return "\n".join(lines)


def format_api_surface_for_dossier_prompt(data: Dict[str, Any]) -> str:
    """Compact JSON-like summary for LLM context (not written to disk as sole source)."""
    slim = {
        "summary": data.get("summary"),
        "endpoints": [
            {k: e.get(k) for k in ("method", "path", "auth", "confidence", "citation", "framework")}
            for e in (data.get("endpoints") or [])[:120]
        ],
        "open_endpoints": [
            e for e in (data.get("endpoints") or []) if e.get("auth") == "OPEN"
        ][:40],
        "webhooks_outbound": (data.get("webhooks_outbound") or [])[:25],
        "webhooks_inbound": (data.get("webhooks_inbound") or [])[:25],
        "websocket": (data.get("websocket") or [])[:20],
    }
    return json.dumps(slim, indent=2, default=str)


def append_open_endpoint_security_section(data: Dict[str, Any]) -> str:
    """Deterministic markdown blurb for --no-llm dossier security posture."""
    opens = [e for e in (data.get("endpoints") or []) if e.get("auth") == "OPEN"]
    if not opens:
        return ""
    lines = [
        "",
        "### API surface — unauthenticated routes (static scan)",
        "",
        "The following routes were parsed as **OPEN** (no obvious authentication dependency in static review). "
        "Treat as potential exposure until validated by your security team:",
        "",
    ]
    for e in opens[:30]:
        lines.append(
            f"- **{e.get('method')}** `{e.get('path')}` — `{e.get('citation')}` ({e.get('confidence', 'VERIFIED')})"
        )
    lines.append("")
    return "\n".join(lines)
