# Rocket Vibe 1.10.7 – Go Multiplayer / Railway

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

Die Arena besitzt eine geschlossene, transparente Einfassung mit abgerundeten Ecken und Glasdecke. Eine kompakte 3,4-Meter-Viertelrundung verbindet den Boden ohne 90-Grad-Kante mit der Wand; das Glas beginnt bereits kurz oberhalb der Rundung. Der Tormund besitzt eine eigene horizontale 2,8-Meter-Rundung, die Endwand, Torseitenwand und Torboden sichtbar wie physikalisch ohne offene Naht verbindet. Die Kamera darf auch hinter bzw. ausserhalb der Arena stehen; Geometrie zwischen Kamera und Auto wird fuer den Render-Frame ausgeblendet. Client-Prediction, Go-Server und der lokale Rapier-Modus verwenden dieselbe Grundform, damit Wand-, Tor- und Bodenkontakte nicht durch spaete Netzwerkkorrekturen zurueckspringen.

Beim Start werden Spielername und eine von vier rein optischen, Rocket-League-inspirierten Karosserien mit Vorschau ausgewaehlt. Alle vier Varianten verwenden dieselbe Hitbox und dieselben Fahrwerte. Der Server bereinigt und begrenzt ihn, verteilt feste Orange-/Blau-Teams und sendet die Spielerliste an alle Browser. Namensschilder erscheinen ueber den Autos. Das orange Tor liegt auf +Z, das blaue auf -Z; ein Treffer zaehlt fuer das gegnerische Team, aktualisiert den zentralen Spielstand und startet alle Fahrzeuge sowie den Ball neu.

Die Serverphysik rechnet intern mit `float64`. Fuer das Netzwerk werden Position, Quaternion, lineare und Winkelgeschwindigkeit als `float32` uebertragen. Bei vier Spielern sind das grob 16 KB/s je Client bzw. rund 64 KB/s Server-Ausgang plus WebSocket-Overhead.

## Serverseitige Physik

Der Go-Server ist die einzige Online-Autoritaet und verarbeitet:

- Rocket-League-artige Bodenbeschleunigung, Bremsen, Grip, Lenkung und verbrauchbaren Boost
- Fahrtempo ca. 70 km/h normal und maximal 100 km/h mit Boost; einmal aufgebaute Boost-Geschwindigkeit oberhalb 70 km/h bleibt ohne automatisches Zurueckbremsen erhalten, bis gebremst oder anderweitig Tempo verloren wird
- Vier grosse 100-%-Boostpads in den Ecken sowie zwoelf kleine +20-%-Pads mit 10/4 Sekunden Respawn
- Variabler Sprung durch gehaltenes Space, neutraler Doppelsprung und gerichtete Dodge/Flips mit exakt einer kontrollierten 360-Grad-Rotation
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
- STRG / CTRL: Drift / Handbremse fuer engere Kurven und kontrollierten Seitenschlupf
- Shift: Boost (verbraucht die 0–100-Leiste unten mittig)
- Space: Sprung (halten = mehr Lift) / Doppelsprung; mit W/A/S/D beim zweiten Sprung = Flip/Dodge
- R: eigenes Auto resetten
- B: Ball resetten (Entwicklungsfunktion)
- F2: auf PC zwischen Normal / Ultra High / Ultra Low wechseln und Seite neu laden
- Kamera: `C` schaltet zwischen Ball Cam und Car Cam; das Auto bleibt in beiden Modi zentriert. Hindernisse zwischen Kamera und Auto werden beim Rendern ausgeblendet, und die Kamera darf hinter/außerhalb der Arena stehen.

### Smartphone / Tablet

Auf Touch-Geraeten wird die Mobile-Steuerung automatisch aktiviert. Fuer die beste Sicht wird Querformat empfohlen, Hochformat bleibt aber spielbar.

