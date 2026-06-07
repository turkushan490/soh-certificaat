"""
decoders/bmw_g20_phev.py — BMW 3-serie 330e (PHEV) decoder.

Python-spiegel van de bmw_g20_phev decoder in public/can.js.
Confidences zijn bewust experimenteel; pas de byte-mapping aan zodra er
logs met diagnose-vraag/antwoord (UDS) of meer modellen beschikbaar zijn.
"""
from __future__ import annotations
from typing import Dict
from .base import Decoder, register, field, frames_for


def _matches(parsed: Dict, stats: Dict) -> bool:
    return all(i in stats["can_ids"] for i in ("7C1", "7C3", "7C7"))


def _decode(parsed: Dict, stats: Dict) -> Dict:
    fields: Dict[str, Dict] = {}

    # Stabiele ruwe waarde uit 7C3 b2:b3 (BE) ~3181-3182. Grootheid ONBEVESTIGD.
    f7c3 = frames_for(parsed, "7C3")
    if f7c3:
        raw = [(f["bytes"][2] << 8) | f["bytes"][3] for f in f7c3]
        fields["raw_7c3"] = field(
            round(sum(raw) / len(raw)), "", "zeer laag", "7C3 b2:b3 (BE)",
            "Stabiele ruwe waarde, grootheid onbevestigd (mogelijk spanning/temperatuur).")

    # Ruw signaal uit 7C1 b6. Betekenis ONBEVESTIGD.
    f7c1 = frames_for(parsed, "7C1")
    if f7c1:
        fields["raw_7c1"] = field(
            f7c1[-1]["bytes"][6], "", "zeer laag", "7C1 b6",
            "Ruw signaal; betekenis onbevestigd.")

    # Niet-afleidbaar uit passieve opname (vereisen actieve diagnose / UDS).
    note = "Niet aanwezig in passieve CAN-opname; vereist een diagnose-log (UDS)."
    fields["soh"] = field(None, "%", "n.v.t.", "—", note)
    fields["pack_voltage"] = field(None, "V", "n.v.t.", "—", note)
    fields["cell_high"] = field(None, "V", "n.v.t.", "—", note)
    fields["cell_low"] = field(None, "V", "n.v.t.", "—", note)
    fields["cell_diff"] = field(None, "mV", "n.v.t.", "—", note)
    fields["vin"] = field(None, "", "n.v.t.", "—", note)

    return {"model": "BMW 3-serie 330e (PHEV)", "fields": fields}


register(Decoder("bmw_g20_phev", "BMW 3-serie 330e (PHEV)", _matches, _decode))
