# Rocket Vibe 1.0 - Low Latency Multiplayer

Three.js + Rapier Prototyp fuer bis zu vier Spieler. Railway ist autoritativ fuer Autos, Ball und Kollisionen; das eigene Auto wird im Browser sofort vorhergesagt und danach sanft mit dem Server abgeglichen.

## Start lokal

```bash
npm install
npm run dev
```

## 4-Spieler LAN

```bash
npm install
npm run lan
```

Der Host oeffnet `http://localhost:5173`, weitere Spieler die im Terminal angezeigte LAN-IP.

## Railway

```bash
npm run build
npm start
```

`railway.json` setzt den Production-Service auf genau eine EU-West-Replica. Alle Spieler verwenden dieselbe Railway-Domain.

## Low-Latency Netcode

- 120 Hz serverseitige Rapier-Simulation
- 60 Hz Server-Snapshots
- Client-Side Prediction fuer das eigene Auto
- sanfte Server-Reconciliation statt Roundtrip-Warten
- Extrapolation fuer andere Spieler und den Ball
- kompakte binaere WebSocket-Pakete
- Eingaben werden bei Keydown/Keyup sofort gesendet
- Safety-Heartbeat fuer gehaltene Tasten
- WebSocket-Kompression deaktiviert
- Snapshot-Backpressure: alte States werden nicht endlos gequeued
- Ping-Anzeige im HUD
- maximal 4 Spieler, 1 Server-Replica

## Steuerung

- W / S: Boden Gas/Rueckwaerts, Luft Pitch
- A / D: Boden Lenken, Luft Yaw
- Q / E: Air Roll
- Shift: Boost
- Space: Jump / Double Jump
- R: eigenes Auto resetten
- B: Ball resetten

## Deploy

```bash
git add .
git commit -m "Low latency netcode"
git push
```

Nach dem Railway-Deploy alle Browser mit `Ctrl+F5` neu laden. Im Railway-Dashboard sollte die aktive Region `EU West` sein und nur eine Replica laufen.