- Linker 2D-Stick: hoch/runter = Gas/Bremse bzw. Luft-Pitch, links/rechts = Lenken bzw. Luft-Yaw
- `JUMP`: Sprung, gehaltene Sprunghoehe, Double-Jump und zusammen mit Stickrichtung Directional Flip/Dodge
- `BOOST`: Boost halten; funktioniert gleichzeitig mit Stick und Jump
- `DRIFT`: Handbremse/Powerslide fuer engere Kurven; kann gleichzeitig mit Stick und Gas verwendet werden
- `ROLL L / R`: Air Roll links/rechts
- `BALL / CAR`: Ball Cam und Car Cam wechseln
- `↻`: eigenes Auto resetten
- `⛶`: Vollbild im Match; kompatible Browser versuchen dabei Querformat zu sperren
- Bereits auf dem Start-/Namensbildschirm gibt es `VOLLBILD STARTEN`, damit das Spiel vor dem Match per echtem User-Tap in den Browser-Fullscreen wechseln kann

Das HUD beruecksichtigt Notch/Home-Bar per Safe-Area und verhindert Pull-to-Refresh/Browser-Gesten im Match. Mobilgeraete verwenden standardmaessig das Profil **NORMAL** mit Antialiasing, voller Arena-/Umgebungsqualitaet und 125–160 % Render-Skalierung; nur bei deutlich zu niedriger Framerate reduziert die adaptive Aufloesung bis minimal 90 %. Browser ohne normale Fullscreen-API erhalten einen Hinweis auf den bereits vorbereiteten Home-Screen/Standalone-Modus. Mit `?mobile=1` kann die Touch-Steuerung zum Testen erzwungen, mit `?mobile=0` deaktiviert werden.

## Grafikprofile

Direkt auf dem Startbildschirm kann die Grafikqualitaet gewaehlt werden. Die Auswahl wird lokal gespeichert und betrifft nur den jeweiligen Browser:

- **NORMAL**: bisherige volle Standarddarstellung; auf Smartphone/Tablet automatisch der empfohlene Modus.
- **ULTRA LOW**: stark reduzierte Renderauflosung und Details fuer schwache PCs/VMs. Weiterhin kompatibel mit `?perf=ultra` bzw. `?perf=ultra-low`.
- **ULTRA HIGH**: auf Desktop und leistungsstarken Smartphones waehlbar. Desktop startet bei 95 % Render-Skalierung und regelt adaptiv zwischen 68 und 108 %; Mobile startet bei 80 % und regelt zwischen 55 und 92 %. Der Modus verwendet dichte alpha-getestete 3D-Grasbueschel, prozedurale hochaufgeloeste Turf-/Wandtexturen, Relief fuer die Wandplatten, detaillierte Felgen, matte Materialien sowie gestaffelt aktualisierte 2048-/1024-Schatten. Bloom, PMREM-Reflexionen und eine zweite Fullscreen-Renderpass-Kette bleiben bewusst deaktiviert.

Direktlinks fuer Tests:

```text
?perf=ultra-low
?perf=ultra-high
```

Auf Smartphones bleibt **NORMAL** die empfohlene Einstellung. **ULTRA HIGH** ist aber ebenfalls auswählbar und verwendet dort konservativere Aufloesungs-, Schatten- und Graswerte.

### Finale Arena-/Performance-Abstimmung

- Tribuen und Publikum sind entfernt; Skyline, Haeuser, Baeume und Tageshimmel bleiben erhalten.
- Die Boden-Wand-Rundung ist deutlich kuerzer, waehrend die Glasflaeche frueher beginnt.
- Feldwand und Tortunnel werden ueber einen echten gerundeten Tormund verbunden. Ein schmaler Team-Akzent folgt genau dieser Kurve und kaschiert keine Luecke, sondern markiert die gemeinsame Geometrie.
- Der Torinnenraum besitzt abgerundete Boden-, Seiten-, Rueckwand- und Deckenuebergaenge. Die gleichen Radien gelten fuer Rendering, Rapier, Client-Prediction und Go-Server.
- Ultra High erzeugt Gras ueber wenige gekreuzte Alpha-Karten mit vielen gemalten Halmen pro Karte. Zwölf sichtbarkeitsgepruefte Instanz-Chunks liefern deutlich mehr Gras bei weit weniger Geometrie als einzelne modellierte Halme.
- Die dunklen Arena- und Torwaende besitzen im Ultra-High-Modus eine prozedurale Platten-/Steinstruktur plus Bump-Relief, waehrend das Glas neutraler und weniger milchig bleibt.
- Supersampling, Lichtstaerke und Reflexionen wurden reduziert. Die gewonnene GPU-Zeit fliesst in sichtbare Oberflaechendetails statt in ueberhelles Post-Processing.

