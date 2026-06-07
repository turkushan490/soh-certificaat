"""
main.py — Firebase Cloud Function (Python) voor de SOH-app.

FASE 2/3 (nog niet actief in productie). Wordt getriggerd wanneer een
.txt-bestand in Cloud Storage wordt geüpload: decodeert het, schrijft een
record in Firestore, en (later) genereert een PDF en verstuurt mail.

Lokaal te draaien via de Firebase Emulator Suite. Vereist een Firebase-project.
"""
from __future__ import annotations

# NB: deze imports werken pas wanneer firebase-functions is geïnstalleerd
# (zie requirements.txt) en er een Firebase-project is geïnitialiseerd.
try:
    from firebase_functions import storage_fn, https_fn
    from firebase_admin import initialize_app, firestore
    _FIREBASE = True
except Exception:  # pragma: no cover - alleen in Firebase-omgeving aanwezig
    _FIREBASE = False

from analyzer import analyze

if _FIREBASE:
    initialize_app()

    @storage_fn.on_object_finalized()
    def on_can_upload(event: "storage_fn.CloudEvent") -> None:
        """Trigger: nieuw bestand in Storage -> decoderen -> Firestore-record."""
        name = event.data.name or ""
        if not name.lower().endswith(".txt"):
            return
        # bestand ophalen
        from firebase_admin import storage as admin_storage
        bucket = admin_storage.bucket(event.data.bucket)
        blob = bucket.blob(name)
        text = blob.download_as_bytes().decode("latin-1")

        result = analyze(text, name.split("/")[-1])
        result["storage_path"] = name
        result["status"] = "decoded"

        db = firestore.client()
        db.collection("certificates").add(result)

    @https_fn.on_request()
    def generate_pdf(req: "https_fn.Request") -> "https_fn.Response":
        """FASE 2: genereer certificaat-PDF voor een record-id. (placeholder)"""
        return https_fn.Response("PDF-generatie komt in fase 2.", status=501)
