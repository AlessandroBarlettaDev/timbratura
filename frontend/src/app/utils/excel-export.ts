import * as XLSX from 'xlsx';

export interface ExcelExportParams {
  nome:           string;
  email?:         string;
  codiceFiscale?: string;
  contratto?:     any;
  // Statistiche base — sempre presenti (non richiedono un contratto)
  stats: {
    periodoLabel:    string;
    oreLavorate:     string;   // es. "12h 30min"
    giorniLavorati:  number;
    mediaGiornaliera: string;  // es. "6h 15min"
    formatDurata:    (m: number) => string;
  };
  // Analisi contrattuale — solo se il contratto ha oreSett
  analisi?: {
    giorniLavAtt:    number;
    minutiAttesi:    number;
    minutiLavorati:  number;
    minutiStraord:   number;
    minutiMancanti:  number;
    retribOraria:    number | null;
    importoStraord:  number | null;
  };
  presenze: {
    data:    string;
    entrata: string;
    uscita?: string | null;
    durata?: string | null;
    oreDecimali: string;
    sede:    string;
  }[];
  filename: string;
}


export function esportaExcel(p: ExcelExportParams): void {
  const wb   = XLSX.utils.book_new();
  const rows: (string | number)[][] = [];

  const kv     = (k: string, v: string | number) => rows.push([k, v]);
  const sep    = () => rows.push([]);
  const header = (t: string) => rows.push([t]);

  // ── ANAGRAFICA ──────────────────────────────────────────────────────────────
  header('ANAGRAFICA');
  kv('Dipendente', p.nome);
  if (p.email)         kv('Email', p.email);
  if (p.codiceFiscale) kv('Codice fiscale', p.codiceFiscale);
  sep();

  // ── CONTRATTO ───────────────────────────────────────────────────────────────
  const c = p.contratto;
  if (c) {
    const tipoLabel: Record<string, string> = {
      indeterminato: 'Indeterminato', determinato: 'Determinato',
      part_time: 'Part-time', apprendistato: 'Apprendistato', stage: 'Stage',
    };
    header('CONTRATTO');
    kv('Tipo',        tipoLabel[c.tipoContratto] ?? c.tipoContratto);
    kv('Data inizio', c.dataInizio);
    kv('Data fine',   c.dataFine || '—');
    if (c.oreSett           != null) kv('Ore settimanali',    c.oreSett);
    if (c.giorniSett        != null) kv('Giorni settimanali', c.giorniSett);
    if (c.retribuzioneLorda != null) kv('Lordo mensile (€)',  c.retribuzioneLorda);
    if (c.retribuzioneNetta != null) kv('Netto mensile (€)',  c.retribuzioneNetta);
    if (c.livello)             kv('Livello',             c.livello);
    if (c.mansione)            kv('Mansione',             c.mansione);
    if (c.ccnl)                kv('CCNL',                 c.ccnl);
    if (c.giorniFerie != null) kv('Ferie annuali (gg)',   c.giorniFerie);
    if (c.permessiOre != null) kv('Permessi ROL (h)',     c.permessiOre);
    sep();
  }

  // ── STATISTICHE PERIODO ─────────────────────────────────────────────────────
  const s = p.stats;
  header('STATISTICHE PERIODO');
  kv('Periodo',           s.periodoLabel);
  kv('Ore lavorate',      s.oreLavorate);
  kv('Giorni lavorati',   s.giorniLavorati);
  kv('Media giornaliera', s.mediaGiornaliera);

  const a = p.analisi;
  if (a) {
    kv('Giorni lavorativi attesi (cal.)',     a.giorniLavAtt);
    kv('Ore contrattuali attese',            s.formatDurata(a.minutiAttesi));
    kv('Ore straordinarie',                  a.minutiStraord  > 0 ? s.formatDurata(a.minutiStraord)  : '—');
    kv('Ore mancanti',                       a.minutiMancanti > 0 ? s.formatDurata(a.minutiMancanti) : '—');
    if (a.retribOraria != null)
      kv('Retribuzione oraria lorda (€)',    +a.retribOraria.toFixed(2));
    if (a.importoStraord != null && a.minutiStraord > 0)
      kv('Importo straordinari lordo (€)',   +a.importoStraord.toFixed(2));
    kv('* I festivi non sono inclusi nel conteggio', '');
  }
  sep();

  // ── PRESENZE ────────────────────────────────────────────────────────────────
  header('PRESENZE');
  rows.push(['Data', 'Entrata', 'Uscita', 'Durata', 'Ore decimali', 'Sede']);
  for (const t of p.presenze) {
    rows.push([t.data, t.entrata, t.uscita ?? '—', t.durata ?? '—', t.oreDecimali, t.sede]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 40 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Timbrature');

  XLSX.writeFile(wb, p.filename);
}