## Qualitaetschecks

```bash
npm run build
npm run test:js
go test ./...
go test -race ./...
```

Die Tests decken Fahrbewegung, 70/100-km/h-Speed-Caps und erhaltenes Boost-Momentum, Boostverbrauch, Boost-Pickups/Respawn, Sprung-Lockout, Boden-Tunneling, die Fahrt vom Boden auf senkrechtes Glas, den Ball-Uebergang an der Boden/Wand-Naht ohne Tunneling, beide farbigen Tore, Spielstand, Namen, Auto-Ball-Impuls, Input-Reihenfolge, das exakte Binaerprotokoll und einen echten HTTP/WebSocket-Verbindungsaufbau ab.


### Mobile Bedienung
- Browser-Zoom, Doppeltipp-Zoom und Pinch-Gesten sind während des Spiels deaktiviert.
- UI-Texte und Touch-Buttons sind nicht auswählbar; das Namensfeld bleibt normal editierbar.
- Der linke Joystick besitzt eine große unsichtbare Touch-Fläche und nur einen kleinen transparenten Thumb-Punkt.
- Die seitliche Lenk-Deadzone ist größer als die Gas/Brems-Deadzone für feinere Smartphone-Lenkung.

## Visual Palette v1.10.1

- Satterer, kontrastreicher Turf mit grossen Mow-Blocks und dezenten Blau/Orange-Zonen direkt in einer einzelnen Canvas-Textur.
- Dunklere Graphit-Waende, neutraleres Glas und kraeftigere Team-Akzente fuer einen lebendigeren Arena-Look.
- AgX-Tonemapping und neu abgestimmtes Tageslicht fuer mehr Farbtiefe ohne zusaetzliche Post-Processing-Kosten.
- Ultra-High-3D-Gras nutzt dunklere, sattere Halme und bleibt weiterhin instanziert/culling-optimiert.


## Goal Mouth Frame Fix v1.10.2

- Die vier full-height Arena-Stuetzen direkt an den Toroeffnungen wurden entfernt.
- Dadurch ragen keine dunklen Pfosten mehr ueber die obere Tor-Rundung hinaus.
- Der farbige, abgerundete Torrahmen definiert die Toroeffnung jetzt allein und endet sauber an der oberen Kurve.
- Tor-Physics, fahrbare Innenrundungen und Glasflaechen bleiben unveraendert.


## Goal Header Grid Fix v1.10.3

- Der Glasbereich direkt oberhalb jeder Toroeffnung ist jetzt explizit als Goal-Header markiert.
- In diesem Bereich werden keine vertikalen Stahl-/Gitterstreben mehr erzeugt; horizontale Kaefiglinien bleiben erhalten.
- Dadurch kann kein dunkler Glasrahmen mehr perspektivisch wie eine Verlaengerung des Torpfostens ueber den oberen Torbogen hinaus wirken.
- Der abgerundete Torrahmen, Torinnenraum und saemtliche Physics bleiben unveraendert.


## Rocket-Style Dodge Rework v1.10.4

- Jeder gerichtete zweite Sprung fuehrt genau **eine** 360-Grad-Dodge-Rotation aus und stoppt danach automatisch; Gegensteuern zum Abfangen ist nicht mehr noetig.
- `W` = Frontflip, `S` = Backflip, `A` = Barrel-Roll nach links, `D` = Barrel-Roll nach rechts. Diagonale Eingaben kombinieren beide Achsen.
- Jeder Dodge gibt einen echten Bewegungsimpuls in dieselbe Richtung: links/rechts verschiebt das Auto seitlich, ohne die Fahrzeugnase vorher dorthin zu drehen; vorne/hinten und diagonale Dodges funktionieren entsprechend.
- Die Richtungstaste, die den Dodge gestartet hat, wird bis zum Loslassen nicht sofort wieder als Air-Control interpretiert. Dadurch entsteht nach dem einen Flip kein ungewolltes Nachdrehen, obwohl die Taste noch gehalten wird. Nach Loslassen/Re-Druecken ist normale Luftkontrolle sofort wieder aktiv.
- Server, Multiplayer-Client-Prediction und lokaler Rapier-Modus verwenden dieselbe Dodge-Achse, Rotation, Impulsstaerke und Eingabe-Latch-Logik.
- Neue Regressionstests pruefen Front-/Back-/Side-/Diagonalimpulse, die korrekte Links-/Rechts-Rollrichtung, automatisches Stoppen nach einer Umdrehung und die Rueckkehr der Air-Control nach dem Loslassen.


