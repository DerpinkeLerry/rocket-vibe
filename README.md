# Rocket Vibe Starter v0.7 - Online Input Fix

Three.js + Rapier Arena-Prototyp mit zwei Autos, Ball, LAN und Railway-Online-Multiplayer.
Die Optik ist Rocket-League-inspiriert und verwendet keine gerippten Original-Assets.

## Was in v0.7 neu ist

- Fix fuer die Steuerung von Spieler 2 / blauem Auto
- Keydown und Keyup von Spieler 2 werden sofort per WebSocket gesendet
- zusaetzlicher Input-Heartbeat mit 20 Hz als Sicherheitsnetz
- jedes Input-Paket bekommt eine Sequenznummer
- Server bestaetigt Input-Pakete an Spieler 2
- Host behandelt eintreffenden Input automatisch als aktiven Spieler 2
- Join-Race kann die Steuerung nicht mehr deaktivieren
- beim ersten bestaetigten Paket zeigt Spieler 2 `STEUERUNG VERBUNDEN`
- Railway-Log meldet einmal `Erste Eingabe von Spieler 2 empfangen.`

## Railway aktualisieren

Die neuen Dateien in dein bestehendes GitHub-Repo kopieren und dann:

```bash
git add .
git commit -m "Fix player 2 controls"
git push
```

Railway sollte danach automatisch neu deployen.

Die bestehende Railway-Konfiguration bleibt gleich. Falls du `PORT=3000` und Target Port `3000` gesetzt hast, kannst du das so lassen.

## Zu zweit spielen

1. Spieler 1 oeffnet die Railway-Domain zuerst.
2. Spieler 2 oeffnet dieselbe Domain danach.
3. Spieler 2 sollte im HUD nach dem Verbinden `SPIELER 2 · STEUERUNG VERBUNDEN` sehen.
4. In den Railway Deploy Logs erscheint beim ersten Client-Paket einmal `Erste Eingabe von Spieler 2 empfangen.`.

Hinweis: Zwei Tabs auf demselben PC sind nur ein Verbindungstest. Fuer echtes gleichzeitiges Tastaturspielen sind zwei getrennte Rechner sinnvoll, weil Browser Hintergrund-Tabs drosseln und nur der aktive Tab Tastatureingaben bekommt.

## Production lokal testen

```bash
npm install
npm run build
npm start
```

Danach `http://localhost:3000` oeffnen.

## LAN weiterhin benutzen

```bash
npm install
npm run lan
```

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

Die erste verbundene Spielinstanz ist derzeit der autoritative Host fuer Autos und Ball. Spieler 2 sendet seine Eingaben per WebSocket an den Railway-Server; dieser leitet sie an Spieler 1 weiter. Spieler 1 simuliert das blaue Auto und sendet den gemeinsamen Spielzustand zurueck.

v0.7 macht diesen Input-Pfad robuster. Fuer eine spaetere kompetitive Version sollte die gesamte Spielphysik auf einen dedizierten autoritativen Gameserver verschoben werden, damit das Match nicht vom Browser von Spieler 1 abhaengt.

## Performance

- Physik 60 Hz
- Game-State 30 Hz
- Spieler-2-Input: sofort bei Tastenaenderung + 20-Hz-Heartbeat
- Rendering maximal 60 FPS
- Pixel Ratio max. 0.9
- Antialiasing aus
- keine Shadowmaps
- vereinfachtes Stadion und Instancing

## Dependencies

- Three.js 0.185.1
- Rapier 0.19.3
- Vite 8.1.5
- ws 8.18.3

`node_modules` und `dist` gehoeren nicht ins Git-Repository.
