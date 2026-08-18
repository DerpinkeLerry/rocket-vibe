# Rocket Vibe – RLBot Physics Reference Rework

## RLBot-Referenzphysik

- Die gesamte Simulation verwendet jetzt **100 Unreal Units = 1 Meter** und läuft serverseitig, offline und in der Client-Prediction mit **120 Hz**.
- Arena, Eckenradius, Tor, alle 34 Boost-Pads, Kickoff- und Demo-Spawns verwenden die veröffentlichten Soccar-Abmessungen und Koordinaten; die vier harten 45°-Ecken sind als bewusster Komfort-Override zu glatten Viertelkreisen abgerundet.
- Gas nutzt die gemessene stückweise Beschleunigungskurve; Bremsen, Ausrollen, Boost, Supersonic-Schwelle und die geschwindigkeitsabhängige Lenkkurve verwenden die RLBot-Werte.
- Sprungimpuls, 0,2-s-Hold-Kraft, Sticky Force, Double-Jump-Fenster und Luftrotation sind mit dem RLBot-Jump-Modell abgestimmt.
- Ballradius/-masse, Ruhehöhe, Restitution, Linear-Drag sowie lineare und angulare Caps sind Referenzwerte. Auto-/Ball-Impulse berücksichtigen beide Massen.
- Für bessere Lesbarkeit sind Auto und Ball samt Collider einheitlich auf **125 %** skaliert; Massen, Kräfte, Tempo- und Reaktionswerte bleiben unverändert.
- Zentrale Referenz: https://wiki.rlbot.org/v4/botmaking/useful-game-values/; Sprungdetails: https://wiki.rlbot.org/v4/botmaking/jumping-physics/.

Die RLBot-Seite weist selbst darauf hin, dass manche Details – besonders die exakte nicht-kreisförmige Bodenrampe, Reifen-/Gripmodell und Teile des Dodge-/Kontaktverhaltens – nicht vollständig veröffentlicht sind. Dafür verwendet das Spiel weiterhin deterministische, zwischen Go-Server, Browser-Prediction und lokalem Rapier-Modus abgestimmte Näherungen.

## v1.13.6

- Der mobile Ballkontakt-Assistent berechnet aus Auto- und Ballbewegung einen kurzen vorausberechneten Kontaktkorridor. Im erreichbaren Nahbereich korrigiert er kleine Lenkfehler sanft, lässt bewusste Gegenlenk- oder Volleinschlag-Eingaben unangetastet und markiert den anvisierten Ballkontakt dezent im Bild. Ballphysik und Hitboxen bleiben identisch zu Desktop und Multiplayer-Server.
- Mobile Smart Drive entkoppelt präzises Lenken vom Gasgeben: Berühren fährt vorwärts, horizontales Ziehen lenkt und bewusstes Ziehen nach unten bremst oder fährt rückwärts. In der Luft wird derselbe Stick automatisch zu Pitch/Yaw; ein Wisch von Boost zu Jump ermöglicht beide Aktionen mit einem Finger. Ein elastischer Floating-Ursprung und direktes Zustandsfeedback reduzieren Fehlbewegungen auf kleinen Displays.
- Die Ball-Cam verwendet jetzt eine Zwei-Punkt-Komposition für Auto und Ball: Sie schaut bei hohen Bällen nach oben, hält das Auto dabei in einem sicheren unteren Bildbereich und hebt die Kamera selbst niemals an. Erst wenn beide Motive geometrisch nicht in den FOV passen, wird nur der Abstand minimal so weit erhöht wie nötig.
- Double-Jump-Flicks drehen nun mit **10,5 rad/s** und beenden eine volle Rotation in etwa **0,60 s**. Die Arena verwendet glatte Viertelkreis-Ecken in Rendering, Go-Server, Client-Prediction und lokaler Physik; ein weißes emissives Hexagon-LED-Raster schließt die Glasdecke visuell.
- Die Holzplanken des Hallenbodens sind nochmals verdichtet, kürzer und mit zusätzlichen Maserungs- und Knotendetails versehen. Boost-Pads und ihre Bodenringe verwenden nur noch **62 %** ihrer ursprünglichen Darstellungsgröße; die eng begrenzte **0,38-m-Pickup-Hilfe** fängt weiterhin knappe Vorbeifahrten ab.

