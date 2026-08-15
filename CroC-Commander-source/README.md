# croc-commander

Gestore file retro a doppio pannello (look anni '90: schermo blu, doppi bordi ciano, barra F1–F10, riga di comando) con trasferimento file peer-to-peer integrato tramite **croc**. Basato su Electron; si compila in `.exe` Windows e `.AppImage` Linux.

```
┌────────────────────────────────────────────────────────────────────┐
│ Sinistra  File  Comandi  Opzioni  Destra                            │
├───────────────────────────────┬────────────────────────────────────┤
│ ╔══ /home/user ═════════════╗ │ ╔══ /tmp ════════════════════════╗ │
│ ║ Nome  Dimens. Data Ora Attr│ │ ║ Nome  Dimens. Data Ora Attr   ║ │
│ ║ docs        <DIR> 09-08-24 │ │ ║ file.txt 1.2KB 09-08-24       ║ │
│ ║ report.txt 45KB  08-08-24  │ │ ║ ...                           ║ │
│ ║ file: 12  selezionati: 0   │ │ ║ file: 3  selezionati: 0       ║ │
│ ╚════════════════════════════╝ │ ╚═══════════════════════════════╝ │
├───────────────────────────────┴────────────────────────────────────┤
│ /home/user> _                                                     │
│ 1Aiuto 2Modifica 3Vedi 4Info 5Invia 6Ricevi 7Codice 8Relay 9Menu 10Esci│
└────────────────────────────────────────────────────────────────────┘
```

## Funzioni

- **Doppio pannello** — sfoglia due cartelle affiancate; `Tab` cambia pannello, clic del mouse seleziona.
- **Barra F1–F10** — Aiuto, Modifica, Vedi, Info, Invia, Ricevi, Codice, Relay, Menu, Esci.
- **Invia file (F5)** — invia i file selezionati via croc; codice generato automaticamente o personalizzato (F7).
- **Ricevi file (F6)** — ricevi con codice; scegli la cartella di destinazione con F2.
- **Codice personalizzato (F7)** — imposta un codice fisso per l'invio (salvato nelle impostazioni).
- **Imposta relay (F8)** — usa un relay croc diverso (host:porta) e password relay opzionale.
- **Riga di comando** — prompt in basso: esegue comandi shell (bash) nella cartella attiva; supporta anche `croc send <file>`, `croc recv <codice>`, `invia`, `ricevi`, `cd`, `aiuto`, `esci`.
- **Selezione** — `Ins`/`Spazio` alterna, `+`/`-` seleziona/deseleziona gruppo, `*` inverte.
- **Modalità di vista** — `Ctrl+F1..F3` Breve / Completo / Info; `Ctrl+F5..F9` ordina per nome/estensione/tempo/dimensione.
- **Trasferimenti croc** — richiede [croc](https://github.com/schollz/croc) su `PATH` (o `$CROC_BIN`).

## Riferimento tastiera

| Tasto | Azione | Tasto | Azione |
|---|---|---|---|
| `F1` | Aiuto | `Alt+F1/F2` | Lista drive (sinistra/destra) |
| `F2` | Modifica file | `Alt+F5` | Invia con croc |
| `F3` | Vedi file | `Alt+F6` | Ricevi con croc |
| `F4` | Info file | `Alt+F7` | Trova file |
| `F5` | Invia file (croc) | `Alt+F8` | Cronologia cartelle |
| `F6` | Ricevi file (croc) | `Alt+Invio` | Info file |
| `F7` | Codice personalizzato | `Ctrl+F1..F3` | Breve/Completo/Info |
| `F8` | Imposta relay | `Ctrl+F5..F9` | Ordina |
| `F9` | Menu a tendina | `Ctrl+U` | Scambia pannelli |
| `F10` | Esci | `Ctrl+R` | Rileggi |
| `Tab` | Cambia pannello | `Ctrl+P` | Copia percorso sull'altro pannello |
| `Invio` | Entra / apri | `Ctrl+\\` | Radice del drive |
| `Backspace` | Cartella superiore | `Ctrl+Invio` | Nome su riga comando |
| `Ins`/`Spazio` | Seleziona | `Esc` | Chiudi finestre/dialoghi |

## Esecuzione da sorgente

```bash
npm install
npm start
```

## Build

AppImage Linux:

```bash
./build.sh            # oppure: npm run build:linux
./croc-commander      # avviatore (estrae ed esegue l'AppImage, senza FUSE2)
```

Portable .exe Windows (su Windows):

```bat
build.bat             :: oppure: npm run build:win
```

Entrambe le piattaforme in CI: workflow GitHub Actions `.github/workflows/build.yml` compila `croc-commander-*.AppImage` e `croc-commander-*.exe` su push di tag / esecuzione manuale. Ricetta Docker (`Dockerfile`) compila l'AppImage in un container.

Gli artefatti finiscono in `dist/`:
- `dist/croc-commander-1.0.0-x86_64.AppImage`
- `dist/croc-commander-1.0.0.exe` (Windows portable)

## Nota su croc

L'app trova `croc` tramite `$CROC_BIN` o `PATH` (o un binario `croc` accanto all'eseguibile). Installalo una volta:

```bash
curl https://getcroc.schollz.com | bash    # Linux
scoop install croc                          # Windows
```

Il relay predefinito è quello ufficiale di croc (`142.132.189.179:9009`); si può cambiare con F8 o con la voce di menu. Il codice personalizzato e il relay vengono salvati nelle impostazioni.

## Test

```bash
node test-utils.js    # unit test per logica path/formato/ordinamento/glob (senza display)
node test-smoke.js    # smoke test Electron (serve un display o xvfb)
node test-spawn.js    # verifica argomenti/env passati a croc (usa un finto binario croc)
```

## Crediti

Creato da ReverseLoo-Dev
[croc-ui.tuxlab.site](https://croc-ui.tuxlab.site)
