import { Component, ChangeDetectorRef, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet, TitleCasePipe } from '@angular/common';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/user-auth.service';

type Section = 'dashboard' | 'utenti' | 'stazioni';

@Component({
  selector: 'app-dashboard-manager',
  imports: [FormsModule, NgTemplateOutlet, TitleCasePipe],
  templateUrl: './dashboard-manager.html',
  styleUrl: '../../app.css',
})
export class DashboardManager implements OnInit {
  activeSection: Section = 'dashboard';
  sidebarOpen = false;
  utenti:   any[] = [];
  stazioni: any[] = [];
  selectedUser:     any = null;
  selectedStazione: any = null;
  isLoading    = false;

  // --- Stato modale nuovo utente ---
  showModal  = false;
  newUser    = { email: '', nome: '', cognome: '', birthdate: '', codice_fiscale: '', data_assunzione: '', termine_contratto: '', ruolo: 'employee' };
  modalError: string | null = null;

  // --- Stato modifica/elimina utente ---
  showEditModal     = false;
  editUser: any     = {};
  showDeleteConfirm = false;

  // --- Stato sezione stazioni ---
  showStazioneModal         = false;
  newStazione               = { descrizione: '', password: '' };
  stazioneModalError: string | null = null;
  stazioneToDelete:   any   = null;
  showDeleteStazioneConfirm = false;

  // --- Dashboard odierna ---
  dashboardStazioni: any[]  = [];
  dashboardLoading          = false;
  dashboardAggiornatoAlle   = '';

  // --- Timbrature (usato sia nel profilo manager che nel dettaglio utente) ---
  timbrature:    any[]  = [];
  readonly mesi = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
  annoSelezionato = new Date().getFullYear();
  meseSelezionato: number | null = new Date().getMonth() + 1;
  timbratureLoading     = false;

  constructor(private apiService: ApiService, public authService: AuthService, private cdr: ChangeDetectorRef) {}

  ngOnInit() { this.loadDashboard(); }

  // --- Navigazione ---
  setSection(section: Section) {
    this.selectedUser     = null;
    this.selectedStazione = null;
    this.activeSection    = section;
    this.sidebarOpen      = false;
    if (section === 'dashboard') this.loadDashboard();
    if (section === 'utenti'   && this.utenti.length   === 0) this.loadUtenti();
    if (section === 'stazioni' && this.stazioni.length === 0) this.loadStazioni();
  }

  // Apre il profilo del manager loggato come se fosse un utente selezionato
  apriProfilo() {
    const me = this.authService.utente();
    if (!me) return;
    this.activeSection = 'utenti';
    this.sidebarOpen   = false;
    this.selectUser({ id: me.userId });
  }

  // --- Gestione utenti ---
  selectUser(user: any) {
    this.apiService.getUser(user.id).subscribe({
      next: (data) => {
        this.selectedUser = data;
        this.resetPeriodoTimbrature();
        this.loadTimbrature(data.id);
        this.cdr.detectChanges();
      },
      error: (err) => console.error('Errore caricamento utente:', err),
    });
  }

  backToList() { this.selectedUser = null; this.timbrature = []; }

  openEditModal() {
    this.editUser = {
      nome:              this.selectedUser.given_name,
      cognome:           this.selectedUser.family_name,
      birthdate:         this.selectedUser.birthdate         ?? '',
      codice_fiscale:    this.selectedUser.codice_fiscale    ?? '',
      data_assunzione:   this.selectedUser.data_assunzione   ?? '',
      termine_contratto: this.selectedUser.termine_contratto ?? '',
    };
    this.showEditModal = true;
  }

  saveEdit() {
    this.apiService.modifyUser(this.selectedUser.id, this.editUser).subscribe({
      next: () => { this.showEditModal = false; this.cdr.detectChanges(); this.selectUser({ id: this.selectedUser.id }); },
      error: (err) => console.error('Errore modifica utente:', err),
    });
  }

  confirmDelete() {
    this.apiService.deleteUser(this.selectedUser.id).subscribe({
      next: () => {
        this.showDeleteConfirm = false;
        this.selectedUser = null;
        this.timbrature   = [];
        this.utenti       = [];
        this.cdr.detectChanges();
        this.loadUtenti();
      },
      error: (err) => console.error('Errore eliminazione utente:', err),
    });
  }

  openModal() {
    this.newUser    = { email: '', nome: '', cognome: '', birthdate: '', codice_fiscale: '', data_assunzione: '', termine_contratto: '', ruolo: 'employee' };
    this.modalError = null;
    this.showModal  = true;
  }