- **MATCH VERLASSEN** führt jetzt direkt zurück zur Lobbyliste. Die bestehende Account- oder Gast-Sitzung wird automatisch fortgesetzt; nur bei einer tatsächlich abgelaufenen Sitzung erscheint wieder die Anmeldung.
- Alle Web- und Mobile-Screens respektieren jetzt die Hardware-**Safe-Area** von Notch und Dynamic Island, auch im Querformat. Das In-Game-Hauptmenü ist als kleines Popup auf nur zwei Aktionsreihen geschrumpft; ausschließlich der Kameraeditor öffnet eine größere, ebenfalls sicher begrenzte Fläche.
- Die komplette **Phone-Oberfläche** nutzt jetzt ein kompaktes Layout: Fahrzeug, Boost und Grafik liegen in horizontalen Auswahlleisten, Lobbies sind deutlich flacher, das Match-Menü öffnet als Bottom-Sheet und Kameraoptionen stehen in einem dichten Zweispaltenraster. Touch-Steuerung, Chat, Lade- und Accountscreen beanspruchen ebenfalls weniger Platz.
- Beim Einstieg kann jetzt **ALS GAST SPIELEN** gewählt werden. Gast-Sitzungen existieren nur temporär im Serverspeicher; Name, Auto, Boost, Grafik- und Kameraeinstellungen werden nicht dauerhaft gespeichert. Bei der Registrierung reicht ein einziges Passwortfeld.
- Die dunklen rechteckigen Streben auf den Glaswänden wurden durch große, versetzte **Hexagon-Glaslinien** ersetzt. Blau und Orange leuchten dezent in ihrer jeweiligen Spielfeldhälfte; das Muster liegt als wiederholbare transparente Textur auf nur zwei kombinierten Wandmeshes und verändert keine Collider.
- Online startet jetzt mit **Login oder Registrierung**, bevor Lobby-Daten oder der Match-WebSocket erreichbar sind. Accounts werden in der konfigurierbaren Serverdatei gespeichert; Passwörter stehen dort ausschließlich als zufällig gesalzene PBKDF2-SHA256-Hashes, niemals im Klartext.
- Touchgeräte besitzen oben rechts ein neues **Match-Menü** zum Weiterspielen, Verlassen des Matches und Bearbeiten der Kamera. Der alte kleine Vollbildknopf innerhalb der Touch-Steuerung wurde entfernt.
- Dasselbe Match-Menü ist auch in der Desktop-Webversion oben rechts verfügbar. „Match verlassen“ trennt den Socket direkt und navigiert zuverlässig zurück zur Account-/Lobby-Auswahl; das Web-Frontend verwendet außerdem das Rocket-Vibe-SVG als Favicon.
- Die mobilen Kameraeinstellungen umfassen Ball-/Car-Cam, FOV, Abstand, Höhe, Blickhöhe, drei Reaktionsgeschwindigkeiten, Tempo-Abstand/-Höhe, High-Ball Assist, dynamisches FOV und Sichtschutz. Änderungen lassen sich live testen, zurücksetzen und pro Account lokal speichern.
- Beim Beitritt bleibt jetzt eine eigene **Match-Ladesequenz** sichtbar, bis Verbindung/Physics, benoetigte 3D-Modelle, Arena-Objekte, Materialien und GPU-Shader bereit sind. Erst nach einem verdeckten Warm-up-Frame blendet die Sequenz ins Spiel.
- `ULTRA HIGH` laedt vor Matchbeginn nur die Premium-GLBs der tatsaechlich vorhandenen Fahrzeugtypen sowie im Normalmodus den Premium-Ball. Gleiche Modelle teilen weiterhin Template, Geometrie und Texturen; leere/unsichtbare Fahrzeugslots starten keine unnoetigen Downloads.
- `NORMAL` und `ULTRA LOW` ueberspringen die grossen Premium-Downloads und durchlaufen direkt den leichten Aufbaupfad. Schlaegt ein optionales GLB fehl, startet das Match kontrolliert mit dem vorhandenen prozeduralen Fallback.
- Die statische Arena fasst kompatible, opake Einzelmeshes jetzt automatisch in **raeumliche Render-Batches** zusammen. Materialien und Geometrie bleiben identisch; transparente Flaechen wie Glas, Glow und Labels werden bewusst nicht zusammengelegt, damit Tiefensortierung und Optik unveraendert bleiben.
- Das Batching arbeitet in 48-Meter-Zellen statt die komplette Map in ein einziges riesiges Mesh zu verwandeln. Dadurch sinken Draw Calls und Object-Traversal, waehrend Frustum-Culling weiterhin sinnvoll arbeiten kann.
- Die lokale Rapier-Arenaphysik nutzt fuer alle statischen Map-Collider jetzt **einen gemeinsamen Fixed Rigid Body**. Wand-, Rampen-, Dach-, Ring- und Netz-Collider bleiben einzeln und geometrisch unveraendert, aber hunderte redundante statische Rigid-Body-Objekte entfallen.
- Bestehendes Instancing fuer Stadionstreben, Glasgitter, Skyline, Baeume und Lampen bleibt erhalten und wird durch das neue Batching ergaenzt.
- Keine Gameplay-Werte, Basketball-Geometrie, Texturen, Beleuchtung oder High-Speed-Effekte wurden fuer diesen Performance-Pass reduziert.

## v1.13.5

- **ULTRA HIGH** bekommt dezente High-Speed-Immersion ab etwa **80 km/h**: die Kamera erweitert das FOV weich um maximal ca. 5 Grad statt mit einem harten Zoom zu springen.
- Bei hohem Tempo entstehen zwei kurze **leuchtende Fahrspuren** hinter dem lokalen Auto. Sie folgen dem echten Fahrweg, nutzen die aktuelle Boost-Farbe und werden durch den vorhandenen Bloom-Pass weich hervorgehoben.
- Kurze **Airflow-Streaks** ziehen am Fahrzeug vorbei, werden mit steigender Geschwindigkeit dichter und bleiben bewusst sparsam, damit die Sicht auf Ball und Gegner frei bleibt.
- Beim erstmaligen Ueberschreiten des schnellen Fahrbereichs gibt es einen sehr dezenten, kurz expandierenden **Speed-Pulse** hinter dem Auto. Ein Cooldown verhindert visuelles Flackern rund um den Grenzwert.
- Ein schwaches dynamisches **Aero-Licht** hinter dem Fahrzeug sowie minimal staerkerer Bloom und eine sehr kleine Exposure-Anhebung geben 100–120 km/h mehr Energie, ohne den normalen Arena-Look zu ueberstrahlen.
- Die Effekte sind ausschliesslich fuer **ULTRA HIGH** aktiv und werden waehrend Replay, Kickoff, Goal-Celebration und Demolition-Respawn automatisch heruntergefahren. Auf Mobile sind Partikeldichte, FOV-Gain und Lichtstaerke reduziert.

## v1.13.0

- Neue Lobbies koennen zwischen **NORMAL** und **BASKETBALL** waehlen. Basketball nutzt eine eigene Hardwood-Court-Grafik, zwei erhoehte Koerbe mit Ring, Backboard, Netz und Traeger sowie eine serverautoritative Hoop-Kollision und Treffererkennung von oben durch den Ring.
- Der Basketball-Ball besitzt eine eigene prozedurale orange Leder-/Noppen-Textur mit dunklen Naehten. Dafuer werden keine externen oder aus Rocket League kopierten Texturen verwendet.
- **Quick Chat** wurde auf 20 serverseitig validierte Phrasen erweitert. Desktop: `1` bis `4` fuer Favoriten, `Y` fuer die komplette Quick-Chat-Auswahl.
- **Text Chat** ist im Match verfuegbar. Desktop: `T` oeffnet die Texteingabe; Nachrichten werden serverseitig bereinigt, auf 160 Zeichen begrenzt und gegen Spam rate-limitiert.
- Auf Touchgeraeten ersetzt ein kompakter **CHAT**-Button den einzelnen Quick-Chat-Knopf. Er oeffnet ein mobiles Chat-Menue mit allen Quick Chats und einem separaten Text-Chat-Tab samt Bildschirmtastatur.
- Beim Oeffnen der Texteingabe wird Gameplay-Input neutralisiert, damit Tippen keine Fahr-/Sprungbefehle ausloest.
- Basketball und Normalmodus verwenden dieselbe bestehende Lobby-, Replay-, Score-, Demo- und 8-Spieler-Infrastruktur; benutzerdefinierte Physics-Mutatoren bleiben erhalten.

## v1.12.0

