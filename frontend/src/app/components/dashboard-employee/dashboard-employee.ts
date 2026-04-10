import { Component, ChangeDetectorRef, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TitleCasePipe } from '@angular/common';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/user-auth.service';

@Component({
  selector: 'app-dashboard-employee',
  imports: [FormsModule, TitleCasePipe],
  templateUrl: './dashboard-employee.html',
  styleUrl: '../../app.css',
})
export class DashboardEmployee implements OnInit {

  // ─── Profilo ──────────────────────────────────────────────────────────────
  profile: any = null;
  profileLoading = false;

  // ─── Timbrature ───────────────────────────────────────────────────────────
  timbrature: any[]  = [];
  timbratureLoading  = false;
  annoSelezionato    = new Date().getFullYear();
  meseSelezionato: number | null = new Date().getMonth() + 1;
  readonly mesi = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

  // ─── Requests ─────────────────────────────────────────────────────────────
  mieRequests: any[]  = [];
  requestsLoading     = false;
  showRequestModal    = false;
  requestModalError: string | null = null;
  newRequest          = { data: '', tipo: 'entrata', ora: '', nota: '' };

  constructor(private apiService: ApiService, public authService: AuthService, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    // Aspetta che la sessione Cognito sia caricata prima di caricare il profilo
    // (necessario quando si arriva da pagine pubbliche come /timbratura)
    this.authService.checkCurrentSession().then(() => this.loadProfile());
  }


  // ─── Profilo ──────────────────────────────────────────────────────────────

  private loadProfile() {
    const me = this.authService.utente();
    if (!me) return;
    this.profileLoading = true;
    this.apiService.getUser(me.userId).subscribe({
      next: (data) => {
        this.profile        = data;
        this.profileLoading = false;
        this.loadTimbrature();
        this.loadMieRequests();
        this.cdr.detectChanges();
      },
      error: (err) => { console.error('[employee] errore profilo:', err); this.profileLoading = false; this.cdr.detectChanges(); },
    });
  }


  // ─── Timbrature — caricamento e periodo ───────────────────────────────────

  loadTimbrature() {
    this.timbratureLoading = true;
    this.apiService.getMieTimbrature(this.getPeriodoApi()).subscribe({
      next: (data) => { this.timbrature = data; this.timbratureLoading = false; this.cdr.detectChanges(); },
      error: (err)  => { console.error('Errore timbrature:', err); this.timbratureLoading = false; this.cdr.detectChanges(); },
    });
  }

  cambiaPeriodo() { this.loadTimbrature(); }

  annoPrecedente() { this.annoSelezionato--; this.cambiaPeriodo(); }
  annoSuccessivo() { this.annoSelezionato++; this.cambiaPeriodo(); }

  mesePrecedente() {
    if (this.meseSelezionato == null) { this.meseSelezionato = 12; this.cambiaPeriodo(); return; }
    if (this.meseSelezionato === 1) { this.meseSelezionato = 12; this.annoSelezionato--; }
    else { this.meseSelezionato--; }
    this.cambiaPeriodo();
  }

  meseSuccessivo() {
    if (this.meseSelezionato == null) { this.meseSelezionato = 1; this.cambiaPeriodo(); return; }
    if (this.meseSelezionato === 12) { this.meseSelezionato = 1; this.annoSelezionato++; }
    else { this.meseSelezionato++; }
    this.cambiaPeriodo();
  }

  deselezionaMese()       { this.meseSelezionato = null;                      this.cambiaPeriodo(); }
  selezionaMeseCorrente() { this.meseSelezionato = new Date().getMonth() + 1; this.cambiaPeriodo(); }

  get meseLabel(): string {
    if (this.meseSelezionato == null) return 'Tutto l\'anno';
    return this.mesi[this.meseSelezionato - 1];
  }

  get periodoLabel(): string {
    return this.meseSelezionato == null ? `${this.annoSelezionato}` : `${this.meseLabel} ${this.annoSelezionato}`;
  }