  closeModal() { this.showModal = false; this.modalError = null; }

  addUser() {
    this.modalError = null;
    this.apiService.createUser(this.newUser).subscribe({
      next: ()     => { this.closeModal(); this.utenti = []; this.cdr.detectChanges(); this.loadUtenti(); },
      error: (err) => { this.modalError = err.error?.message ?? 'Errore durante la creazione'; this.cdr.detectChanges(); },
    });
  }

  loadUtenti() {
    this.isLoading = true;
    this.apiService.getUsers().subscribe({
      next: (data) => { this.utenti = data; this.isLoading = false; this.cdr.detectChanges(); },
      error: (err)  => { console.error('Errore caricamento utenti:', err); this.isLoading = false; this.cdr.detectChanges(); },
    });
  }

  // --- Dashboard odierna ---
  loadDashboard() {
    this.dashboardLoading = true;
    this.apiService.getDashboardOggi().subscribe({
      next: (data) => {
        this.dashboardStazioni      = data;
        this.dashboardLoading       = false;
        this.dashboardAggiornatoAlle = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        this.cdr.detectChanges();
      },
      error: (err) => { console.error('Errore dashboard:', err); this.dashboardLoading = false; this.cdr.detectChanges(); },
    });
  }

  // --- Timbrature ---
  loadTimbrature(userId: string) {
    this.timbratureLoading = true;
    this.apiService.getTimbratureUtente(userId, this.getPeriodoApi()).subscribe({
      next: (data) => { this.timbrature = data; this.timbratureLoading = false; this.cdr.detectChanges(); },
      error: (err)  => { console.error('Errore caricamento timbrature:', err); this.timbratureLoading = false; this.cdr.detectChanges(); },
    });
  }

  cambiaPeriodo() {
    const userId = this.selectedUser?.id;
    if (userId) this.loadTimbrature(userId);
  }

  annoPrecedente() { this.annoSelezionato--; this.cambiaPeriodo(); }
  annoSuccessivo() { this.annoSelezionato++; this.cambiaPeriodo(); }

  mesePrecedente() {
    if (this.meseSelezionato == null) {
      this.meseSelezionato = 12;
      this.cambiaPeriodo();
      return;
    }
    if (this.meseSelezionato === 1) {
      this.meseSelezionato = 12;
      this.annoSelezionato--;
    } else {
      this.meseSelezionato--;
    }
    this.cambiaPeriodo();
  }

  meseSuccessivo() {
    if (this.meseSelezionato == null) {
      this.meseSelezionato = 1;
      this.cambiaPeriodo();
      return;
    }
    if (this.meseSelezionato === 12) {
      this.meseSelezionato = 1;
      this.annoSelezionato++;
    } else {
      this.meseSelezionato++;
    }
    this.cambiaPeriodo();
  }

  deselezionaMese() {
    this.meseSelezionato = null;
    this.cambiaPeriodo();
  }

  selezionaMeseCorrente() {
    this.meseSelezionato = new Date().getMonth() + 1;
    this.cambiaPeriodo();
  }

  get meseLabel(): string {
    if (this.meseSelezionato == null) return 'Tutto l\'anno';
    return this.mesi[this.meseSelezionato - 1];
  }

  get periodoLabel(): string {
    return this.meseSelezionato == null
      ? `${this.annoSelezionato}`
      : `${this.meseLabel} ${this.annoSelezionato}`;
  }

