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


def parse_time_to_seconds(tok: str) -> Optional[float]:
    m = TIME_RE.match(tok)
    if not m:
        return None
    h, mn, s = int(m.group(1)), int(m.group(2)), int(m.group(3))
    frac = float("0." + m.group(4))
    return h * 3600 + mn * 60 + s + frac


def parse_log(text: str) -> Dict:
    """Parse ruwe logtekst -> {frames, errors, line_count}."""
    frames: List[Dict] = []
    errors = 0
    lines = text.splitlines()
    for line in lines:
        if not line.strip():
            continue
        p = line.split()
        if len(p) < 3:
            continue
        t_sec = parse_time_to_seconds(p[0])
        try:
            dlc = int(p[1])
        except ValueError:
            errors += 1
            continue
        if t_sec is None or dlc < 0 or dlc > 8:
            errors += 1
            continue
        cid = p[2].upper()
        b: List[int] = []
        for tok in p[3:]:
            if len(b) >= dlc:
                break
            if HEX_BYTE.match(tok):
                b.append(int(tok, 16))
            else:
                break
        if len(b) != dlc:
            errors += 1
            continue
        frames.append({"t": p[0], "t_sec": t_sec, "id": cid, "dlc": dlc, "bytes": b})
    return {"frames": frames, "errors": errors, "line_count": len(lines)}


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
