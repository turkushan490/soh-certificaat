"""Decoder-register. Importeer modelmodules zodat ze zich registreren."""
from . import bmw_g20_phev  # noqa: F401  (registreert zichzelf)
from .base import pick, DECODERS  # noqa: F401
