<<<<<<< HEAD
# Rocket Vibe 1.5 – Go Multiplayer / Railway
=======
<<<<<<< HEAD
# Rocket Vibe 1.5 – Go Multiplayer / Railway
=======
# Rocket Vibe 1.4 – Go Multiplayer / Railway
>>>>>>> e4f4ac3d0103e90daad46770ba947151c0f2f96e
>>>>>>> aa0410627aafadacad13bfd71149edb51a6841da

Browser-Spiel fuer bis zu vier Spieler mit Three.js-Rendering, lokaler Client-Prediction und einem autoritativen Go-Server. Frontend und Server werden auf Railway als **ein Service** betrieben. Dadurch verwendet der Browser dieselbe HTTPS-Domain fuer Seite und WebSocket (`/lan`); eine separate Backend-URL oder CORS-Konfiguration ist nicht erforderlich.

## Architektur

- Der Browser sendet nur Eingaben, niemals vertrauenswuerdige Positionen.
- Go simuliert Autos, Ball, Schwerkraft und Kollisionen mit 120 Hz.
- Go sendet 60 binaere Snapshots pro Sekunde.
- Ein Snapshot fuer vier Autos plus Ball ist 267 Byte gross.
- Der eigene Browser sagt die lokale Bewegung voraus und korrigiert sanft zum Serverzustand.
- Andere Autos und der Ball werden zwischen Snapshots extrapoliert und geglaettet.
- Online wird im Browser kein Rapier/WASM geladen; das spart CPU und RAM auf schwachen Geraeten.
- `npm run dev` bleibt als lokaler Einspieler-/Rapier-Modus erhalten.

<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> aa0410627aafadacad13bfd71149edb51a6841da
Die Arena besitzt eine geschlossene, transparente Einfassung mit abgerundeten Ecken und Glasdecke. Die Kamera bleibt innerhalb dieser Form. Client-Prediction, Go-Server und der lokale Rapier-Modus verwenden dieselbe Grundform, damit Wand- und Bodenkontakte nicht durch spaete Netzwerkkorrekturen zurueckspringen.

Die Serverphysik rechnet intern mit `float64`. Fuer das Netzwerk werden Position, Quaternion, lineare und Winkelgeschwindigkeit als `float32` uebertragen. Bei vier Spielern sind das grob 16 KB/s je Client bzw. rund 64 KB/s Server-Ausgang plus WebSocket-Overhead.

## Serverseitige Physik

Der Go-Server ist die einzige Online-Autoritaet und verarbeitet:

<<<<<<< HEAD
=======
=======
Die Serverphysik rechnet intern mit `float64`. Fuer das Netzwerk werden Position, Quaternion, lineare und Winkelgeschwindigkeit als `float32` uebertragen. Bei vier Spielern sind das grob 16 KB/s je Client bzw. rund 64 KB/s Server-Ausgang plus WebSocket-Overhead.

## Serverseitige Physik

Der Go-Server ist die einzige Online-Autoritaet und verarbeitet:

>>>>>>> e4f4ac3d0103e90daad46770ba947151c0f2f96e
>>>>>>> aa0410627aafadacad13bfd71149edb51a6841da
- Bodenbeschleunigung, Bremsen, Grip, Lenkung und Boost
- Sprung, Doppelsprung sowie Pitch/Yaw/Roll in der Luft
- Auto gegen Auto
- Auto gegen Ball
- Auto und Ball gegen Boden, Seitenwaende, Endwaende, Torrahmen, Tortunnel und Decke
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
- Shift: Boost
- Space: Sprung / Doppelsprung
- R: eigenes Auto resetten
- B: Ball resetten (Entwicklungsfunktion)
- F2: Normal / Ultra-VM umschalten und Seite neu laden
- Kamera: permanente Ball Cam

## Schwache Rechner / VM

```text
https://DEINE-DOMAIN.up.railway.app/?perf=ultra
```

Der Ultra-Modus reduziert nur die Grafik und lokale Prediction dieses Browsers. Andere Spieler koennen gleichzeitig den normalen Modus nutzen.

## Qualitaetschecks

```bash
npm run build
<<<<<<< HEAD
npm run test:js
=======
<<<<<<< HEAD
npm run test:js
=======
>>>>>>> e4f4ac3d0103e90daad46770ba947151c0f2f96e
>>>>>>> aa0410627aafadacad13bfd71149edb51a6841da
go test ./...
go test -race ./...
```

<<<<<<< HEAD
Die Tests decken Fahrbewegung, Speed-Cap, Sprung-Lockout, Boden-Tunneling, abgerundete Wandkollisionen ohne Feder-Rueckstoss, Auto-Ball-Impuls, Input-Reihenfolge, das exakte Binaerprotokoll und einen echten HTTP/WebSocket-Verbindungsaufbau ab.
=======
<<<<<<< HEAD
Die Tests decken Fahrbewegung, Speed-Cap, Sprung-Lockout, Boden-Tunneling, abgerundete Wandkollisionen ohne Feder-Rueckstoss, Auto-Ball-Impuls, Input-Reihenfolge, das exakte Binaerprotokoll und einen echten HTTP/WebSocket-Verbindungsaufbau ab.
=======
Die Tests decken Fahrbewegung, Speed-Cap, Tor-/Wandkollision, Auto-Ball-Impuls, Input-Reihenfolge, das exakte Binaerprotokoll und einen echten HTTP/WebSocket-Verbindungsaufbau ab.
>>>>>>> e4f4ac3d0103e90daad46770ba947151c0f2f96e
>>>>>>> aa0410627aafadacad13bfd71149edb51a6841da
