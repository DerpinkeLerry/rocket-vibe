# Rocket Vibe 0.8 - 4 Player Server Physics

Three.js + Rapier Prototyp fuer ein Rocket-League-inspiriertes Browser-Spiel.

## Neu in 0.8

Die Multiplayer-Architektur wurde komplett ersetzt:

- bis zu **4 Spieler** gleichzeitig
- Spieler 1 ist **nicht mehr Browser-Host**
- jeder Spieler sendet seine Eingaben direkt an den Node/Railway-Server
- der Server simuliert zentral **alle 4 Autos + Ball** mit Rapier
- der Server verteilt 30 State-Snapshots pro Sekunde an alle Browser
- alle vier Spieler benutzen exakt denselben Input-Code
- Browser rechnen im Online-Modus keine Match-Physik mehr, was die Client-Performance verbessert
- vier feste Spawn-Slots (2 pro Spielfeldseite)
- Railway, echtes LAN und Offline-Modus bleiben vorhanden

## Steuerung

| Taste | Boden | Luft |
| --- | --- | --- |
| W / S | Gas / Rueckwaerts | Pitch |
| A / D | Lenken | Yaw |
| Q / E | - | Air Roll |
| Shift | Boost | Boost |
| Space | Jump / Double Jump | Jump / Double Jump |
| R | eigenes Auto resetten | eigenes Auto resetten |
| B | Ball resetten | Ball resetten |

## Railway

Die Dateien `railway.json` und `server/production-server.mjs` sind vorbereitet.

```bash
npm install
npm run build
npm start
```

Railway verwendet `process.env.PORT`. Alle Spieler oeffnen dieselbe Railway-Domain. Die ersten vier Verbindungen werden automatisch Spieler 1 bis 4.

Healthcheck:

```text
/health
```

Beispielantwort:

```json
{"ok":true,"service":"rocket-vibe","version":"0.8.0","players":2}
```

Auf Railway fuer diese Version **1 Replica** verwenden, weil der Match-Zustand im RAM des Node-Prozesses liegt.

## LAN

```bash
npm install
npm run lan
```

Der Host oeffnet `http://localhost:5173`. Andere Rechner im selben Netzwerk oeffnen die im Terminal ausgegebene IP, z. B. `http://192.168.178.42:5173`.

## Offline

```bash
npm run dev
```

Im Offline-Modus wird weiterhin lokal im Browser simuliert.

## Architektur

```text
Spieler 1 Browser --input--\
Spieler 2 Browser --input---+--> Node/Railway Server --> Rapier Physics --> Snapshots --> alle Browser
Spieler 3 Browser --input---+
Spieler 4 Browser --input--/
```

Damit gibt es keinen Sonderfall mehr, bei dem nur Spieler 1 sein Auto lokal kontrolliert. Jeder Spieler hat denselben Netzwerkpfad zum autoritativen Server.
