# DoKo Online 2026 🂡

Doppelkopf im Browser – auf MacBook, iPad und iPhone.
Spiel gegen drei Bots oder online mit Freunden, wenn ihr euch nicht treffen könnt.
Die Punkte werden automatisch gezählt, inklusive Bockrunden.

## Spielen

**Gegen Bots (offline):** Einfach `index.html` über GitHub Pages öffnen (siehe unten) → „Neue Runde gegen 3 Bots“.
Der Spielstand wird im Browser gespeichert. „Weiterspielen“ bringt dich zurück an den Tisch.

**Als App auf iPhone/iPad:** Seite in Safari öffnen → Teilen → „Zum Home-Bildschirm“.

## Unsere Hausregeln

| Regel | Umsetzung |
|---|---|
| Ohne Neunen | 40 Karten, je 10 pro Spieler |
| Keine Pflichtsoli | Soli sind freiwillig: Damen, Buben, Kreuz, Pik, Herz, Karo, Fleischlos |
| 2. Herz-10 schlägt die erste | Gilt immer. Abschaltbar |
| Schweine | Hat ein Spieler beide Karo-Asse, sind sie die höchsten Trümpfe, noch über den Herz-10. Die Ansage kommt automatisch beim ersten Fuchs |
| Karlchen | Gewinnt der Kreuz-Bube den letzten Stich, gibt es +1 für seine Partei |
| Hochzeit | Wird angesagt, und zwar mit **„erster Fehlstich“** oder **„erster Trumpfstich“**. Wer innerhalb der ersten 3 Stiche den ersten Stich dieser Art macht, spielt mit dem Hochzeiter. Klappt das nicht, spielt der Hochzeiter allein: Er bekommt dann 3-fach, jeder Gegner 1-fach (wie beim Solo) |
| Fuchs gefangen | Wird ein Karo-Ass vom Gegner gefangen: +1 |
| Doppelkopf | Stich mit 40 oder mehr Augen: +1 |
| Ansagen | **Re/Kontra geht, bis die eigene 5. Karte liegt.** Die Absagen haben jeweils eine Karte länger Zeit (wie im DKV-Regelwerk): keine 90 bis die 6., keine 60 bis die 7., keine 30 bis die 8., schwarz bis die 9. Karte liegt. Wer auf eine Ansage antwortet, hat eine Karte länger Zeit. Bei der Hochzeit zählen die Fristen ab dem Klärungsstich |
| Bockrunden | So viele Bockspiele, wie Spieler am Tisch sind (4). Ausgelöst durch: **0-Punkte-Spiel**, **durchlaufendes Herz** (alle 4 bedienen Herz in einem Stich), **Re und Kontra** im selben Spiel. Mehrere Auslöser stapeln sich (Doppelbock ×4) |

Außerdem gilt das Standard-Regelwerk (DKV): Absagen keine 90/60/30/schwarz, „gegen die Alten“, und ein Solo zählt dreifach.
Alle Regeln lassen sich unter „Regeln & Optionen“ umschalten.

## Veröffentlichen mit GitHub Pages (einmalig, ca. 1 Minute)

1. Im Repo auf **Settings → Pages** gehen
2. Bei *Build and deployment* Folgendes wählen: **Source: Deploy from a branch**, **Branch: `main` / `(root)`** → Save
3. Nach etwa einer Minute läuft das Spiel unter **https://ro83r7.github.io/DoKo-online_2026/**

## Online mit Freunden

Für den Online-Modus braucht es einen kleinen Server, weil GitHub Pages nur statische Dateien ausliefert.
Er liegt schon bei (`server/server.js`). Er liefert die App aus, verwaltet die Räume und lässt die Bots auf freien Plätzen spielen.
Der Server ist die einzige Instanz, die alle Karten kennt. Jeder Browser bekommt nur seine eigene Hand.

```bash
npm install
npm start            # → http://localhost:8080
```

**Kostenlos hosten (z. B. Render.com):** New → Web Service → dieses Repo auswählen
→ Build Command `npm install`, Start Command `npm start` → Deploy.
Danach öffnen alle einfach die Render-Adresse. Der Server ist dort automatisch eingetragen.
Einer eröffnet einen Raum und teilt den 4-stelligen Code oder den Einladungslink.
Die anderen treten bei, der Host startet, und freie Plätze übernehmen Bots.

Wer die Verbindung verliert, lädt die Seite neu und kommt über „Zurück in Raum …“ wieder an seinen Platz.
Der Host kann abwesende Spieler per Menü durch Bots ersetzen.

Wer die GitHub-Pages-Version nutzen will, trägt unter „Regeln & Optionen → Online“ die Server-Adresse ein
(`wss://<name>.onrender.com/ws`).

## Projektaufbau

```
index.html, css/, icons/     Oberfläche (ohne Build-Schritt, reines ES-Modul-JavaScript)
js/engine/                   Spiel-Engine – läuft identisch im Browser und auf dem Server
  cards.js                   Karten & Deck
  rules.js                   Spielarten, Trumpfreihenfolge, Stich, Bedienpflicht
  game.js                    Ablauf eines Spiels (Vorbehalt, Ansagen, Stiche) + Spielersicht
  scoring.js                 Abrechnung, Sonderpunkte, Bock-Auslöser
  bot.js                     KI der Mitspieler (sieht nur, was ein Mensch sehen würde)
  table.js                   Runde über viele Spiele: Geber, Punkte, Bock, Bots
js/client/                   App, Netzwerk (lokal/online), Speicher
server/server.js             Node-Server (statische Dateien + WebSocket-Räume)
test/                        Tests (`npm test`) inkl. 3000 simulierten Spielen
```
