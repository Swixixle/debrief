#!/usr/bin/env bash
set -euo pipefail

TMP="$(mktemp -d)"
OUT="$TMP/out"
trap 'rm -rf "$TMP"' EXIT

echo "=== Smoke Test: Program Totality Analyzer ==="

echo "[1/6] pta --help"
pta --help >/dev/null
echo "  PASS"

echo "[2/6] python -m server.analyzer.src --help"
python -m server.analyzer.src --help >/dev/null
echo "  PASS"

echo "[3/6] python server/analyzer/analyzer_cli.py --help"
python server/analyzer/analyzer_cli.py --help >/dev/null
echo "  PASS"

echo "[4/6] Deterministic analysis (--no-llm)..."
pta analyze --replit --no-llm -o "$OUT"
echo "  PASS"

echo "[5/6] Checking output files..."
RUN_DIR="$(ls -1dt "$OUT"/runs/* 2>/dev/null | head -n 1)"
if [ -z "${RUN_DIR:-}" ] || [ ! -d "$RUN_DIR" ]; then
  echo "  FAIL: no runs/<run-id> directory under $OUT"
  exit 1
fi
for f in target_howto.json coverage.json claims.json index.json DOSSIER.md replit_profile.json; do
  if [ ! -f "$RUN_DIR/$f" ]; then
    echo "  FAIL: missing $f in $RUN_DIR"
    exit 1
  fi
done
echo "  PASS"

echo "[6/6] Validating no invalid evidence (line_start < 1)..."
python3 - "$OUT" <<'PY'
import json, glob, sys
paths = glob.glob(sys.argv[1] + "/**/*.json", recursive=True)
bad = []
def walk(x, where=""):
    if isinstance(x, dict):
        if "line_start" in x and isinstance(x["line_start"], int) and x["line_start"] < 1:
            bad.append((where, x))
        for k, v in x.items():
            walk(v, where + f".{k}")
    elif isinstance(x, list):
        for i, v in enumerate(x):
            walk(v, where + f"[{i}]")
for p in paths:
    try:
        j = json.load(open(p))
    except Exception:
        continue
    walk(j, p)
if bad:
    print(f"  FAIL: {len(bad)} invalid evidence entries found")
    for w, e in bad[:5]:
        print(f"    {w}: {e}")
    sys.exit(1)
print("  PASS")
PY

echo ""
echo "=== ALL SMOKE TESTS PASSED ==="