  scaricaTimbratureExcel() {
    if (this.timbrature.length === 0) return;

    const intestazione = ['Tipo', 'Data', 'Ora', 'Stazione'];
    const righe = this.timbrature.map((t) => {
      const f = this.formatTimestamp(t.timestamp);
      return [
        String(t.tipo ?? ''),
        f.data,
        f.ora,
        String(t.stationId ?? ''),
      ];
    });

    const csv = ['\ufeff' + intestazione.join(';'), ...righe.map(r => r.map(v => this.escapeCsv(v)).join(';'))].join('\n');
    const blob = new Blob([csv], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const link = document.createElement('a');
    const mm   = this.meseSelezionato ? `-${String(this.meseSelezionato).padStart(2, '0')}` : '-annuale';
    // Nome utente dal profilo manager o dal dipendente selezionato
    const nomeUtente = `${this.selectedUser?.given_name ?? ''}-${this.selectedUser?.family_name ?? ''}`;
    const slug = nomeUtente.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    link.href = URL.createObjectURL(blob);
    link.download = `timbrature-${slug}-${this.annoSelezionato}${mm}.xls`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  private getPeriodoApi(): string {
    if (this.meseSelezionato == null) return String(this.annoSelezionato);
    return `${this.annoSelezionato}-${String(this.meseSelezionato).padStart(2, '0')}`;
  }

  private resetPeriodoTimbrature() {
    const adesso = new Date();
    this.annoSelezionato = adesso.getFullYear();
    this.meseSelezionato = adesso.getMonth() + 1;
  }

  private escapeCsv(value: string): string {
    const escaped = value.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  formatTimestamp(ts: string): { data: string; ora: string } {
    const d = new Date(ts);
    return {
      data: d.toLocaleDateString('it-IT'),
      ora:  d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
    };
  }

  // --- Statistiche timbrature del periodo selezionato ---

  get oreLavorate(): string {
    const minuti = this.calcolaMinutiLavorati(this.timbrature);
    return this.formatDurata(minuti);
  }

  get mediaGiornaliera(): string {
    const giorni = this.giorniConPresenza(this.timbrature);
    if (giorni === 0) return '—';
    const minuti = this.calcolaMinutiLavorati(this.timbrature);
    return this.formatDurata(Math.round(minuti / giorni));
  }

  get giorniLavorati(): number {
    return this.giorniConPresenza(this.timbrature);
  }

  private calcolaMinutiLavorati(timbrature: any[]): number {
    // Raggruppa per giorno, poi calcola coppie entrata/uscita
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
    const giorni = new Set(timbrature.map(t => t.timestamp?.slice(0, 10)).filter(Boolean));
    return giorni.size;
  }

  private formatDurata(minuti: number): string {
    if (minuti <= 0) return '0h 0min';
    const h = Math.floor(minuti / 60);
    const m = minuti % 60;
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  }

  // --- Gestione stazioni ---
  selectStazione(stazione: any) {
    this.apiService.getStazione(stazione.stationId).subscribe({
      next: (data) => { this.selectedStazione = data; this.cdr.detectChanges(); },
      error: (err)  => console.error('Errore caricamento stazione:', err),
    });
  }

  backToListStazioni() { this.selectedStazione = null; }

  openStazioneModal() {
    this.newStazione        = { descrizione: '', password: '' };
    this.stazioneModalError = null;
    this.showStazioneModal  = true;
  }

  closeStazioneModal() { this.showStazioneModal = false; this.stazioneModalError = null; }

  addStazione() {
    this.stazioneModalError = null;
    this.apiService.createStazione(this.newStazione).subscribe({
      next: ()     => { this.closeStazioneModal(); this.stazioni = []; this.cdr.detectChanges(); this.loadStazioni(); },
      error: (err) => { this.stazioneModalError = err.error?.message ?? 'Errore durante la creazione'; this.cdr.detectChanges(); },
    });
  }

  richiediEliminaStazione(stazione: any) {
    this.stazioneToDelete          = stazione;
    this.showDeleteStazioneConfirm = true;
  }

  confirmDeleteStazione() {
    const id = this.stazioneToDelete?.stationId ?? this.selectedStazione?.stationId;
    this.apiService.deleteStazione(id).subscribe({
      next: () => {
        this.showDeleteStazioneConfirm = false;
        this.stazioneToDelete          = null;
        this.selectedStazione          = null;
        this.stazioni = [];
        this.cdr.detectChanges();
        this.loadStazioni();
      },
      error: (err) => console.error('Errore eliminazione stazione:', err),
    });
  }

  loadStazioni() {
    this.isLoading = true;
    this.apiService.getStazioni().subscribe({
      next: (data) => { this.stazioni = data; this.isLoading = false; this.cdr.detectChanges(); },
      error: (err)  => { console.error('Errore caricamento stazioni:', err); this.isLoading = false; this.cdr.detectChanges(); },
    });
  }

  // Restituisce un Set di userId attualmente presenti, calcolato dalla dashboard odierna
  get presentiOggiSet(): Set<string> {
    const presenti = new Set<string>();
    for (const stazione of this.dashboardStazioni) {
      const ultimaPerUtente = new Map<string, any>();
      for (const t of stazione.timbrature ?? []) {
        const attuale = ultimaPerUtente.get(t.userId);
        if (!attuale || t.timestamp > attuale.timestamp) ultimaPerUtente.set(t.userId, t);
      }
      for (const t of ultimaPerUtente.values()) {
        if (t.tipo === 'entrata') presenti.add(t.userId);
      }
    }
    return presenti;
  }
}