- Alle numerischen Lobby-Regeln und Physics-Mutatoren werden jetzt ueber **Schieberegler** eingestellt. Jeder Slider zeigt den aktuellen Wert sowie seinen minimalen und maximalen erlaubten Bereich direkt an.
- Lobbies koennen zwischen **1 und 8 Spielern** konfiguriert werden. Server-World, WebSocket-State-Protokoll, Client, Replays, Spawns und Teams unterstuetzen jetzt acht Slots; der Standard bleibt 4 Spieler.
- Das binaere State-Protokoll wurde auf Version 5 erweitert: acht Fahrzeugslots sowie volle Ground-/Demolition-Bitmasken. Der Browser kann waehrend eines Rolling Deploys weiterhin die alten Vier-Spieler-Pakete lesen.
- Deployment ist auf **Render.com** umgestellt: `render.yaml`, Docker-Web-Service, Frankfurt, `/health`, genau eine Instanz und `0.0.0.0:$PORT`. Railway-spezifische Dateien wurden entfernt.

## v1.11.5

- **ULTRA LOW** ist jetzt gezielt fuer virtuelle Maschinen bzw. Browser ohne echte GPU ausgelegt. Der 3D-Renderpfad ist auf 30 FPS begrenzt, waehrend Netzwerk, Input und Client-Prediction weiter unabhaengig davon laufen.
- Die interne Renderaufloesung startet bei 0,32x und kann bei Last bis 0,18x absinken. Die adaptive Messung zaehlt dafuer echte Renderframes statt nur `requestAnimationFrame`-Callbacks.
- Die Ultra-Low-Arena verwendet keine Holz-/Wandtexturen, kein Glas, keine Lichter, keinen Himmel und keine Aussendekoration mehr. Stattdessen wird ein flaches Spielfeld mit gebatchten Linien und einfachen Torrahmen gerendert; die autoritative Arena-Physik bleibt unveraendert.
- Alle 34 Boostpads werden in Ultra Low als **ein** statischer `InstancedMesh` gezeichnet. Rotation, Pulsieren und transparente Ringeffekte entfallen; Aktiv/Inaktiv aktualisiert nur noch die jeweilige Instanzmatrix.
- Ultra-Low-Autos bestehen nur noch aus zwei unbeleuchteten Box-Meshes; der Ball ist eine einzelne untexturierte Low-Poly-Kugel. Premium-Modelle, Schatten, Boost-Partikel und Explosionseffekte bleiben dort deaktiviert.
- Das Ultra-Low-HUD erstellt die 42 animierten Boostsegmente nicht mehr, blendet Glow/Sparks aus und deaktiviert CSS-Animationen, Blur-, Filter- und Shadow-Effekte im laufenden Spiel. NORMAL und ULTRA HIGH wurden nicht veraendert.

## v1.11.4

- Lobbies können direkt im Lobby-Browser gelöscht werden; dafür ist bewusst keine Besitzer-/Admin-Prüfung aktiv, sodass jeder Client jede Lobby löschen kann.
- Beim Löschen einer belegten Lobby werden die zugehörige autoritative Match-Instanz und alle verbundenen WebSocket-Clients sauber beendet.
- Vor dem Löschen gibt es eine Sicherheitsabfrage; die Lobby-Liste aktualisiert sich danach sofort.

## v1.11.3

- Fix: Online-Clients laden `Game.js` nicht mehr erst **nach** dem erfolgreichen Lobby-Join als separaten Dynamic-Import-Chunk. Dadurch kann ein zweiter Spieler nicht mehr bereits serverseitig verbunden sein und anschließend an `Importing a module script failed` hängen bleiben.
- `Arena.js` besitzt jetzt einen expliziten Runtime-Refresh für gecachte Geometriewerte. Dadurch bleiben lobby-spezifische Arena-Mutatoren korrekt, obwohl der Game-Code schon im Entry-Bundle steckt.
- Der Vite-Production-Build zielt nicht mehr auf `esnext`, sondern auf ES2019/Safari 13.1/iOS 13.4. Neuere Syntax wird damit für ältere/mobile Browser kompatibel heruntertranspiliert.

## v1.11.2

- Fix: Lobby-Erstellung wurde im Browser durch HTML-Number-Validation blockiert (km/h-Standardwerte passten nicht zu `step=1`).
- Speed-Felder verwenden jetzt `0.1 km/h` Schritte und akzeptieren die bestehenden Standardwerte.
- Die Erstellmaske validiert sichtbar und öffnet den betroffenen Physics-Bereich statt beim Submit scheinbar nichts zu tun.

## v1.11.1

- Hotfix: WebSocket protocol version is now defined centrally and shared by server + integration test, fixing the Docker build regression.

## v1.11.0

### Lobby-System

- Die Startseite ist jetzt ein echter **Lobby-Browser**: vorhandene Lobbies anzeigen, Spielerzahl/Regeln sehen und neue Lobbies erstellen. Name, Auto, Boost und Grafik werden bewusst erst nach der Lobby-Auswahl abgefragt.
- Jede Lobby besitzt eine **eigene autoritative Go-Match-/Physics-Instanz**. Regeln und Physik einer Chaos-Lobby beeinflussen daher keine anderen laufenden Matches.
- Lobby-Regeln umfassen Max-Spieler, Matchzeit, Scorelimit, Overtime, Kickoff-Countdown, Goal-Replay, Goal-Celebration, Auto-/Ball-Reset und Demolitions.
- Physics-Mutatoren decken Gravitation/Solver, Arena-Geometrie, Hitbox/Masse/Tempo, Antrieb/Boost/Grip, Aerial-/Jump-/Dodge-Werte, Ballphysik, Boostpad-Respawns und die komplette Demolition-Physik ab.
- Enthalten sind **Standard, Moonball, Pinball und Chaos** als Start-Presets; danach kann jeder Einzelwert weiter angepasst werden.
- Der Server sendet die final sanitisierten Lobby-Werte beim Join an den Browser. Client-Prediction, Ball/Hitbox und die prozedural erzeugte Arena verwenden damit dieselben Lobbywerte wie die Serverphysik.
- HUD zeigt Match-Uhr/Overtime und Matchende; konfigurierbare Replay-, Goal- und Demo-Zeiten werden im Client respektiert.

## v1.10.29

### Demolition rule tuning

- Demo-Schwelle liegt jetzt bei **90 km/h**: darunter kann kein Auto demolieren.
- Bei einem gegnerischen Kontakt wird zuerst die Geschwindigkeit beider Autos verglichen. Nur das **schnellere** Auto kann das langsamere demolieren; bei praktisch gleichem Tempo gibt es keine Demo.
- Die bestehende Fronttreffer-/Bewegungsrichtungs-Pruefung bleibt erhalten, damit ein schnelleres Auto nicht allein durch seitliches Streifen demoliert.
- **ULTRA HIGH** zeigt bei einer erfolgreichen Demo eine kurze kleine orange-goldene Partikelexplosion mit Ring, Flash und sehr kurzem lokalen Licht. NORMAL und ULTRA LOW erhalten keinen zusaetzlichen Effekt.
- Respawn-Vogelperspektive, Spawnwahl und 0,75-s-Respawn-Immunitaet bleiben unveraendert.

