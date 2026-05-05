# Export Excel e Calcolo delle Ore

## Contesto normativo

Il D.Lgs. 8 aprile 2003, n. 66 e il successivo D.L. 112/2008 (Libro Unico del Lavoro) impongono al datore di lavoro di registrare le ore effettivamente lavorate da ciascun dipendente, inclusi gli straordinari. Nella pratica, i responsabili HR necessitano di estrarre periodicamente questi dati in un formato elaborabile — tipicamente per alimentare il sistema paghe o per la rendicontazione interna.

Il sistema prevede un export in formato Excel (`.xlsx`) disponibile sia dalla dashboard del manager (per qualsiasi dipendente) che da quella del dipendente (per i propri dati). Il file esportato contiene lo storico delle timbrature del periodo selezionato, con un foglio aggiuntivo di analisi se il dipendente ha un contratto attivo.

## Calcolo delle ore lavorate

Le ore lavorate vengono calcolate a partire dalle timbrature grezze, raggruppandole per giorno e abbinando entrate e uscite:

```typescript
function calcolaMinutiLavorati(timbrature: Timbratura[]): number {
  // raggruppa per giorno lavorativo (usa t.data, non timestamp UTC)
  const perGiorno = new Map<string, Timbratura[]>();
  for (const t of timbrature) {
    const giorno = t.data;
    if (!perGiorno.has(giorno)) perGiorno.set(giorno, []);
    perGiorno.get(giorno)!.push(t);
  }

  let totaleMinuti = 0;
  for (const eventi of perGiorno.values()) {
    // ordina per timestamp (ora esatta)
    const ordinati = eventi.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    let ultimaEntrata: Date | null = null;
    for (const e of ordinati) {
      if (e.tipo === 'entrata') {
        ultimaEntrata = new Date(e.timestamp);
      } else if (e.tipo === 'uscita' && ultimaEntrata) {
        totaleMinuti += (new Date(e.timestamp).getTime() - ultimaEntrata.getTime()) / 60_000;
        ultimaEntrata = null;
      }
    }
    // un'entrata senza uscita non contribuisce al totale
  }
  return Math.round(totaleMinuti);
}
```

Alcune scelte progettuali:
- Il raggruppamento usa `t.data` (ora locale italiana) non il timestamp UTC — necessario per i turni notturni
- La durata è calcolata sulla differenza tra timestamp UTC — garantisce precisione al minuto indipendentemente dall'ora legale
- Un'entrata senza uscita corrispondente viene ignorata nel calcolo — non si assume un orario di uscita
- Più turni nello stesso giorno (es. entrata mattina, uscita pausa pranzo, entrata pomeriggio, uscita sera) vengono sommati correttamente

## Calcolo dei giorni lavorativi attesi

Per calcolare gli straordinari e i minuti mancanti, occorre confrontare le ore effettivamente lavorate con quelle contrattuali previste nel periodo. Il sistema calcola i giorni lavorativi attesi contando i giorni feriali (lunedì-venerdì) nel periodo selezionato, escludendo sabato e domenica:

```typescript
function countWorkingDays(anno: number, mese: number | null): number {
  let count = 0;
  const start = mese ? new Date(anno, mese - 1, 1) : new Date(anno, 0, 1);
  const end   = mese ? new Date(anno, mese, 0)     : new Date(anno, 11, 31);
  const d = new Date(start);
  while (d <= end) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;  // 0=domenica, 6=sabato
    d.setDate(d.getDate() + 1);
  }
  return count;
}
```

**Limitazione**: il calcolo considera solo sabato e domenica come non lavorativi. Non considera festività nazionali (Natale, Ferragosto, ecc.) né le ferie individuali del dipendente. Un'integrazione con un calendario delle festività italiane migliorerebbe l'accuratezza, ma richiederebbe una fonte dati aggiuntiva e una gestione della variabilità regionale (es. Santo Patrono locale).

## Calcolo degli straordinari

Se il dipendente ha un contratto con `oreSett` definito, il sistema calcola le ore attese nel periodo e le confronta con quelle effettive:

```typescript
const minutiLavorati = calcolaMinutiLavorati(timbrature);
const giorniLavAtt   = countWorkingDays(anno, mese);

// ore giornaliere contratto = oreSett / giorniSett
// minuti attesi = giorni lavorativi × ore giornaliere × 60
const minutiAttesi  = Math.round(
  giorniLavAtt * (contratto.oreSett / (contratto.giorniSett ?? 5)) * 60
);

const minutiStraord  = Math.max(0, minutiLavorati - minutiAttesi);
const minutiMancanti = Math.max(0, minutiAttesi - minutiLavorati);
```

Il calcolo assume una distribuzione uniforme delle ore su tutti i giorni lavorativi. Non tiene conto di turni con orari diversi in giorni diversi, né di regimi d'orario variabili — limitazioni accettabili per una prima implementazione.

## Calcolo del costo degli straordinari

Se il contratto ha `retribuzioneLorda` e `oreSett`, il sistema stima la retribuzione oraria e il costo delle ore straordinarie:

```typescript
// retribuzione oraria = lorda mensile / (ore settimanali × 52 settimane / 12 mesi)
const retribOraria = contratto.retribuzioneLorda / (contratto.oreSett * 52 / 12);

const importoStraord = (minutiStraord / 60) * retribOraria;
```

Questa è una stima indicativa. La retribuzione effettiva degli straordinari dipende dalle maggiorazioni previste dal CCNL applicato (tipicamente 25-50% in più rispetto all'ordinario), che il sistema non conosce. L'export lo presenta come riferimento per i responsabili HR, non come calcolo definitivo ai fini retributivi.

## Struttura del file Excel

Il file `.xlsx` viene generato interamente lato client con la libreria `xlsx` (SheetJS), senza coinvolgere il backend:

**Foglio 1 — Timbrature**: ogni riga è una timbratura, con colonne data, ora, tipo, sede. I turni completi (entrata+uscita) mostrano anche la durata.

**Foglio 2 — Analisi** (solo se contratto disponibile):

| Campo | Valore |
|---|---|
| Periodo | Maggio 2026 |
| Giorni lavorativi attesi | 21 |
| Ore attese | 168:00 |
| Ore lavorate | 171:30 |
| Straordinari | 3:30 |
| Ore mancanti | 0:00 |
| Retribuzione oraria stimata | € 12,50 |
| Costo straordinari stimato | € 43,75 |

Il nome del file segue il pattern `timbrature-mario-rossi-2026-05.xlsx`.

## Limitazioni e possibili evoluzioni

**Festività**: aggiungere un calendario delle festività nazionali e regionali italiane per un calcolo più accurato dei giorni lavorativi attesi.

**Maggiorazioni CCNL**: il campo `ccnl` è presente nel contratto ma non utilizzato per calcolare le maggiorazioni degli straordinari. Integrare una tabella di maggiorazioni per CCNL permetterebbe un calcolo più preciso.

**Ferie e permessi**: il contratto ha i campi `giorniFerie` e `permessiOre` ma non sono collegati al calcolo delle ore mancanti. Un dipendente in ferie non dovrebbe avere ore mancanti per quei giorni.

**Export PDF**: l'export Excel è adatto per elaborazioni interne. Un formato PDF firmato digitalmente sarebbe più adatto per la trasmissione formale ai fini del Libro Unico del Lavoro.
