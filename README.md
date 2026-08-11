# Rocket Vibe 1.1 - Permanent Ball Cam

Three.js + Rapier Prototyp fuer bis zu vier Spieler. Railway ist autoritativ fuer Autos, Ball und Kollisionen; das eigene Auto wird im Browser sofort vorhergesagt und danach sanft mit dem Server abgeglichen.

## Neu in 1.1

- permanente Ball Camera ohne Toggle
- Kamera orbitiert automatisch um das eigene Auto, damit der Ball im Blick bleibt
- Ball bleibt permanent das Look-Target
- stabiler Welt-Horizont auch bei Aerials / Air Roll
- Schutz gegen hektisches Kamera-Flattern, wenn der Ball direkt ueber dem Auto ist
- dynamischer Kameraabstand bei Tempo und grosser Ball-Distanz
- bestehender Low-Latency-Netcode und 4-Spieler-Multiplayer bleiben erhalten

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
- Kamera: permanent Ball Cam, kein Toggle

## Deploy

```bash
git add .
git commit -m "Add permanent ball camera"
git push
```

Nach dem Railway-Deploy alle Browser mit `Ctrl+F5` neu laden.