## v1.10.28

### Desktop respawn race fix

- Demolition control messages now carry their authoritative server tick.
- A stale pre-demolition snapshot can no longer close the PC spawn picker.
- Legacy-server fallback waits until a demolished snapshot was actually observed before treating `d=0` as a respawn.
- The selected spawn point is re-affirmed every 550 ms during the four-second selection window for extra queue resilience.


- Neues serverautoritaeres **Demolition-System**: Ein gegnerisches Auto wird nur bei einem echten Fronttreffer zerstoert, wenn der Angreifer mindestens 90 km/h schnell und zugleich schneller als das getroffene Auto ist. Seiten-/Hecktreffer, Teamkontakte und gleich schnelle Kontakte loesen keine Demo aus.
- Nach einer Demo verschwindet das zerstoerte Auto sofort aus der aktiven Physik und kann weder Ball, Autos noch Boost-Pads beeinflussen.
- Der betroffene Spieler bekommt fuer exakt **4 Sekunden eine Vogelperspektive ueber der eigenen Spielhaelfte** und drei klar markierte Respawn-Punkte: links, Mitte, rechts. Ohne Auswahl wird automatisch die Mitte verwendet.
- Desktop: Spawn mit `1 / 2 / 3` direkt waehlen oder mit `A/D` bzw. Pfeiltasten durchschalten. Mobile: die drei grossen Spawn-Buttons antippen. Die Auswahl wird sofort an den Server uebertragen.
- Nach Ablauf der vier Sekunden setzt ausschliesslich der Server das Auto am gewaehlten Punkt wieder ein, ausgerichtet Richtung Mittelfeld, mit 33 Boost und einer kurzen 0,75-s-Demo-Immunitaet gegen direkte Spawn-Ketten.
- Der Demolished-Zustand wird ohne groesseres Snapshot-Paket im oberen Nibble des bisherigen Ground-Bytes synchronisiert; alte Clients ignorieren diese Bits weiterhin.

## v1.10.26

- Reine A/D-Side-Dodges bzw. Barrel Rolls geben keinen zusaetzlichen Aufwaertsimpuls mehr. Vorhandene vertikale Geschwindigkeit aus dem ersten Sprung bleibt erhalten; der zweite Input fuegt nur den seitlichen Dodge-Impuls hinzu. Vorwaerts/Rueckwaerts-Dodges behalten den kleinen Dodge-Lift, Diagonalen skalieren ihn mit ihrem Vorwaertsanteil.
- Die Goal-Replay-Historie wurde von 5.0 auf 6.25 Sekunden erweitert und das Server-Replay von 5.5 auf 6.8 Sekunden verlaengert.
- Desktop-Replays zeigen jetzt auffaellig blinkend **PRESS SPACE TO SKIP**. Ein neuer Space-Shortcut sendet denselben einmaligen Skip-Vote wie der vorhandene Replay-Button; Mobile behaelt den Touch-Button.
- Server-Physics, lokale Rapier-Physics und Client-Prediction verwenden dieselbe Side-Dodge-Lift-Regel.

## v1.10.25

- Die gespiegelte Z-zu-Canvas-Abbildung der Feldgrafik ist korrigiert. Vor dem blauen Tor liegen wieder blaue Linien, vor dem orangenen Tor orangene; Boost-Pad-Locators und alle kuenftigen Feldgrafiken verwenden dieselbe logisch korrekte Weltkoordinate.
- Die gruene Turf-Oberflaeche wurde komplett durch eine prozedurale, hochaufgeloeste Smoked-Oak-/Hardwood-Flaeche ersetzt. Unterschiedliche Bretttoene, lange Maserungen, dezente Fugen und wenige weiche Aststellen sorgen fuer Variation ohne Pixelrauschen.
- Ultra High verwendet eine eigene Wood-Bump-Map mit feinen Brettfugen und breiten Maserungen sowie eine satinierte Materialantwort, damit Mond-/Stadionlicht sichtbar auf dem Holz arbeitet, ohne spiegelig zu wirken.
- Normal und Ultra Low verwenden dieselbe Holzsprache in abgestufter Aufloesung; das 3D-Gras bleibt weiterhin vollstaendig entfernt.
- Die vorhandenen sauberen Team-, Tor-, Boost- und Mittelfeldlinien bleiben als separates hochaufgeloestes Overlay erhalten und liegen unveraendert ueber der neuen Holzoberflaeche.

## v1.10.24

- Tore zaehlen jetzt erst, wenn der komplette Ball die Torlinie ueberquert hat. Ein Ball, der die Linie nur beruehrt oder noch teilweise ueber dem Spielfeld steht, loest keinen Treffer aus. Server und Offline-Modus verwenden dieselbe Whole-Ball-Regel.
- Die Kamera waehrend der Goal Explosion ist jetzt von der absichtlichen Auto-Rotation entkoppelt. Das Auto darf weiterhin sichtbar wegfliegen und taumeln, aber die Kamera bleibt world-up und behaelt einen stabilen horizontalen Blickwinkel statt mitzuwackeln.
- Mobile ULTRA HIGH rendert deutlich schaerfer: Start 1.28x, Mindestwert 0.96x und maximal 1.52x. Die adaptive Aufloesung reduziert auf High-End-Mobile ausserdem weniger aggressiv und greift erst bei deutlicheren FPS-Einbruechen ein.

## v1.10.23

- Das komplette Spielfeld-Design wurde neu geordnet: nur noch wenige klare, symmetrische Boost-/Rotationsrouten ohne das fruehere Liniennetz mit vielen Ueberschneidungen.
- Team-Torbereiche verwenden je einen grossen, sauberen Halbkreis plus eine dezente Innenkontur; kleine Chevrons, gestapelte Goal-Arcs und kreuzende Dekorlinien wurden entfernt.
- Feldmarkierungen werden in deutlich hoeherer Canvas-Aufloesung gerendert (bis 2048x3072 in Ultra High) und mit Mipmaps/Anisotropie gefiltert, damit Kurven und Linien aus der Fahrkamera wesentlich ruhiger und weniger pixelig wirken.
- Die Turf-Textur ist jetzt bewusst clean: breite weiche Maehbahnen, dezente Team-Endzonen und keine tausenden 1-Pixel-Grashalme/Wear-Sprenkel mehr.
- Das komplette geometrische 3D-Gras wurde aus Ultra High entfernt. Dadurch gibt es keine Gras-Instanzen, kein Distanz-Culling und keine zusaetzlichen Gras-Draw-Calls mehr.
- Ultra High behaelt nur ein sehr dezentes, guenstiges Turf-Relief; die eigentliche Oberflaeche bleibt flach und sauber lesbar.

