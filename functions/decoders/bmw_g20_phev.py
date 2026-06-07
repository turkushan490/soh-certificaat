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

    # Kandidaat live packspanning: 7C3 b2:b3 (BE) ~3181-3182 -> ÷10 ≈ 318,2 V
    f7c3 = frames_for(parsed, "7C3")
    if f7c3:
        raw = [(f["bytes"][2] << 8) | f["bytes"][3] for f in f7c3]
        avg = sum(raw) / len(raw)
        fields["pack_voltage"] = field(
            round(avg / 10, 1), "V", "laag", "7C3 b2:b3 (BE) ÷10",
            "Experimentele afleiding van live packspanning; niet de certificaatwaarde.")

    # Kandidaat percentage (mogelijk SOC): 7C1 b6
    f7c1 = frames_for(parsed, "7C1")
    if f7c1:
        fields["percentage_7c1"] = field(
            f7c1[-1]["bytes"][6], "%", "zeer laag", "7C1 b6",
            "Mogelijk SOC of een ander percentage; niet bevestigd.")

    # Kandidaat signaal: 799 b0 (49-53)
    f799 = frames_for(parsed, "799")
    if f799:
        vals = [f["bytes"][0] for f in f799]
        fields["signal_799"] = field(
            round(sum(vals) / len(vals)), "", "zeer laag", "799 b0",
            "Stabiel rond 49-53; betekenis onbevestigd (temp/SOC?).")

    # Niet-afleidbare certificaat-velden -> onbekend
    fields["soh"] = field(None, "%", "n.v.t.", "—", "Niet aanwezig in passieve CAN-opname.")
    fields["cell_high"] = field(None, "V", "n.v.t.", "—", "Niet aanwezig in logbestand.")
    fields["cell_low"] = field(None, "V", "n.v.t.", "—", "Niet aanwezig in logbestand.")
    fields["cell_diff"] = field(None, "mV", "n.v.t.", "—", "Niet aanwezig in logbestand.")
    fields["vin"] = field(None, "", "n.v.t.", "—", "Niet aanwezig in deze opname.")

    return {"model": "BMW 3-serie 330e (PHEV)", "fields": fields}


register(Decoder("bmw_g20_phev", "BMW 3-serie 330e (PHEV)", _matches, _decode))
