"""
can_parser.py — CAN-bus logbestand parser + raw stats (Python-spiegel van can.js).

Gebruikt door de Firebase Cloud Function om server-side te decoderen.
Houd deze logica gelijk aan public/can.js.
"""
from __future__ import annotations
import re
from typing import Dict, List, Optional

HEX_BYTE = re.compile(r"^[0-9A-Fa-f]{2}$")
TIME_RE = re.compile(r"^(\d{1,2}):(\d{2}):(\d{2})\.(\d+)$")
ID_RE = re.compile(r"^(0x)?[0-9A-Fa-f]{1,8}$")
CANDUMP_RE = re.compile(r"(?:^|[\s(])((?:0x)?[0-9A-Fa-f]{1,8})#([0-9A-Fa-f]*)")


def parse_time_to_seconds(tok: Optional[str]) -> Optional[float]:
    if tok is None:
        return None
    m = TIME_RE.match(tok)
    if m:
        frac = float("0." + m.group(4))
        return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)) + frac
    if re.match(r"^\d+(\.\d+)?$", tok):
        return float(tok)
    return None


def _norm_id(s: str) -> str:
    return re.sub(r"^0x", "", s, flags=re.I).upper()


def _is_int08(s: str) -> bool:
    return s.isdigit() and 0 <= int(s) <= 8


def _parse_dlc(tokens: List[str]) -> Optional[Dict]:
    for i in range(len(tokens) - 2):
        if not _is_int08(tokens[i]):
            continue
        dlc = int(tokens[i])
        if dlc < 1:
            continue
        id_tok = tokens[i + 1]
        if not ID_RE.match(id_tok):
            continue
        data = tokens[i + 2:i + 2 + dlc]
        if len(data) != dlc or not all(HEX_BYTE.match(b) for b in data):
            continue
        t = tokens[i - 1] if i >= 1 else ""
        return {"t": t, "t_sec": parse_time_to_seconds(t) if i >= 1 else None,
                "id": _norm_id(id_tok), "dlc": dlc, "bytes": [int(b, 16) for b in data]}
    return None


def _parse_candump(tokens: List[str], line: str) -> Optional[Dict]:
    m = CANDUMP_RE.search(line)
    if not m:
        return None
    hexd = m.group(2)
    if len(hexd) % 2:
        return None
    b = [int(hexd[i:i + 2], 16) for i in range(0, len(hexd), 2)]
    t_sec = parse_time_to_seconds(tokens[0])
    return {"t": tokens[0] if t_sec is not None else "", "t_sec": t_sec,
            "id": _norm_id(m.group(1)), "dlc": len(b), "bytes": b}


def parse_log(text: str) -> Dict:
    """Parse ruwe logtekst (meerdere formaten) -> {frames, errors, line_count, format}."""
    frames: List[Dict] = []
    errors = 0
    lines = text.splitlines()
    counts = {"dlc": 0, "candump": 0}
    for line in lines:
        if not line.strip():
            continue
        tokens = line.split()
        fr = _parse_dlc(tokens)
        if fr:
            counts["dlc"] += 1
        else:
            fr = _parse_candump(tokens, line)
            if fr:
                counts["candump"] += 1
        if fr:
            frames.append(fr)
        else:
            errors += 1
    fmt = "candump" if counts["candump"] > counts["dlc"] else "standaard"
    return {"frames": frames, "errors": errors, "line_count": len(lines), "format": fmt}


def raw_stats(parsed: Dict) -> Dict:
    frames = parsed["frames"]
    by_id: Dict[str, int] = {}
    t_min, t_max = float("inf"), float("-inf")
    for f in frames:
        by_id[f["id"]] = by_id.get(f["id"], 0) + 1
        t_min = min(t_min, f["t_sec"])
        t_max = max(t_max, f["t_sec"])
    ids = sorted(by_id.keys())
    duration = round(t_max - t_min, 3) if frames else 0
    return {
        "frame_count": len(frames),
        "parse_errors": parsed["errors"],
        "can_ids": ids,
        "can_id_counts": by_id,
        "duration_s": duration,
        "t_start": frames[0]["t"] if frames else None,
        "t_end": frames[-1]["t"] if frames else None,
    }