## v1.10.22

- Smartphone-Quickchat sitzt jetzt klein oben rechts unter den Diagnosewerten statt mitten im Sichtfeld; maximal vier Zeilen bleiben gleichzeitig sichtbar.
- Aerial-Steuerung verwendet Rocket-artige Winkelgeschwindigkeits-Ziele: Ohne Pitch/Yaw/Roll-Input wird Restrotation schnell abgebremst, statt durch altes Drehmoment weiterzuspinnen.
- Pitch, Yaw und Air Roll bleiben voll analog steuerbar; Boost selbst veraendert die Fahrzeugausrichtung nicht. Dodge/Flips behalten weiterhin ihre exakt eine kontrollierte 360-Grad-Rotation.
- Server, Client-Prediction und lokaler Rapier-Modus nutzen dieselben Air-Control-Raten und Stabilisierungswerte.

## v1.10.21

- Fahrzeugauswahl auf **OCTANE, DOMINUS und FENNEC** reduziert; der McLaren samt GLB/Attribution ist entfernt.
- Desktop-Steuerungshilfe ist standardmaessig eingeklappt und wird ueber den kleinen Button **STEUERUNG** unten links geoeffnet.
- Oben rechts stehen nur noch **PING, FPS und SPIELERZAHL** ohne Panel-/Box-Hintergrund.
- Ball Cam besitzt einen High-Ball-Assist: bei hohen Baellen faehrt die Kamera weich nach oben und hinten und hebt den Blick an, damit Aerials direkt unter dem Ball lesbar bleiben.
- `ULTRA HIGH` verwendet eine permanente Abenddaemmerung mit Farbverlauf, statischen Sternen, Mond + Halo, Wolkenbaenken und aktivem kuehl/warmem Mehrlicht-Setup. Normal und Ultra Low behalten den hellen Tageslook.


Browser-Spiel fuer bis zu acht Spieler pro Lobby mit Three.js-Rendering, lokaler Client-Prediction und einem autoritativen Go-Server. Frontend und Server werden auf Render.com als **ein Docker-Web-Service** betrieben. Dadurch verwendet der Browser dieselbe HTTPS-Domain fuer Seite und WebSocket (`/lan`); eine separate Backend-URL oder CORS-Konfiguration ist nicht erforderlich.

## Architektur

- Der Browser sendet nur Eingaben, niemals vertrauenswuerdige Positionen.
- Go simuliert Autos, Ball, Schwerkraft und Kollisionen mit 120 Hz.
- Go sendet 60 binaere Snapshots pro Sekunde.
- Ein v5-Snapshot fuer acht Autos, Ball, Spielstand, Booststaende und Boost-Pad-Maske ist 496 Byte gross.
- Der eigene Browser sagt die lokale Bewegung voraus und korrigiert sanft zum Serverzustand.
- Andere Autos und der Ball werden zwischen Snapshots extrapoliert und geglaettet.
- Online wird im Browser kein Rapier/WASM geladen; das spart CPU und RAM auf schwachen Geraeten.
- `npm run dev` bleibt als lokaler Einspieler-/Rapier-Modus erhalten.

Die Arena besitzt eine geschlossene, transparente Einfassung mit abgerundeten Ecken und Glasdecke. Eine kompakte 3,4-Meter-Viertelrundung verbindet den Boden ohne 90-Grad-Kante mit der Wand; das Glas beginnt bereits kurz oberhalb der Rundung. Der Tormund besitzt eine eigene horizontale 2,8-Meter-Rundung, die Endwand, Torseitenwand und Torboden sichtbar wie physikalisch ohne offene Naht verbindet. Die Kamera darf auch hinter bzw. ausserhalb der Arena stehen; Geometrie zwischen Kamera und Auto wird fuer den Render-Frame ausgeblendet. Client-Prediction, Go-Server und der lokale Rapier-Modus verwenden dieselbe Grundform, damit Wand-, Tor- und Bodenkontakte nicht durch spaete Netzwerkkorrekturen zurueckspringen.

Beim Start werden Spielername und eine von drei rein optischen, Rocket-League-inspirierten Karosserien mit Vorschau ausgewaehlt. Alle drei Varianten verwenden dieselbe Hitbox und dieselben Fahrwerte. Der Server bereinigt und begrenzt ihn, verteilt feste Orange-/Blau-Teams und sendet die Spielerliste an alle Browser. Namensschilder erscheinen ueber den Autos. Das orange Tor liegt auf +Z, das blaue auf -Z; ein Treffer zaehlt fuer das gegnerische Team, aktualisiert den zentralen Spielstand und startet alle Fahrzeuge sowie den Ball neu.

Die Serverphysik rechnet intern mit `float64`. Fuer das Netzwerk werden Position, Quaternion, lineare und Winkelgeschwindigkeit als `float32` uebertragen. Das v5-Paket ist 496 Byte gross und wird 60-mal pro Sekunde gesendet, also rund 30 KB/s je Client plus WebSocket-Overhead.
## Circular Boost HUD v1.10.17

- Die bisherige Geschwindigkeitsbox wurde vollständig durch eine runde, segmentierte Boost-Anzeige ersetzt.
- Die alte längliche Boost-Bar unten in der Mitte ist entfernt.
- Desktop: Boost-Anzeige unten rechts.
- Smartphone: Boost-Anzeige oben links an der bisherigen Speedometer-Position.
- 42 Segmente zeigen den aktuellen Booststand von 0 bis 100 an; die Mitte zeigt den numerischen Wert.
- Ultra High behält den Boost-Energieeffekt als dezente Funken rund um die neue Anzeige.
- Gameplay, Boostverbrauch und Geschwindigkeiten bleiben unverändert.

## Mobile Analog-Tuning v1.10.16

