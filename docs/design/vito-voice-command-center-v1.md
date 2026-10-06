# VITO Voice Command Center V1

## Ziel

VITO soll die zentrale, sprachfähige Eingangstür für Alessandro werden: Sprache hinein, sichtbares Transkript und Ergebnis heraus. Die Sprachoberfläche ist kein eigener Agent und erhält keine Umgehung der bestehenden VITO-Governance.

## V1-Schnitt

V1 ist zunächst ein staging-only Control-Center-Modul:

- Push-to-talk im Browser, mit manueller Texteingabe als Fallback.
- Sichtbares Live-/Final-Transkript.
- Gesprochene Antwort über die Browser-Audioausgabe.
- Ein sicherer Read-only-Befehl: Status/Lage/Überblick.
- Jede nicht eindeutig Read-only erkennbare Anweisung wird am Human Gate angehalten.
- Keine Production-, Golden-, ADOREN-, OSSERVATORE- oder SELECTA-Aktion.
- Keine direkte Datenbank-, SSH-, Docker-, GitHub- oder Dateisystemausführung aus dem Browser.

## Zielarchitektur

~~~text
Browser Control Center
  -> Voice session / transcript
  -> VITO intent boundary
  -> bestehende JWT-, Tenant- und Rollenprüfung
  -> Command Bus oder Read-only Operations API
  -> Audit / sichtbare Antwort
~~~

Für die eigentliche Echtzeitstimme wird als nächster Ausbauschritt WebRTC mit einer serverseitig erzeugten Sitzung vorbereitet. Der API-Schlüssel bleibt ausschließlich auf dem Server. Tool-Ausführung und Policy-Entscheidungen bleiben in VITO.

## Kommandogrenzen

| Sprachabsicht | V1-Verhalten |
| --- | --- |
| „Vito, Status“ / „Wie ist die Lage?“ | Read-only Operations-Summary laden und vorlesen |
| „Prüfe …“ | Nur nach expliziter, implementierter Read-only-Route |
| „Go“, „deploy“, „fix“, „löschen“, „starte“ | Human Gate; keine Ausführung |
| Unklare oder gemischte Aussage | Human Gate; Rückfrage bzw. sichtbarer Hinweis |

Die Sprache darf niemals selbst ein Approval-Level, eine Organisation, einen Benutzer oder ein Ziel bestimmen. Diese Werte kommen ausschließlich aus dem authentifizierten VITO-Kontext.

## Sicherheits- und Auditregeln

- Control Center bleibt hinter der bestehenden Session-/JWT-Grenze.
- Read-only Status nutzt die tenant-scoped Operations API.
- OWNER/ADMIN-Grenzen der Operations API bleiben wirksam.
- Realtime-Toolcalls werden später serverseitig validiert und auf eine Allowlist begrenzt.
- Jede ausgeführte oder abgewiesene Absicht erhält eine nachvollziehbare Audit-Spur.
- V1 bleibt per Feature-/Route-Freigabe staging-only; kein automatischer Merge oder Deployment.

## Akzeptanzkriterien

1. Desktop-Browser kann per Tastendruck Sprache aufnehmen.
2. Transcript bleibt sichtbar und kann korrigiert/erneut gesendet werden.
3. „Vito, Status“ liefert tenant-scoped Daten oder eine klare Fehlerantwort.
4. Jede Antwort wird zugleich als Text und, wenn verfügbar, als Sprache ausgegeben.
5. Ein Satz wie „deploy ADOREN“ führt zu keiner Aktion und zeigt Human Gate.
6. Kein OpenAI- oder anderer API-Schlüssel gelangt in den Browser.
7. Bestehende Previews und geschützte Laufzeiten bleiben unverändert.

## Nächster Ausbau

- Realtime-WebRTC-Sitzung mit serverseitigem ephemeral client secret.
- Transcript- und Turn-Events über Data Channel.
- Serverseitige Tooldelegation an den VITO Command Bus.
- Explizite Bestätigung für L2/L3-Aktionen; L4/L5 bleiben geschlossen, bis ein Review-Workflow vorhanden ist.
- Smartphone-Layout und optionaler Background-/Wake-Word-Modus erst nach Privacy- und Kostenprüfung.