## Variable Jump + Powerslide v1.10.5

- Die erste Sprunghoehe skaliert jetzt direkt mit der **durchgehenden Haltezeit von Space/JUMP**: kurzer Tap = niedriger Sprung, mittleres Halten = mittlere Hoehe, bis 0,20 s halten = maximaler First-Jump-Lift.
- Der zusaetzliche Jump-Lift kann nach dem Loslassen nicht innerhalb desselben Sprungs erneut aktiviert werden. Dadurch bleibt der zweite Tastendruck sauber fuer Double-Jump bzw. Directional Dodge reserviert.
- Der Grundimpuls des ersten Sprungs wurde reduziert und die Hold-Kraft verstaerkt, damit die Hoehenunterschiede beim Timing deutlich spürbar sind und Flips gezielt auf unterschiedlichen Hoehen gestartet werden koennen.
- `STRG` / `CTRL` aktiviert am Boden Drift/Handbremse: weniger Seitenhaftung plus hoehere Lenkrate und schnellere Lenkreaktion erzeugen einen kontrollierten Powerslide statt eines einfachen Steering-Buffs.
- Der Drift ist ein eigener gehaltener Multiplayer-Input und wird zwischen Browser, Prediction und Go-Server synchronisiert. Das neue 8-Byte-Inputpaket bleibt serverseitig kompatibel zu alten 7-Byte-Paketen.
- Auf Smartphone/Tablet gibt es einen eigenen `DRIFT`-Button neben den Air-Roll-Tasten.
- Neue Regressionstests pruefen drei klar getrennte First-Jump-Hoehen, das irreversible Ende des Hold-Lifts nach dem Loslassen sowie engere Drift-Kurven mit erhoehtem Seitenschlupf.

## Fair Kickoff Countdown v1.10.6

- Spieler 2 startet automatisch ein neues faires 1v1.
- Spieler 4 startet automatisch ein neues faires 2v2.
- Bei beiden Ereignissen werden Spielstand, Autos, Ball und Boost-Pads zurückgesetzt.
- Danach bleiben alle fuer einen sichtbaren 3-2-1-Countdown auf den Kickoff-Spawns gesperrt.
- Auf `LOS!` wird die Physik gleichzeitig fuer alle freigegeben.
- Gehaltenes Gas/Boost darf waehrend des Countdowns vorbereitet werden; Jump-/Reset-Klicks werden nicht gepuffert.
- Spieler 3 startet keinen Reset und kann direkt in das laufende Match einsteigen.


## Goal Replay + Unanimous Skip v1.10.7

Nach jedem Tor startet serverweit eine Wiederholung aus der Ball-Cam-Perspektive des letzten Spielers, der den Ball vor dem Tor berührt hat. Jeder Client hält dafür nur einen kleinen Ringpuffer der letzten fünf Sekunden autoritativer Netzwerk-Snapshots; es wird kein Video übertragen. Die Replay-Frames werden clientseitig interpoliert und mit der normalen 3D-Szene gerendert.

Während der Wiederholung steht das Live-Match serverseitig still. Jeder Spieler, der beim Tor bereits in der Lobby war, bekommt einen `REPLAY ÜBERSPRINGEN`-Button. Der Server zählt jeden Skip genau einmal und beendet die Wiederholung sofort, sobald alle Replay-Teilnehmer geskippt haben. Verlässt jemand die Lobby, wird die notwendige Stimmenzahl entsprechend reduziert. Spieler, die erst während eines laufenden Replays beitreten, warten auf den nächsten Kickoff und blockieren die Abstimmung nicht.

Nach Replay-Ende werden Ball, Autos und Boost-Pads auf Kickoff zurückgesetzt, der aktuelle Spielstand bleibt bestehen und der bekannte 3-Sekunden-Countdown startet. Falls während des Replays durch einen Join gerade ein neues faires 1v1/2v2 entstanden ist, greift weiterhin die bestehende Regel und der Match-Spielstand wird für dieses neue Duell zurückgesetzt.
