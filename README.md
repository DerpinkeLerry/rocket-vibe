# Rocket Vibe Starter v0.4

Lokaler Three.js + Rapier Prototype mit Auto, Arena und Ball. Die Optik ist Rocket-League-inspiriert, verwendet aber keine gerippten Original-Assets.

## Enthalten

- großes Stadion: 110 x 160 Einheiten
- echte Toröffnungen mit Goal-Tunneln
- Fennec-inspiriertes Blockout-Auto
- Rapier-Fahrphysik
- Ball mit Sphere-Collider, CCD, Bounce, Spin und Speed-Caps
- prozedurale Sci-Fi-Balltextur (keine externe Texturdatei)
- Boden: WASD fährt/lenkt
- Luft: WASD Pitch/Yaw, Q/E Air Roll
- Jump + Double Jump
- Boost
- Car Reset und Ball Reset

## Performance-Modus (Standard)

v0.4 ist bewusst auf schwächere PCs ausgelegt:

- Physik: 60 Hz statt 120 Hz
- Rendering maximal 60 FPS
- Pixel Ratio auf 0.9 begrenzt
- Antialiasing deaktiviert
- keine echten Shadowmaps
- Fake-Shadows für Auto und Ball
- keine dynamische Boost-Point-Light
- vereinfachte Stadion-Tribünen
- Instancing für wiederholte Deko
- vereinfachte Materialien
- weniger temporäre JS-Objekte pro Frame
- maximal 4 Physics-Catch-up-Schritte, damit schwache PCs nicht in eine Freeze-Spirale geraten

Wenn es trotzdem ruckelt, kannst du in `src/game/Game.js` die Pixel Ratio von `0.9` auf `0.75` setzen.

## Steuerung

- `W / S`: Boden Gas/Rückwärts, Luft Pitch
- `A / D`: Boden Lenken, Luft Yaw
- `Q / E`: Air Roll
- `Shift`: Boost
- `Space`: Jump / Double Jump
- `R`: Auto zurücksetzen
- `B`: Ball zurücksetzen

## Starten

```bash
npm install
npm run dev
```

Dann die von Vite angezeigte localhost-Adresse im Browser öffnen.

Windows alternativ: `start-windows.bat`

macOS/Linux alternativ: `./start-mac-linux.sh`

## Hinweis

Die Dependencies sind weiterhin gepinnt auf Three.js `0.185.1`, Rapier `0.19.3` und Vite `8.1.5`. Das Projekt enthält bewusst keine `node_modules`, damit das ZIP klein bleibt.
