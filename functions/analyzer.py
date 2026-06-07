"""
analyzer.py — combineert parser + decoder tot één resultaat (zoals CAN.analyze in JS).
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Dict, Optional

from can_parser import parse_log, raw_stats
import decoders  # registreert modeldecoders


def analyze(text: str, filename: Optional[str] = None) -> Dict:
    parsed = parse_log(text)
    stats = raw_stats(parsed)
    decoder = decoders.pick(parsed, stats)
    decoded = decoder.decode(parsed, stats)
    return {
        "source_filename": filename,
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
        "decoder_id": decoder.id,
        "vehicle": decoded["model"],
        "raw_stats": stats,
        "decoded": decoded["fields"],
    }


if __name__ == "__main__":
    import sys, json
    path = sys.argv[1] if len(sys.argv) > 1 else "../sample/bmw-3-serie-330e-2021.txt"
    with open(path, encoding="latin-1") as f:
        res = analyze(f.read(), path.split("/")[-1])
    print(json.dumps(res, indent=2, ensure_ascii=False))
