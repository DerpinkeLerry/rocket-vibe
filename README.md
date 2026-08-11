# Rocket Vibe Starter v0.6 - LAN + Railway Online

Three.js + Rapier Arena-Prototyp mit zwei Autos, Ball und 2-Spieler-Multiplayer.
Die Optik ist Rocket-League-inspiriert, verwendet aber keine gerippten Original-Assets.

## Was in v0.6 neu ist

- fuer Railway Production Hosting vorbereitet
- Vite wird beim Deploy einmal zu `dist/` gebaut
- eigener schlanker Node-Production-Server serviert die fertigen Dateien
- WebSocket und Webseite laufen auf demselben Port
- Railway `PORT` wird automatisch verwendet
- Server bindet an `0.0.0.0`
- `/health` Endpoint fuer Railway Healthchecks
- `railway.json` mit Build-, Start- und Healthcheck-Konfiguration
- HTTPS-Seite verbindet automatisch per `wss://`
- sauberes Herunterfahren bei `SIGTERM`
- LAN-Modus bleibt weiterhin erhalten

## Railway deployen

### 1. Zu GitHub pushen

```bash
git add .
git commit -m "Prepare Rocket Vibe for Railway"
git push
```

### 2. Railway mit GitHub verbinden

Auf Railway ein neues Projekt erstellen und **Deploy from GitHub Repo** waehlen.
Danach dieses Repository auswaehlen.

Die `railway.json` im Repository setzt automatisch:

- Build: `npm run build`
- Start: `npm start`
- Healthcheck: `/health`

### 3. Oeffentliche Domain erzeugen

Im Railway Service:

`Settings -> Networking -> Public Networking -> Generate Domain`

Danach erhaeltst du eine HTTPS-Adresse wie:

```text
https://dein-projekt.up.railway.app
```

### 4. Zu zweit spielen

1. Du oeffnest die Railway-Adresse zuerst -> Spieler 1 / Host.
2. Dein Freund oeffnet dieselbe Adresse danach -> Spieler 2.
3. Es ist keine Portweiterleitung und kein gemeinsames WLAN mehr noetig.

## Sehr wichtig: nur eine Railway-Replica

Das aktuelle Matchmaking und die Verbindung der zwei Spieler liegen im Arbeitsspeicher eines Node-Prozesses.
Darum den Service aktuell **nicht horizontal auf mehrere Replicas skalieren**. Mehrere Instanzen braeuchten spaeter z. B. Redis bzw. eine andere gemeinsame Session-/Match-Architektur.

## Production lokal testen

```bash
npm install
npm run build
npm start
```

Danach:

```text
http://localhost:3000
```

Zwei Browser-Tabs simulieren Spieler 1 und Spieler 2.

## LAN weiterhin benutzen

```bash
npm install
npm run lan
```

Der Host bekommt lokale LAN-Adressen im Terminal angezeigt. Erster Browser = Spieler 1, zweiter Browser = Spieler 2.

## Offline-Modus

```bash
npm run dev
```

## Steuerung

- `W / S`: Boden Gas/Rueckwaerts, Luft Pitch
- `A / D`: Boden Lenken, Luft Yaw
- `Q / E`: Air Roll
- `Shift`: Boost
- `Space`: Jump / Double Jump
- `R`: eigenes Auto zuruecksetzen
- `B`: Ball zuruecksetzen

## Netzwerkmodell

Die erste verbundene Spielinstanz ist aktuell der autoritative Host fuer Autos und Ball.
Spieler 2 sendet Inputs an den Host und empfaengt geglaettete Snapshots. Der Railway-Node-Server vermittelt die WebSocket-Nachrichten.

Das ist fuer einen privaten 2-Spieler-Prototypen einfach und performant. Fuer spaeteres kompetitives Online-Gameplay sollte die eigentliche Physik auf einen dedizierten autoritativen Gameserver verschoben werden.

## Performance

- Physik 60 Hz
- Game-State 30 Hz
- Rendering maximal 60 FPS
- Pixel Ratio max. 0.9
- Antialiasing aus
- keine Shadowmaps
- einfache Fake-Shadows
- vereinfachtes Stadion und Instancing

## Dependencies

- Three.js 0.185.1
- Rapier 0.19.3
- Vite 8.1.5
- ws 8.18.3

`node_modules` und `dist` gehoeren nicht ins Git-Repository.
