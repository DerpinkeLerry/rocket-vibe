# Rocket Vibe 1.8 – Go Multiplayer / Railway

Browser-Spiel fuer bis zu vier Spieler mit Three.js-Rendering, lokaler Client-Prediction und einem autoritativen Go-Server. Frontend und Server werden auf Railway als **ein Service** betrieben. Dadurch verwendet der Browser dieselbe HTTPS-Domain fuer Seite und WebSocket (`/lan`); eine separate Backend-URL oder CORS-Konfiguration ist nicht erforderlich.

## Architektur

- Der Browser sendet nur Eingaben, niemals vertrauenswuerdige Positionen.
- Go simuliert Autos, Ball, Schwerkraft und Kollisionen mit 120 Hz.
- Go sendet 60 binaere Snapshots pro Sekunde.
- Ein Snapshot fuer vier Autos, Ball, Spielstand, Booststaende und Boost-Pad-Maske ist 277 Byte gross.
- Der eigene Browser sagt die lokale Bewegung voraus und korrigiert sanft zum Serverzustand.
- Andere Autos und der Ball werden zwischen Snapshots extrapoliert und geglaettet.
- Online wird im Browser kein Rapier/WASM geladen; das spart CPU und RAM auf schwachen Geraeten.
- `npm run dev` bleibt als lokaler Einspieler-/Rapier-Modus erhalten.

Die Arena besitzt eine geschlossene, transparente Einfassung mit abgerundeten Ecken und Glasdecke. Eine sieben Meter breite Viertelrundung verbindet den Boden ohne 90-Grad-Kante mit der Glaswand; Autos koennen darueber bis auf die senkrechte Flaeche fahren. Die Kamera darf auch hinter bzw. ausserhalb der Arena stehen; Geometrie zwischen Kamera und Auto wird fuer den Render-Frame ausgeblendet. Client-Prediction, Go-Server und der lokale Rapier-Modus verwenden dieselbe Grundform, damit Wand- und Bodenkontakte nicht durch spaete Netzwerkkorrekturen zurueckspringen.

Beim Start werden Spielername und eine von vier rein optischen, Rocket-League-inspirierten Karosserien mit Vorschau ausgewaehlt. Alle vier Varianten verwenden dieselbe Hitbox und dieselben Fahrwerte. Der Server bereinigt und begrenzt ihn, verteilt feste Orange-/Blau-Teams und sendet die Spielerliste an alle Browser. Namensschilder erscheinen ueber den Autos. Das orange Tor liegt auf +Z, das blaue auf -Z; ein Treffer zaehlt fuer das gegnerische Team, aktualisiert den zentralen Spielstand und startet alle Fahrzeuge sowie den Ball neu.

Die Serverphysik rechnet intern mit `float64`. Fuer das Netzwerk werden Position, Quaternion, lineare und Winkelgeschwindigkeit als `float32` uebertragen. Bei vier Spielern sind das grob 16 KB/s je Client bzw. rund 64 KB/s Server-Ausgang plus WebSocket-Overhead.

## Serverseitige Physik

Der Go-Server ist die einzige Online-Autoritaet und verarbeitet:

- Rocket-League-artige Bodenbeschleunigung, Bremsen, Grip, Lenkung und verbrauchbaren Boost
- Fahrtempo ca. 70 km/h normal und maximal 100 km/h mit Boost; einmal aufgebaute Boost-Geschwindigkeit oberhalb 70 km/h bleibt ohne automatisches Zurueckbremsen erhalten, bis gebremst oder anderweitig Tempo verloren wird
- Vier grosse 100-%-Boostpads in den Ecken sowie zwoelf kleine +20-%-Pads mit 10/4 Sekunden Respawn
- Variabler Sprung durch gehaltenes Space, neutraler Doppelsprung und gerichtete Dodge/Flips
- Pitch/Yaw/Roll in der Luft mit begrenzter, kontrollierbarer Winkelgeschwindigkeit
- Surface-Adhesion: Rampen und senkrechte Waende halten das Auto bis zum aktiven Absprung
- Auto gegen Auto
- Auto gegen Ball
- Auto und Ball gegen Boden, Seitenwaende, Endwaende, Torrahmen, Tortunnel und Decke
- Befahrbare Boden-Wand-Rundungen inklusive senkrechter Wandfahrt
- Torerkennung, Orange-/Blau-Spielstand und gemeinsamer Kickoff-Reset
- Speed-Caps, Input-Timeout, Reset und Schutz vor nicht-endlichen Zustandswerten

