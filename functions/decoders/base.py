"""
decoders/base.py — decoder-interface + register (Python-spiegel van can.js).

Een decoder kijkt naar de geparste frames en levert per veld een dict:
    {"value": <of None>, "unit": str, "confidence": str, "source": str, "note": str}
Velden die niet betrouwbaar af te leiden zijn -> value None ("onbekend").
"""
from __future__ import annotations
from typing import Callable, Dict, List

DECODERS: List["Decoder"] = []


def field(value, unit="", confidence="laag", source="", note=""):
    return {"value": value, "unit": unit, "confidence": confidence,
            "source": source, "note": note}


def frames_for(parsed: Dict, cid: str) -> List[Dict]:
    return [f for f in parsed["frames"] if f["id"] == cid]


class Decoder:
    def __init__(self, id: str, label: str,
                 matches: Callable[[Dict, Dict], bool],
                 decode: Callable[[Dict, Dict], Dict]):
        self.id = id
        self.label = label
        self.matches = matches
        self.decode = decode


def register(decoder: Decoder) -> None:
    DECODERS.append(decoder)


def pick(parsed: Dict, stats: Dict) -> Decoder:
    for d in DECODERS:
        try:
            if d.matches(parsed, stats):
                return d
        except Exception:
            continue
    return GENERIC


GENERIC = Decoder(
    id="generic",
    label="Onbekend model (generiek)",
    matches=lambda parsed, stats: True,
    decode=lambda parsed, stats: {
        "model": "Onbekend model",
        "fields": {"soh": field(None, "%", "n.v.t.", "—",
                                 "Geen modelspecifieke decoder; SOH niet bepaald.")},
    },
)