Die analoge Smartphone-Steuerung reagiert jetzt deutlich direkter, ohne wieder auf digitale An/Aus-Eingaben zurueckzufallen. Der alte relative Axis-Lock konnte bei Vollgas einen absichtlich gesetzten mittleren Lenkeinschlag massiv reduzieren; jetzt werden nur noch sehr kleine Querbewegungen als Fingerzittern gefiltert. Etwa 50 % Stickweg liefern wieder ungefaehr 50 % Lenkeinschlag, waehrend voller Ausschlag unveraendert 100 % erreicht. Die Hochgeschwindigkeitsdaempfung reduziert den mittleren Lenkeinschlag nur noch minimal.

Gas und Bremse verwenden eine progressivere Analogkurve: mittlerer Stickweg liefert bereits deutlich mehr als die Haelfte der moeglichen Eingabe, bleibt aber weiterhin stufenlos. Die interne Glattung reagiert ebenfalls ungefaehr doppelt so schnell, damit Einlenken, Beschleunigen und Bremsen nicht mehr verzoegert wirken. Desktop-WASD und die serverseitigen Fahrwerte bleiben unveraendert.

## Boost-Cosmetics

Im Startmenue kann neben Auto und Grafikprofil einer von vier rein optischen Boost-Trails gewaehlt werden: **SOLAR**, **ION**, **PLASMA** und **STARFALL**. Die Auswahl wird lokal gespeichert und ueber die Lobby-Roster-Daten an alle Spieler verteilt, damit jeder die gewaehlte Spur der anderen sieht. In Ultra High wird hinter jedem boostenden Auto ein gepoolter Partikel-Trail mit Additive-Blending gerendert; Normal verwendet weiterhin nur die leichte Auspuffflamme und Ultra Low verzichtet auf die Partikelspur. Die vier Varianten aendern keinerlei Schub, Verbrauch oder Geschwindigkeit. Die runde Boost-Anzeige besitzt in Ultra High waehrend aktivem Boost zusaetzlich einen kleinen Energie-/Spark-Effekt am Segmentring.

## Match-Chat

Der Multiplayer bietet 20 serverseitig validierte Quick Chats und zusaetzlich normalen Text Chat. Auf Desktop senden `1` bis `4` die ersten vier Favoriten direkt, `Y` oeffnet die komplette Quick-Chat-Auswahl und `T` oeffnet die Texteingabe. Quick Chat bleibt auf drei Nachrichten pro Burst mit zwei Sekunden Cooldown begrenzt. Freier Text ist auf 160 Unicode-Zeichen begrenzt, wird serverseitig bereinigt und besitzt einen separaten Spam-Cooldown.

Auf Smartphones gibt es einen permanent erreichbaren **CHAT**-Button. Er oeffnet ein Touch-Menue mit allen Quick Chats und einem eigenen Text-Tab; beim Tippen werden Fahr-, Boost- und Sprungeingaben neutralisiert, damit die Bildschirmtastatur keine Gameplay-Befehle ausloest. Chat-Nachrichten erscheinen fuer alle Spieler mit Name und Teamfarbe im kompakten Match-Feed.

## Basketball / Hoops

Beim Erstellen einer Lobby kann zwischen **NORMAL** und **BASKETBALL** gewaehlt werden. Basketball schliesst die Soccar-Tore, zeichnet einen eigenen Hardwood-Court, verwendet einen prozeduralen Basketball und erzeugt an beiden Enden physische Ringe, Backboards, Netze und Traeger. Der Go-Server berechnet Ball- und Autokollisionen mit Ring/Backboard autoritativ. Ein Punkt zaehlt nur, wenn der Ball die Ringebene von oben nach unten innerhalb des Korbradius durchquert. Dieselbe Logik ist fuer den lokalen Offline-Modus gespiegelt.

## Ball-Optik

Der bisherige Apfel-Platzhalter wurde komplett entfernt. Der Ball ist wieder eine echte Kugel und verwendet jetzt eine prozedurale, Soccar-/Rocket-League-inspirierte Panel-Oberflaeche mit dunklen Segmenten, hellen Metallpanelen, eingelassenen Fugen und dezenten technischen Lichtakzenten. Normal und Ultra High verwenden zusaetzlich eine Bump-Map fuer sichtbare Paneltiefe; Ultra Low behaelt dieselbe Grundoptik mit einer guenstigeren Kugelgeometrie und ohne physikalische Materialeffekte. Die Ball-Physics, Hitbox und Flugwerte bleiben unveraendert.

## Feld- und Boost-Layout

Das Feld verwendet 34 Boost-Pads nach dem Soccar-Referenzlayout: sechs grosse 100er-Pads (vier tiefe Eckpads plus zwei an der Mittellinie nahe der Seitenwand) und 28 kleine +12-Pads. Die Pad-Maske im binaeren Snapshot wurde deshalb von 16 auf 64 Bit erweitert; die Browserseite liest weiterhin auch die vorherigen 16-Pad- und Legacy-Snapshots.

In v1.10.12 wurden die UV-Koordinaten der abgerundeten Feldgeometrie explizit auf 0..1 normiert. Dadurch spannt die grosse Turf-/Markierungs-Textur jetzt wirklich ueber das komplette Spielfeld, statt an weiten Stellen nur Randpixel abzutasten. Das Grundgras ist satter und besitzt groessere Maehzonen, waehrend dunkle Gras-Sprenkel deutlich reduziert wurden.

Die sichtbaren Feldgrafiken liegen weiterhin auf einer einzigen unbeleuchteten Overlay-Textur direkt ueber dem Hardwood-Boden. In v1.10.23 wurde das Design jedoch stark vereinfacht: drei klar getrennte innere Rotationsrouten pro Haelfte, zwei saubere Aussenrouten, eine kurze Backline, ein grosser Goal-Halbkreis sowie permanente Locator-Ringe unter den Boost-Pads. Die Linien kreuzen sich nicht mehr quer ueber das Feld und werden in deutlich hoeherer Aufloesung gerendert. Das kostet weiterhin nur einen zusaetzlichen Draw-Call und keine zusaetzlichen Echtzeit-Lichter oder Post-Processing-Paesse.

Die unteren Boden-Wand-Rundungen sind nicht mehr schwarz: Die physikalische Wand bleibt unveraendert, wird visuell aber pro Spielfeldhaelfte getrennt gerendert. Die blaue Haelfte verwendet dunkle blaue Technik-Panels mit hellen Cyan-Rails, die orange Haelfte entsprechend Orange. Ein durchgehender heller Team-Rail folgt auch den gekruemmten Ecken am Beginn der Glaswand. Seit v1.10.23 gibt es auf dem Spielfeld gar kein geometrisches 3D-Gras mehr; Boost-Locators und Torboegen bleiben dadurch in jedem Grafikmodus frei und klar lesbar.