  // ─── Timbrature — turni ───────────────────────────────────────────────────

  // Aggrega le timbrature flat in turni (entrata+uscita abbinati) ordinati per data desc.
  // Più turni nello stesso giorno (es. pausa pranzo) diventano righe separate.
  // Un'entrata senza uscita genera un turno aperto (uscita/durata = null).
  get turni(): { data: string; entrata: string; uscita: string | null; durata: string | null; sede: string }[] {
    const perGiorno = new Map<string, any[]>();
    for (const t of this.timbrature) {
      const giorno = t.timestamp?.slice(0, 10);
      if (!giorno) continue;
      if (!perGiorno.has(giorno)) perGiorno.set(giorno, []);
      perGiorno.get(giorno)!.push(t);
    }

    const risultato: { data: string; entrata: string; uscita: string | null; durata: string | null; sede: string }[] = [];

    const giorni = [...perGiorno.keys()].sort((a, b) => b.localeCompare(a)); // più recenti prima
    for (const giorno of giorni) {
      const eventi = perGiorno.get(giorno)!.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      let entrata: any = null;
      for (const e of eventi) {
        if (e.tipo === 'entrata') {
          entrata = e;
        } else if (e.tipo === 'uscita' && entrata) {
          const minuti = Math.round((new Date(e.timestamp).getTime() - new Date(entrata.timestamp).getTime()) / 60_000);
          risultato.push({
            data:    new Date(giorno).toLocaleDateString('it-IT'),
            entrata: this.formatTimestamp(entrata.timestamp).ora,
            uscita:  this.formatTimestamp(e.timestamp).ora,
            durata:  this.formatDurata(minuti),
            sede:    e.stazioneDescrizione || entrata.stazioneDescrizione || '—',
          });
          entrata = null;
        }
      }
      // Entrata senza uscita corrispondente
      if (entrata) {
        risultato.push({
          data:    new Date(giorno).toLocaleDateString('it-IT'),
          entrata: this.formatTimestamp(entrata.timestamp).ora,
          uscita:  null,
          durata:  null,
          sede:    entrata.stazioneDescrizione || '—',
        });
      }
    }
    return risultato;
  }


  // ─── Timbrature — statistiche ─────────────────────────────────────────────

  // L'ultima timbratura di oggi determina la presenza: entrata = presente, uscita = assente
  get presenteOra(): boolean | null {
    const oggi = new Date().toISOString().slice(0, 10);
    const timbratureOggi = this.timbrature.filter(t => t.timestamp?.startsWith(oggi));
    if (timbratureOggi.length === 0) return null;
    return timbratureOggi[0].tipo === 'entrata';
  }

  get oreLavorate(): string {
    return this.formatDurata(this.calcolaMinutiLavorati(this.timbrature));
  }

  get giorniLavorati(): number {
    return this.giorniConPresenza(this.timbrature);
  }

  get mediaGiornaliera(): string {
    const giorni = this.giorniConPresenza(this.timbrature);
    if (giorni === 0) return '—';
    return this.formatDurata(Math.round(this.calcolaMinutiLavorati(this.timbrature) / giorni));
  }

  private calcolaMinutiLavorati(timbrature: any[]): number {
    const perGiorno = new Map<string, any[]>();
    for (const t of timbrature) {
      const giorno = t.timestamp?.slice(0, 10);
      if (!giorno) continue;
      if (!perGiorno.has(giorno)) perGiorno.set(giorno, []);
      perGiorno.get(giorno)!.push(t);
    }
    let totaleMinuti = 0;
    for (const eventi of perGiorno.values()) {
      const ordinati = [...eventi].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      let ultimaEntrata: Date | null = null;
      for (const e of ordinati) {
        if (e.tipo === 'entrata') {
          ultimaEntrata = new Date(e.timestamp);
        } else if (e.tipo === 'uscita' && ultimaEntrata) {
          totaleMinuti += (new Date(e.timestamp).getTime() - ultimaEntrata.getTime()) / 60_000;
          ultimaEntrata = null;
        }
      }
    }
    return Math.round(totaleMinuti);
  }

