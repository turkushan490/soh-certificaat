# Project-context (lees dit i.p.v. de grote logbestanden)

Compacte status zodat we niet steeds grote bestanden hoeven te herlezen.

## Wat het is
Offline web-app (donkere huisstijl) die CAN-bus `.txt`-logs inleest, per auto een
batterijcertificaat maakt en archiveert. Repo: `turkushan490/soh-certificaat` (privé).
Lokaal: `C:\ai code\soh\soh-certificaat`. Frontend in `public/`, draait offline.

## CAN-logformaat (beide voorbeelden gelijk)
`HH:MM:SS.ffff  <DLC>  <CAN-ID hex>  <byte0..byteN hex>  <ascii>`  — regels eindigen op CRLF.
- `Bmw 3 serie 12kw 2021.txt` → 381 frames, 9 ID's (130,3C,799,7C1,7C3,7C7,7C8,7C9,7D3).
- `CAN_500000_2026-04-30 18-41-59.txt` → 2759 frames, 27 ID's.
Parser (`public/can.js`) herkent dit + extra kolommen/0x-prefix + candump (`ID#DATA`).

## TWEE bestandstypen (belangrijk)
1. **Passief** (`Bmw 3 serie 12kw 2021.txt`): broadcast, ID's 130/3C/7Cx/799/7D3.
   Certificaatwaarden zitten er NIET in -> handmatig invullen. Decoder: `bmw_g20_phev`.
2. **Actieve UDS-diagnose** (`CAN_500000_*.txt`): tester 6F1 vraagt DID's (22 <DID>),
   ECU's antwoorden op 0x6xx (62 <DID> <data>), ISO-TP multiframe. Data zit er WEL in!
   Decoder: `bmw_uds` (ISO-TP reassembly). Auto-geëxtraheerd: VIN (DID F190),
   hoogste/laagste celspanning + verschil (DID DDBF, mV). VIN voorbeeld: WBY8P210X07D31136.
   Nog te mappen DID's (kalibratie nodig): SOH, packspanning, capaciteit. Ruwe DID's
   worden bewaard in record.raw_dids voor latere kalibratie.

## Belangrijk: decoderen
De certificaatwaarden (SOH, packspanning 341,96V, cellen 3,571/3,553V, VIN) staan
**NIET** in deze passieve opnames — exhaustief bewezen (hex/BCD/patroon = 0 hits). Ze komen
uit een **actieve** UDS-diagnose die hier niet is opgenomen. Daarom: gebruiker vult de
batterijwaarden zelf in (van zijn diagnose); de txt levert bestandsbewijs + archief.

## Architectuur / bestanden
- `public/can.js` — parser (multi-format) + decoder-register (model-uitbreidbaar).
- `public/storage.js` — opslag (nu localStorage, later Firebase).
- `public/certificate.js` — printbaar PDF-certificaat (window.print).
- `public/app.js` — UI: drag-drop, invulvelden, live-overzicht, zoekbare lijst.
- `functions/` — Python-spiegel (voor latere Firebase Cloud Functions).
- Scripts hebben `?v=N` cache-busting; bij wijziging N ophogen.

## Werkende features (fase 1+2)
Drag-drop + robuuste parse + duidelijke foutmelding · invulbaar certificaat (kenteken,
SOH, packspanning, cellen, celverschil auto, capaciteit, VIN, km, notitie) · live-overzicht ·
opslaan · zoeken/sorteren/maandfilter/paginering · aanklikbaar detail · PDF/printen.

## Nog te doen
Mailen · Fase 3 Firebase online (login + cloud-DB; vereist Google-account).

## Veelvoorkomend probleem
"Bestand niet herkend" = bijna altijd browser-cache → Ctrl+Shift+R (hard refresh).
