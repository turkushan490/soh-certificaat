# 🔋 SOH Batterij-certificaat

**▶️ Live demo (geen installatie/database nodig):** https://turkushan490.github.io/soh-certificaat/


Lees een **CAN-bus logbestand** (`.txt`) van een elektrische/hybride auto in en toon de
batterijgegevens in een overzicht in donkere huisstijl. Uiteindelijk: online inlogsysteem,
database, sleep-bestand-erin → automatisch een record, PDF genereren en mailen.

> **Eerlijkheid voorop:** alle waarden komen **uitsluitend uit het txt-bestand**.
> Het bijgeleverde Moba-PDF dient alleen als voorbeeld van de gewenste lay-out.

## Status

| Fase | Onderdeel | Status |
|------|-----------|--------|
| 1 | CAN-parser + decoder + GUI (offline, huisstijl) | ✅ werkt |
| 1 | Opslaan in lokale "database" (localStorage) | ✅ werkt |
| 1 | Kenteken + handmatige velden per auto | ✅ werkt |
| 1 | Doorzoekbare/sorteerbare lijst + paginering (100en) | ✅ werkt |
| 2 | PDF genereren (uitprintbaar certificaat per auto) | ✅ werkt |
| 2 | Mailen | ⏳ gepland |
| 3 | Firebase: login + Firestore + Storage + online | 🧱 gescaffold |

## Workflow

1. Auto wordt uitgelezen → je krijgt een `.txt` CAN-log.
2. Sleep die in de app; vul **kenteken** en (van je diagnose) **SOH/km** in.
3. **Opslaan** → de meting komt met datum in het archief.
4. Later **terugzoeken** op kenteken/datum/maand en **PDF printen** per auto.

## Ondersteunde auto's

De app leest **drie soorten diagnose-logs** automatisch uit:
- **BMW / Mini** (UDS via tester 6F1): VIN, SOH, packspanning, hoogste/laagste cel.
- **Volvo / Polestar** (extended ID's): VIN, cellen + packspanning (96-cel array), capaciteit (exp.).
- **OBD-II standaard** (7E8, bv. Jaguar, en de meeste merken): VIN (Mode 09) + cel-arrays.

**Merk-herkenning uit de VIN** voor alle grote EV/hybride-merken: BMW, Mini, Volvo, Polestar,
Tesla, Nissan, Hyundai, Kia, VW, Audi, Škoda, SEAT/Cupra, Mercedes, Smart, Renault, Peugeot,
Citroën, DS, Opel, Fiat, Jaguar, Land Rover, Porsche, Toyota, Lexus, Honda, Mazda, Subaru,
Mitsubishi, MG, BYD, Ford, e.a.

**Generiek (merk-overstijgend):** VIN + cel-array (hoogste/laagste cel, celverschil,
packspanning) worden voor elk merk gelezen zodra die in de log staan. Merk-specifieke
SOH/capaciteit worden per merk toegevoegd (BMW gevalideerd; andere via een ijkpunt of
publieke bron zoals OVMS/wican-fw — zie `docs/CONTEXT.md`).

## Belangrijke bevinding (onderzoek)

Het voorbeeldbestand is een **passieve** CAN-opname. De certificaat-getallen (SOH 89%,
packspanning 341,96 V, celspanning 3,571/3,553 V) staan er **niet letterlijk** in — die worden
normaal via **actieve diagnose-vragen** (UDS) opgehaald. De app toont daarom:

- **Bestandsstatistieken** → 100% betrouwbaar (frames, CAN-ID's, duur, tijdspanne).
- **Afgeleide signalen** → experimentele kandidaten met een zekerheidslabel + bron-byte.
- Niet-afleidbare velden → **"onbekend"** (geen verzonnen getallen).

De decoder is **per automodel uitbreidbaar** (`public/can.js` en `functions/decoders/`).

## Offline draaien (fase 1 — nu testen)

Geen installatie nodig behalve Python (voor een lokale webserver):

```bash
cd soh-certificaat
python -m http.server 8123 --directory public
# open http://localhost:8123
```

Sleep een `.txt` CAN-log in het vlak → bekijk het overzicht → "Opslaan in database".
Opgeslagen metingen blijven in je browser (localStorage) bewaard.

Een voorbeeldbestand staat in [`sample/`](sample/).

## Projectstructuur

```
soh-certificaat/
├── public/                  # Frontend (Firebase Hosting), huisstijl
│   ├── index.html
│   ├── styles.css
│   ├── can.js               # CAN-parser + decoder (model-register)
│   ├── storage.js           # opslag-abstractie (localStorage → Firebase)
│   ├── app.js               # UI-logica
│   └── firebase-config.example.js
├── functions/               # Cloud Functions (Python) — fase 2/3
│   ├── can_parser.py        # spiegel van can.js (server-side)
│   ├── analyzer.py
│   ├── decoders/            # base.py + per-model decoders
│   ├── main.py              # Storage-trigger → Firestore (+ PDF/mail later)
│   └── requirements.txt
├── firebase.json            # Hosting + emulator-config
├── firestore.rules / storage.rules
└── sample/                  # voorbeeld CAN-log
```

## Online gaan (fase 3 — later)

1. Firebase-project aanmaken op <https://console.firebase.google.com>.
2. `npm i -g firebase-tools` en `firebase login`.
3. `firebase init` (Hosting, Firestore, Storage, Functions) of de bestaande config gebruiken.
4. `public/firebase-config.example.js` → kopieer naar `firebase-config.js`, vul in.
5. Lokaal testen: `firebase emulators:start`.
6. Live: `firebase deploy`.

## Tests

```bash
# Python parser/decoder
cd functions && python analyzer.py ../sample/bmw-3-serie-330e-2021.txt
```
