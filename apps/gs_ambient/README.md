# Ambient

Farbrad für die Ambientebeleuchtung (BMW G2x, iDrive 7): zwei Zonen (oben, unten), Helligkeit, vier Effekte
(Farbverlauf, Favoriten, Überblenden, Atmen) und bis zu 6 Gruppen mit eigenem Namen und je 8 Paaren.

**Standard sendet nichts.** „BDC-Licht“ schreibt die freie Farbe an den BDC, derselbe Kurzzeit-Weg wie
bei IterioDevs Comfort-Dienst: Halt 254 Sekunden, Erneuerung alle 2 Minuten. Der Dienst läuft weiter,
wenn die Oberfläche zu ist. Die Headunit startet die App mit (`mguAppStartType: autostart`). Der Schalter
**Autostart** (an) setzt dann die gespeicherte Farbe, sobald BDC-Licht gewählt ist, auch ohne die Kachel
zu öffnen, und noch einmal nachdem das Auto verlassen und wieder besetzt wurde. Dabei läuft der
zuletzt gewählte Effekt weiter, in der Gruppe, die offen war. Aus lässt den Start
ruhig, bis die App geöffnet wird. Geparkt oder abgeschlossen gibt die Farbe zurück und beendet den
Dienst, damit er die Headunit nicht wach hält. **Nachlauf nach Aus** steht auf 0 (sofort, Werkfarbe).
10 bis 120 Sekunden lassen die Farbe noch so lange weiterlaufen und schalten die Module danach dunkel,
statt auf die Werkfarbe zurückzuspringen. Während dieser Zeit wird nicht freigegeben: Freigeben im selben
Schritt hat die Werkfarbe sofort zurückgeholt. Geht die Headunit in der Zeit aus, bleibt die letzte Farbe
für die restlichen Sekunden im Steuergerät. Der Halt dafür ist höchstens 254 Sekunden; danach entscheidet
wieder das Auto. Die Menüfarbe der Werk-Ambiente
wird mitgelesen und schaltet unsere Farbe nicht ab. Der BDC muss sich als `0F2680` melden, sonst wird nichts geschrieben. „Profil umschalten“ bleibt
gesperrt. Das Debug-Protokoll steht in den Einstellungen auf Aus. An schreibt auf der Headunit
`/var/opt/public/oap/oap_<uid>/data/gs_ambient_probe.json` (und `gs_ambient_debug.log`): die
Namen aus dem SOME/IP-Katalog, die rohe Antwort von `22 F150`, `360A`, `360D` und `F190`, die
gefundenen Lichtmodule und ob Fahrzeugzustand und Werk-Ambiente ankamen.

- Bedienung: Touch (Tippen, Ziehen auf Rad und Reglern) und iDrive-Controller (Kippen = Fokus, Drehen auf Rad
  und Reglern = Wert, Drücken = auslösen). Volle Bedienung nur im Vollbild mit GPU-Renderer.
- Emulator: `node kit/tools/emu.js gs_ambient` → http://localhost:8077
- Tests: `node kit/tools/test_gs_ambient.js`
- MGU App Store: Quelle `github-name/ambient-colorwheel`, Kanal Branch `main`. Der Store liest `mgu-repo.json` im Repo-Wurzelverzeichnis und bietet jede App unter `apps/` an, deren Ordner eine `app.json` hat. Ambient ist `gs_ambient`, Version aus `app.json` (`0.1.8`). Gebaut wird auf der Headunit mit `kit/tools/build.py`; das SDK legt der Store aus der Unit in `oap-sdk`. Mit der App kommen der GPU-Renderer (`idrive7-renderd` 2.1.6) und das Controller-Gate (`mgu-inputgate` 1.0.0).
- Design: `docs/superpowers/specs/2026-10-31-ambient-colorwheel-design.md`