  private giorniConPresenza(timbrature: any[]): number {
    return new Set(timbrature.map(t => t.timestamp?.slice(0, 10)).filter(Boolean)).size;
  }


  // ─── Timbrature — export Excel ────────────────────────────────────────────

  scaricaTimbratureExcel() {
    if (this.timbrature.length === 0) return;

    const nomeUtente = `${this.profile?.given_name ?? ''} ${this.profile?.family_name ?? ''}`.trim();
    const mm   = this.meseSelezionato ? `-${String(this.meseSelezionato).padStart(2, '0')}` : '-annuale';
    const slug = nomeUtente.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    const riepilogo = [
      ['Dipendente',      this.escapeCsv(nomeUtente)],
      ['Periodo',         this.escapeCsv(this.periodoLabel)],
      ['Ore lavorate',    this.escapeCsv(this.oreLavorate)],
      ['Giorni lavorati', this.escapeCsv(String(this.giorniLavorati))],
      ['Media giornaliera', this.escapeCsv(this.mediaGiornaliera)],
      [],
    ].map(r => r.join(';'));

    const intestazione = ['Data', 'Entrata', 'Uscita', 'Durata', 'Sede'];
    const righe = this.turni.map(t =>
      [t.data, t.entrata, t.uscita ?? '—', t.durata ?? '—', t.sede].map(v => this.escapeCsv(v))
    );

    const csv  = ['\ufeff' + riepilogo.join('\n'), intestazione.join(';'), ...righe.map(r => r.join(';'))].join('\n');
    const blob = new Blob([csv], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const link = document.createElement('a');
    link.href  = URL.createObjectURL(blob);
    link.download = `timbrature-${slug}-${this.annoSelezionato}${mm}.xls`;
    link.click();
    URL.revokeObjectURL(link.href);
  }


  // ─── Requests ─────────────────────────────────────────────────────────────

  loadMieRequests() {
    this.requestsLoading = true;
    this.apiService.getMieRequests().subscribe({
      next: (data) => { this.mieRequests = data; this.requestsLoading = false; this.cdr.detectChanges(); },
      error: (err)  => { console.error('Errore richieste:', err); this.requestsLoading = false; this.cdr.detectChanges(); },
    });
  }

  openRequestModal() {
    this.newRequest       = { data: '', tipo: 'entrata', ora: '', nota: '' };
    this.requestModalError = null;
    this.showRequestModal  = true;
  }

  closeRequestModal() { this.showRequestModal = false; this.requestModalError = null; }

  inviaRequest() {
    if (!this.newRequest.data || !this.newRequest.ora || !this.newRequest.nota?.trim()) {
      this.requestModalError = 'Tutti i campi sono obbligatori';
      return;
    }
    this.requestModalError = null;
    this.apiService.creaRequest(this.newRequest).subscribe({
      next: () => { this.closeRequestModal(); this.loadMieRequests(); },
      error: (err) => { this.requestModalError = err.error?.message ?? 'Errore durante l\'invio'; this.cdr.detectChanges(); },
    });
  }

  statoLabel(stato: string): string {
    return { pendente: 'In attesa', approvata: 'Approvata', rifiutata: 'Rifiutata' }[stato] ?? stato;
  }


  // ─── Utility ──────────────────────────────────────────────────────────────

  formatTimestamp(ts: string): { data: string; ora: string } {
    const d = new Date(ts);
    return {
      data: d.toLocaleDateString('it-IT'),
      ora:  d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
    };
  }

  private getPeriodoApi(): string {
    if (this.meseSelezionato == null) return String(this.annoSelezionato);
    return `${this.annoSelezionato}-${String(this.meseSelezionato).padStart(2, '0')}`;
  }

  private formatDurata(minuti: number): string {
    if (minuti <= 0) return '0h 0min';
    const h = Math.floor(minuti / 60);
    const m = minuti % 60;
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  }

  private escapeCsv(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
  }
}
