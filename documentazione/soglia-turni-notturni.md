# Soglia dei 20 Ore e Turni Notturni

## Il problema

Ogni timbratura deve essere classificata come "entrata" o "uscita". Il sistema calcola automaticamente il tipo basandosi sull'ultima timbratura dell'utente, seguendo una logica semplice:

- se l'ultima era un'uscita (o non ne esistono) → la prossima è un'entrata
- se l'ultima era un'entrata → la prossima è un'uscita

Questa logica funziona nella grande maggioranza dei casi, ma ha due scenari problematici.

## Scenario 1: turno notturno

Un dipendente entra alle 22:00 e termina il turno alle 06:00 del giorno successivo. Il suo storico è:

```
22:00  entrata
       [turno notturno in corso]
06:00  → il sistema deve capire che questa è un'uscita
```

Il sistema vede che l'ultima timbratura è un'entrata delle 22:00 — avvenuta 8 ore fa. Deve classificare la timbratura delle 06:00 come uscita. ✓ La logica semplice funziona: ultima è entrata → prossima è uscita.

## Scenario 2: uscita dimenticata

Un dipendente entra alle 09:00 e dimentica di timbrare l'uscita. Il giorno dopo torna alle 09:00:

```
Giorno 1 - 09:00  entrata
           [uscita dimenticata]
Giorno 2 - 09:00  → il sistema deve capire che questa è una nuova entrata
```

Il sistema vede che l'ultima timbratura è un'entrata delle 09:00 di ieri — avvenuta 24 ore fa. Se applicasse la logica semplice (ultima è entrata → prossima è uscita), classificherebbe erroneamente la timbratura come uscita, creando un turno di 24 ore nel registro.

## La soglia come euristica

La soluzione è una soglia temporale: se l'ultima entrata è avvenuta **più di N ore fa**, si assume che il turno sia terminato (anche senza uscita registrata) e la prossima timbratura è una nuova entrata.

```typescript
const TURNO_MAX_ORE = 20;

export function calcolaTipo(ultima: any): 'entrata' | 'uscita' {
  if (!ultima || ultima.tipo === 'uscita') return 'entrata';
  const elapsed = Date.now() - new Date(ultima.timestamp).getTime();
  if (elapsed >= TURNO_MAX_ORE * 3_600_000) return 'entrata';
  return 'uscita';
}
```

La tabella di verità completa:

| Ultima timbratura | Tempo trascorso | Tipo calcolato | Ragionamento |
|---|---|---|---|
| nessuna | — | entrata | Primo accesso |
| uscita | qualsiasi | entrata | Turno concluso |
| entrata | < 20 ore | uscita | Turno in corso (anche notturno) |
| entrata | ≥ 20 ore | entrata | Uscita dimenticata, nuovo turno |

## Perché 20 ore

La soglia di 20 ore è scelta per separare nettamente i due scenari:

- Il turno notturno più lungo realisticamente previsto da un CCNL è di circa 12 ore (con straordinari tollerabili fino a 14-16 ore in casi eccezionali)
- Un'uscita dimenticata si manifesta tipicamente dopo almeno 16-24 ore (la notte di sonno tra un giorno lavorativo e l'altro)

Con 20 ore:
- Un turno di 12 ore (entrata 22:00, uscita 10:00) → elapsed = 12h < 20h → uscita ✓
- Un'uscita dimenticata (entrata 09:00, giorno dopo 09:00) → elapsed = 24h > 20h → entrata ✓
- Un turno molto lungo di 18 ore → elapsed = 18h < 20h → uscita ✓

## Limiti dell'euristica

**Falsi negativi**: un dipendente che lavora un turno di esattamente 21 ore vedrebbe la sua uscita classificata come entrata. Il sistema la mostrerebbe come inizio di un nuovo turno. Il dipendente può correggere il tipo manualmente prima di confermare, oppure inviare una richiesta di correzione manuale successivamente.

**Non considera il contratto**: la soglia è globale per tutti i dipendenti, indipendentemente dal loro contratto. Un part-time con turni da 4 ore potrebbe trarre beneficio da una soglia più bassa; un dipendente con turni eccezionali molto lunghi potrebbe averne bisogno di una più alta. Un'evoluzione possibile sarebbe calcolare la soglia in base al parametro `oreSett/giorniSett` del contratto del dipendente.

**Non considera l'orario di lavoro**: il sistema non sa quando un dipendente "dovrebbe" essere al lavoro. Un'entrata alle 02:00 di notte viene trattata esattamente come una alle 09:00. Un sistema più sofisticato potrebbe usare gli orari contrattuali per affinare la classificazione.

## Il meccanismo di correzione

Per gestire i casi in cui la soglia produce un risultato sbagliato, il sistema prevede due livelli di correzione:

**1. Correzione immediata** (prima della conferma): nella schermata di anteprima, il dipendente vede il tipo calcolato e può invertirlo con un pulsante. Se cambia il tipo, il backend valida che la sequenza risultante sia coerente prima di salvare.

**2. Correzione a posteriori** (richiesta manuale): se il dipendente si accorge dell'errore solo dopo aver confermato, può inviare una richiesta di correzione dalla propria dashboard. Il manager la revisiona e, se approvata, il backend inserisce la timbratura mancante o corretta nella posizione temporale giusta, verificando la coerenza della sequenza sia verso il passato che verso il futuro (validazione forward-looking).