## Serverseitige Physik

Der Go-Server ist die einzige Online-Autoritaet und verarbeitet:

- Rocket-League-artige Bodenbeschleunigung, Bremsen, Grip, Lenkung und verbrauchbaren Boost
- Fahrtempo 50,76 km/h mit Gas, Supersonic ab 79,2 km/h und maximal 82,8 km/h mit Boost; darüber aufgebautes Tempo bleibt bis zum realen Speed-Cap erhalten
- Sechs grosse 100-%-Boostpads und 28 kleine +12-%-Pads im Soccar-artigen Rotationslayout mit 10/4 Sekunden Respawn
- Variabler Sprung durch gehaltenes Space, neutraler Doppelsprung und gerichtete Dodge/Flips mit exakt einer kontrollierten 360-Grad-Rotation
- Pitch/Yaw/Roll in der Luft mit analoger Ziel-Winkelgeschwindigkeit; ohne Input wird Restrotation aktiv stabilisiert, damit das Auto nicht durch altes Drehmoment wild weiterspinnt
- Referenz-Boost mit 9,91666 m/s² am Boden und 10,58333 m/s² in der Luft bei 6,5 m/s² Schwerkraft
- Surface-Adhesion: Rampen und senkrechte Waende halten das Auto bis zum aktiven Absprung
- Demolition bei gegnerischem Fronttreffer ab der 79,2-km/h-Supersonic-Schwelle, wobei ausschliesslich das schnellere Auto das langsamere demolieren kann, inklusive 4-Sekunden-Vogelperspektive und serverseitig ausgewaehltem Respawnpunkt
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

Freunde im selben Netzwerk oeffnen `http://DEINE-LAN-IP:8080`. Je nach Lobby-Einstellung koennen bis zu acht Browser Spielerplatz 1 bis 8 erhalten.

## Render.com deployen

Empfohlen ist der enthaltene Blueprint:

1. Dieses Verzeichnis in ein GitHub-/GitLab-/Bitbucket-Repository pushen.
2. In Render **New → Blueprint** waehlen und das Repository verbinden.
3. Render liest `render.yaml`, baut das vorhandene `Dockerfile` und verwendet `/health` als HTTP-Healthcheck.
4. Nach dem Deploy die erzeugte `*.onrender.com`-Domain oeffnen.
5. Alle Spieler verwenden dieselbe Render-Domain.

`render.yaml` setzt bewusst **genau eine Instanz**, weil Lobbies und laufende Matches derzeit im RAM dieses einen Go-Prozesses liegen. Mehrere Instanzen wuerden ohne externen Session-/Lobby-Store voneinander getrennte Lobby-Listen erzeugen. Der Blueprint startet im Free-Plan; bei Bedarf kann der Plan in Render angepasst werden.

Der Go-Server bindet auf `0.0.0.0:$PORT`. Render empfiehlt den von der Plattform gesetzten `PORT`; im Dockerfile ist `10000` nur der lokale Container-Default. Es sind keine Pflichtvariablen notwendig. Optional:

- `ALLOWED_ORIGINS=spiel.example.com,*.example.com` erlaubt zusaetzliche Browser-Origin-Patterns. Ohne Wert gilt die sichere Same-Origin-Pruefung.
- `STATIC_DIR` muss nur geaendert werden, wenn der Server ausserhalb des Dockerfiles gestartet wird und `dist` an einem anderen Ort liegt.
- `AUTH_DATA_FILE` legt die JSON-Datei für Accounts fest (Docker-Default: `/app/data/users.json`, lokal: `data/users.json`). Für dauerhaft erhaltene Accounts benötigt ein Hosting-Deployment ein persistentes Volume an diesem Pfad; das freie ephemere Render-Dateisystem überlebt keinen Instanz-Ersatz.

Healthcheck und Diagnose:

```text
GET /health
GET /config
GET /debug/game
WS  /lan
```

Ein Deployment beendet laufende In-Memory-Matches beim Containerwechsel.

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
- Nach einer Demolition: `1 / 2 / 3` waehlt links / Mitte / rechts; `A/D` oder Pfeiltasten wechseln den markierten Respawnpunkt waehrend der 4-Sekunden-Vogelperspektive.

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
- Nach einer Demolition erscheinen fuer vier Sekunden drei grosse Spawn-Buttons fuer links / Mitte / rechts; die normale Touch-Steuerung wird in dieser Auswahlphase deaktiviert.
- Bereits auf dem Start-/Namensbildschirm gibt es `VOLLBILD STARTEN`, damit das Spiel vor dem Match per echtem User-Tap in den Browser-Fullscreen wechseln kann

Das HUD beruecksichtigt Notch/Home-Bar per Safe-Area und verhindert Pull-to-Refresh/Browser-Gesten im Match. Mobilgeraete verwenden standardmaessig das Profil **NORMAL** mit Antialiasing, voller Arena-/Umgebungsqualitaet und 125–160 % Render-Skalierung; nur bei deutlich zu niedriger Framerate reduziert die adaptive Aufloesung bis minimal 90 %. Browser ohne normale Fullscreen-API erhalten einen Hinweis auf den bereits vorbereiteten Home-Screen/Standalone-Modus. Mit `?mobile=1` kann die Touch-Steuerung zum Testen erzwungen, mit `?mobile=0` deaktiviert werden.

## Grafikprofile

Direkt auf dem Startbildschirm kann die Grafikqualitaet gewaehlt werden. Die Auswahl wird lokal gespeichert und betrifft nur den jeweiligen Browser:

- **NORMAL**: bisherige volle Standarddarstellung; auf Smartphone/Tablet automatisch der empfohlene Modus.
- **ULTRA LOW**: stark reduzierte Renderauflosung und Details fuer schwache PCs/VMs. Weiterhin kompatibel mit `?perf=ultra` bzw. `?perf=ultra-low`.
- **ULTRA HIGH**: auf Desktop und leistungsstarken Smartphones waehlbar. Desktop startet bei 95 % Render-Skalierung und regelt adaptiv zwischen 68 und 108 %; Mobile startet bei 128 % und regelt adaptiv zwischen 96 und 152 %. Der Modus verwendet hochaufgeloeste, stark gefilterte Hardwood-/Feld-/Wandtexturen, ein dezentes Holz- und Wandplatten-Relief, detaillierte Felgen, matte Materialien, eine permanente mondbeleuchtete Abenddaemmerung mit Sternenhimmel sowie gestaffelt aktualisierte 2048-/1024-Schatten. 3D-Gras bleibt vollstaendig entfernt. Bloom, PMREM-Reflexionen und eine zweite Fullscreen-Renderpass-Kette bleiben bewusst deaktiviert.

