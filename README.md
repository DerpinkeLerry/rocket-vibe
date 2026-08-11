# Rocket Vibe 1.2 - Ultra / VM Performance

Three.js Multiplayer-Prototyp fuer bis zu vier Spieler. Railway bleibt autoritativ fuer Autos, Ball und Kollisionen. Das eigene Auto wird lokal vorhergesagt, damit Eingaben nicht auf den Netzwerk-Roundtrip warten.

## Neu in 1.2

Diese Version hat einen clientseitigen **Ultra / VM Modus**. Dadurch kann ein schwacher oder virtualisierter Rechner deutlich weniger Render- und CPU-Arbeit machen, ohne dass andere Spieler ihre Grafik reduzieren muessen.

- `?perf=ultra` aktiviert Ultra / VM nur fuer diesen Browser
- `F2` schaltet Normal <-> Ultra / VM um und laedt die Seite neu
- Online-Client laedt **kein Rapier/WASM mehr**; echte Physik laeuft nur auf Railway
- sehr einfache unbeleuchtete Materialien im Ultra-Modus
- stark vereinfachte Autos und Ball-Geometrie
- Tribuenen, Sky-Dome, Zusatzlichter, Fake-Shadows und Tone-Mapping entfallen im Ultra-Modus
- interne Render-Aufloesung startet bei ca. 48 % und passt sich automatisch zwischen 30-56 % an
- Ziel bleibt 60 FPS; es wird nicht absichtlich auf 30 FPS begrenzt
- HUD wird im Ultra-Modus nur wenige Male pro Sekunde aktualisiert
- Client-Prediction nutzt im Ultra-Modus 60 statt 120 Substeps/s
- dieselbe Server-Snapshot wird fuer das eigene Auto nur noch **einmal** reconciled statt erneut pro Render-Frame
- Server-Korrekturen sind im Ultra-Modus sanfter, damit Prediction weniger wie Input-Drag wirkt
- permanente Ball Cam bleibt erhalten
- 120 Hz Server-Physics / 60 Hz Snapshots bleiben erhalten

## Fuer eine virtuelle Sitzung

Normale Railway-URL:

```text
https://DEINE-DOMAIN.up.railway.app
```

Deine VM-Version:

```text
https://DEINE-DOMAIN.up.railway.app/?perf=ultra
```

Dein Kollege kann gleichzeitig die normale URL ohne `?perf=ultra` benutzen.

Im HUD stehen jetzt FPS und interne Render-Skalierung, z. B. `FPS 60 - Render 42%`.

## Steuerung

- W / S: Boden Gas/Rueckwaerts, Luft Pitch
- A / D: Boden Lenken, Luft Yaw
- Q / E: Air Roll
- Shift: Boost
- Space: Jump / Double Jump
- R: eigenes Auto resetten
- B: Ball resetten
- F2: Normal / Ultra-VM umschalten
- Kamera: permanent Ball Cam

## Lokal

```bash
npm install
npm run dev
```

## LAN

```bash
npm install
npm run lan
```

## Railway

```bash
npm run build
npm start
```

`railway.json` behaelt genau eine EU-West-Replica. Alle Spieler verwenden dieselbe Railway-Domain.

## Deploy

```bash
git add .
git commit -m "Add ultra VM performance mode"
git push
```

Nach dem Railway-Deploy einmal `Ctrl+F5`.