Die Engine ist bewusst klein und fuer dieses Spiel abgestimmt. Sie ist keine allgemeine Rapier-Neuimplementierung, vermeidet aber eine schwere native Physik-Abhaengigkeit im Go-Container.

## Voraussetzungen lokal

- Node.js 22.13 oder neuer
- Go 1.23 oder neuer

```bash
npm ci
npm run build
go test ./...
go run ./cmd/server
```

Danach: `http://localhost:8080`

Fuer einen LAN-Start inklusive Frontend-Build:

```bash
npm run lan
```

Freunde im selben Netzwerk oeffnen `http://DEINE-LAN-IP:8080`. Die ersten vier Browser erhalten Spielerplatz 1 bis 4.

## Railway deployen

1. Dieses Verzeichnis in ein GitHub-Repository pushen.
2. In Railway **New Project → Deploy from GitHub repo** waehlen.
3. Das Repository bzw. bei einem Monorepo dieses Verzeichnis als Root Directory auswaehlen.
4. Deploy starten und unter **Networking → Generate Domain** eine Domain erzeugen.
5. Alle Spieler verwenden dieselbe Railway-Domain.

Railway erkennt das `Dockerfile`; `railway.json` erzwingt den Dockerfile-Builder, `/health` als Healthcheck und genau eine Amsterdam-Replica. Fuer den In-Memory-Match duerfen nicht mehrere Replicas aktiv sein, da sie sonst getrennte Spielwelten erzeugen.

Es sind keine Pflichtvariablen notwendig. Railway setzt `PORT` automatisch. Optional:

- `ALLOWED_ORIGINS=spiel.example.com,*.example.com` erlaubt zusaetzliche Browser-Origin-Patterns. Ohne Wert gilt die sichere Same-Origin-Pruefung.
- `STATIC_DIR` muss nur geaendert werden, wenn der Server ausserhalb des Dockerfiles gestartet wird und `dist` an einem anderen Ort liegt.

Healthcheck und Diagnose:

```text
GET /health
GET /config
GET /debug/game
WS  /lan
```

Ein Deployment beendet laufende Matches beim Containerwechsel. Fuer spaetere Matchmaking-/Mehrraum-Unterstuetzung sollte jede Lobby an genau einen Prozess gebunden oder ueber einen externen Session-Dienst geroutet werden.

## Steuerung

- W / S: Boden Gas/Rueckwaerts, Luft Pitch
- A / D: Boden Lenken, Luft Yaw
- Q / E: Air Roll
- Shift: Boost (verbraucht die 0–100-Leiste unten mittig)
- Space: Sprung (halten = mehr Lift) / Doppelsprung; mit W/A/S/D beim zweiten Sprung = Flip/Dodge
- R: eigenes Auto resetten
- B: Ball resetten (Entwicklungsfunktion)
- F2: Normal / Ultra-VM umschalten und Seite neu laden
- Kamera: `C` schaltet zwischen Ball Cam und Car Cam; das Auto bleibt in beiden Modi zentriert. Hindernisse zwischen Kamera und Auto werden beim Rendern ausgeblendet, und die Kamera darf hinter/außerhalb der Arena stehen.

## Schwache Rechner / VM

```text
https://DEINE-DOMAIN.up.railway.app/?perf=ultra
```

Der Ultra-Modus reduziert nur die Grafik und lokale Prediction dieses Browsers. Andere Spieler koennen gleichzeitig den normalen Modus nutzen.

## Qualitaetschecks

```bash
npm run build
npm run test:js
go test ./...
go test -race ./...
```

Die Tests decken Fahrbewegung, 70/100-km/h-Speed-Caps und erhaltenes Boost-Momentum, Boostverbrauch, Boost-Pickups/Respawn, Sprung-Lockout, Boden-Tunneling, die Fahrt vom Boden auf senkrechtes Glas, beide farbigen Tore, Spielstand, Namen, Auto-Ball-Impuls, Input-Reihenfolge, das exakte Binaerprotokoll und einen echten HTTP/WebSocket-Verbindungsaufbau ab.