Direktlinks fuer Tests:

```text
?perf=ultra-low
?perf=ultra-high
```

Auf Smartphones bleibt **NORMAL** die empfohlene Einstellung. **ULTRA HIGH** ist aber ebenfalls auswaehlbar und nutzt dort die schaerfere adaptive 96–152-%-Render-Skalierung sowie die hochaufgeloeste Holzoberflaeche; 3D-Gras gibt es in keinem Profil mehr.

### Finale Arena-/Performance-Abstimmung

- Tribuen und Publikum sind entfernt; Skyline, Haeuser und Baeume bleiben erhalten. Normal/Low verwenden Tageshimmel, Ultra High eine mondbeleuchtete Abenddaemmerung.
- Die Boden-Wand-Rundung ist deutlich kuerzer, waehrend die Glasflaeche frueher beginnt.
- Feldwand und Tortunnel werden ueber einen echten gerundeten Tormund verbunden. Ein schmaler Team-Akzent folgt genau dieser Kurve und kaschiert keine Luecke, sondern markiert die gemeinsame Geometrie.
- Der Torinnenraum besitzt abgerundete Boden-, Seiten-, Rueckwand- und Deckenuebergaenge. Die gleichen Radien gelten fuer Rendering, Rapier, Client-Prediction und Go-Server.
- Das Spielfeld verwendet keine Grasgeometrie mehr. Ultra High investiert die freie GPU-Zeit stattdessen in die hochaufgeloeste Hardwood-Textur, Wood-Bump-Map, anisotrope Filterung und die vorhandene Licht-/Schattenqualitaet.
- Die dunklen Arena- und Torwaende besitzen im Ultra-High-Modus eine prozedurale Platten-/Steinstruktur plus Bump-Relief, waehrend das Glas neutraler und weniger milchig bleibt.
- Supersampling, Lichtstaerke und Reflexionen wurden reduziert. Die gewonnene GPU-Zeit fliesst in sichtbare Oberflaechendetails statt in ueberhelles Post-Processing.

## Qualitaetschecks

```bash
npm run build
npm run test:js
go test ./...
go test -race ./...
```

Die Tests decken zusätzlich die exakten Arena-/Tor-/Spawn-/Boost-Koordinaten, glatten Eckenradien, 120-Hz-Zeitverläufe, Gas- und Lenkkurven, 50,76/79,2/82,8-km/h-Schwellen, Bremsen/Ausrollen, Massen, Ball-Drag/Restitution/Caps, Sprung-Hold/Sticky Force, Boostverbrauch sowie die Übereinstimmung von Server und Client-Prediction ab.


### Mobile Bedienung
- Browser-Zoom, Doppeltipp-Zoom und Pinch-Gesten sind während des Spiels deaktiviert.
- UI-Texte und Touch-Buttons sind nicht auswählbar; das Namensfeld bleibt normal editierbar.
- Der linke Joystick besitzt eine sehr große unsichtbare Touch-Fläche und nur einen kleinen transparenten Thumb-Punkt. Der Nullpunkt ist floating: Wo der Daumen aufsetzt, beginnt die neutrale Position.
- Der Fahrstick ist vollständig analog: keine harte Lenk-Schwelle mehr, sondern kontinuierliche Werte von -1 bis +1 für Lenkung und Gas/Bremse.
- Die Stickmitte besitzt nur eine winzige Micro-Deadzone. Danach steigt die Lenkung kontinuierlich an; bei hohem Tempo wird nur der mittlere Bereich weicher, voller Ausschlag bleibt 100 %.
- Ein weicher Axis-Lock filtert kleine unbeabsichtigte Querbewegungen des Daumens. Drift macht dieselbe Stickbewegung absichtlich aggressiver.
- Die Analogwerte werden zeitlich geglaettet und online mit 30 Hz gesendet; Server und Client-Prediction verwenden exakt dieselben `throttle`-/`steer`-Werte.

## Visual Palette v1.10.1

- Satterer, kontrastreicher Turf mit grossen Mow-Blocks und dezenten Blau/Orange-Zonen direkt in einer einzelnen Canvas-Textur.
- Dunklere Graphit-Waende, neutraleres Glas und kraeftigere Team-Akzente fuer einen lebendigeren Arena-Look.
- AgX-Tonemapping und neu abgestimmtes Tageslicht fuer mehr Farbtiefe ohne zusaetzliche Post-Processing-Kosten.
- Ultra High verwendet seit v1.10.23 kein geometrisches 3D-Gras mehr; die freigewordene GPU-Zeit geht stattdessen in schaerfere Feldtexturen und die vorhandenen Materialien/Schatten.


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

## Premium Rocket League Models v1.10.20

- Die drei sichtbaren Fahrzeug-Slots heissen jetzt `OCTANE`, `DOMINUS` und `FENNEC`. Die internen IDs `vortex`, `apex` und `razor` bleiben fuer Netzwerk-, Save- und Server-Kompatibilitaet bestehen; der fruehere `titan`/McLaren-Slot wird nicht mehr angeboten und faellt auf Octane zurueck.
- Nur `ULTRA HIGH` laedt die echten GLB-Modelle. `NORMAL` und `ULTRA LOW` nutzen weiterhin die jeweiligen leichten prozeduralen Fallback-Karosserien mit identischer Gameplay-Hitbox.
- Alle Premium-GLBs werden lazy geladen: Ein Fahrzeugmodell wird erst angefordert, wenn mindestens ein sichtbarer Spieler genau dieses Auto in Ultra High benutzt.
- Geometrien und eingebettete Texturen werden zwischen gleichen Fahrzeugen geteilt; Materialien werden pro Auto geklont, damit Teamfarben getrennt bleiben.
- Das hochgeladene Rocket-League-Ball-GLB wird ebenfalls ausschliesslich in `ULTRA HIGH` geladen. Normal/Ultra Low behalten den bisherigen prozeduralen Soccar-Ball. Ballradius, Collider, Masse, Roll- und Trefferphysik bleiben unveraendert.
- Physics, Gewicht, Hitbox, Booststaerke und Fahrwerte aller Fahrzeuge bleiben vollstaendig im bestehenden Car-System und werden von den GLBs nicht beeinflusst.

### 3D-Asset Attribution

Alle GLBs wurden vom Benutzer fuer dieses Projekt bereitgestellt und enthalten ihre Original-Metadaten. Vollstaendige Attribution und Quellen stehen in `THIRD_PARTY_ASSETS.md`.
