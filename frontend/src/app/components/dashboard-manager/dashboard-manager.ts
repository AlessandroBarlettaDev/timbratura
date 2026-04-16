import { Component, ChangeDetectorRef, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet, TitleCasePipe, DecimalPipe } from '@angular/common';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/user-auth.service';

type Section = 'dashboard' | 'utenti' | 'stazioni' | 'richieste' | 'audit';

@Component({
  selector: 'app-dashboard-manager',
  imports: [FormsModule, NgTemplateOutlet, TitleCasePipe, DecimalPipe],
  templateUrl: './dashboard-manager.html',
  styleUrl: '../../app.css',
})
export class DashboardManager implements OnInit {

  // ─── Layout ───────────────────────────────────────────────────────────────
  activeSection: Section = 'dashboard';
  sidebarOpen = false;
  isLoading   = false;

  // ─── Dashboard odierna ────────────────────────────────────────────────────
  dashboardStazioni:    any[] = [];
  dashboardLoading          = false;
  dashboardAggiornatoAlle   = '';

  // ─── Utenti ───────────────────────────────────────────────────────────────
  utenti:       any[] = [];
  selectedUser: any   = null;

  showModal  = false;
  modalError: string | null = null;
  newUser    = { email: '', nome: '', cognome: '', birthdate: '', codice_fiscale: '', ruolo: 'employee' };

  showEditModal     = false;
  editUser: any     = {};
  showDeleteConfirm = false;

  // ─── Richieste ────────────────────────────────────────────────────────────
  richieste:          any[] = [];
  richiesteLoading          = false;

  showApprovaModal              = false;
  approvaModalRichiesta: any    = null;
  approvaModalTimbrature: any[] = [];
  approvaModalLoading           = false;
  approvaModalError: string | null = null;
  approvaModalAltreRichieste: any[] = [];

  showRifiutaModal          = false;
  richiestaSelezionata: any = null;
  motivoRifiuto             = '';
  rifiutaModalError: string | null = null;

  // ─── Stazioni ─────────────────────────────────────────────────────────────
  stazioni:         any[] = [];
  selectedStazione: any   = null;

  showStazioneModal         = false;
  newStazione               = { descrizione: '', password: '' };
  stazioneModalError: string | null = null;
  stazioneToDelete:   any   = null;
  showDeleteStazioneConfirm = false;

  // ─── Contratti ────────────────────────────────────────────────────────────
  contratti:              any[] = [];
  contrattiLoading              = false;
  dettagliUtenteOpen            = false;
  contrattoOpen                 = false;
  showContrattoModal            = false;
  contrattoModalError: string | null = null;
  newContratto: any             = {};
  showEditContrattoModal        = false;
  editContratto: any            = {};
  editContrattoId               = '';

  // ─── Timbrature ───────────────────────────────────────────────────────────
  timbrature:    any[]  = [];
  timbratureLoading     = false;
  annoSelezionato       = new Date().getFullYear();
  meseSelezionato: number | null = new Date().getMonth() + 1;
  readonly mesi = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

  // ─── Audit Trail ──────────────────────────────────────────────────────────
  auditRecords:       any[] = [];
  auditLoading              = false;
  auditFilterActor: string | null = null;
  auditFilterEntity: { type: string; id: string } | null = null;
  auditDataInizio           = new Date(Date.now() - 7 * 24 * 3600_000).toISOString().split('T')[0];
  auditDataFine             = new Date().toISOString().split('T')[0];

  constructor(private apiService: ApiService, public authService: AuthService, private cdr: ChangeDetectorRef) {}

  ngOnInit() { this.loadDashboard(); }


  // ─── Navigazione ──────────────────────────────────────────────────────────

  setSection(section: Section) {
    this.selectedUser     = null;
    this.selectedStazione = null;
    this.activeSection    = section;
    this.sidebarOpen      = false;
    if (section === 'dashboard')  this.loadDashboard();
    if (section === 'utenti'    && this.utenti.length    === 0) this.loadUtenti();
    if (section === 'stazioni'  && this.stazioni.length  === 0) this.loadStazioni();
    if (section === 'richieste') this.loadRichieste();
    if (section === 'audit') this.loadAuditTrail();
  }

  // Apre il profilo del manager loggato nella sezione utenti
  apriProfilo() {
    const me = this.authService.utente();
    if (!me) return;
    this.activeSection = 'utenti';
    this.sidebarOpen   = false;
    this.selectUser({ id: me.userId });
  }


  // ─── Dashboard ────────────────────────────────────────────────────────────

  loadDashboard() {
    this.dashboardLoading  = true;
    this.dashboardStazioni = [];
    this.apiService.getDashboardOggi().subscribe({
      next: (data) => {
        this.dashboardStazioni       = data;
        this.dashboardLoading        = false;
        this.dashboardAggiornatoAlle = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        this.cdr.detectChanges();
      },
      error: (err) => { console.error('Errore dashboard:', err); this.dashboardLoading = false; this.cdr.detectChanges(); },
    });
  }

  // Per ogni userId prende l'ultima timbratura di oggi e controlla se è un'entrata
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


  // ─── Utenti ───────────────────────────────────────────────────────────────

  loadUtenti() {
    this.isLoading = true;
    this.utenti    = [];
    this.apiService.getUsers().subscribe({
      next: (data) => { this.utenti = data; this.isLoading = false; this.cdr.detectChanges(); },
      error: (err)  => { console.error('Errore caricamento utenti:', err); this.isLoading = false; this.cdr.detectChanges(); },
    });
  }

  selectUser(user: any) {
    this.apiService.getUser(user.id).subscribe({
      next: (data) => {
        this.selectedUser = data;
        this.resetPeriodoTimbrature();
        this.loadTimbrature(data.id);
        this.loadContratti(data.id);
        this.cdr.detectChanges();
      },
      error: (err) => console.error('Errore caricamento utente:', err),
    });
  }

  backToList() {
    this.selectedUser       = null;
    this.timbrature         = [];
    this.contratti          = [];
    this.dettagliUtenteOpen = false;
    this.contrattoOpen      = false;
  }

  openModal() {
    this.newUser    = { email: '', nome: '', cognome: '', birthdate: '', codice_fiscale: '', ruolo: 'employee' };
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

  openEditModal() {
    this.editUser = {
      nome:           this.selectedUser.given_name,
      cognome:        this.selectedUser.family_name,
      birthdate:      this.selectedUser.birthdate      ?? '',
      codice_fiscale: this.selectedUser.codice_fiscale ?? '',
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


  // ─── Contratti ────────────────────────────────────────────────────────────

  loadContratti(userId: string) {
    this.contrattiLoading = true;
    this.contratti        = [];
    this.apiService.getContracts(userId).subscribe({
      next: (data) => { this.contratti = data; this.contrattiLoading = false; this.cdr.detectChanges(); },
      error: (err)  => { console.error('Errore contratti:', err); this.contrattiLoading = false; this.cdr.detectChanges(); },
    });
  }

  get contrattoAttivo(): any | null { return this.contratti[0] ?? null; }

  openNuovoContrattoModal() {
    this.newContratto        = { userId: this.selectedUser.id, tipoContratto: 'indeterminato', dataInizio: '' };
    this.contrattoModalError = null;
    this.showContrattoModal  = true;
  }

  closeContrattoModal() { this.showContrattoModal = false; this.contrattoModalError = null; }

  onTipoContrattoChange(c: any) {
    if (c.tipoContratto === 'indeterminato') delete c.dataFine;
  }

  private validateContratto(c: any): string | null {
    if (!c.dataInizio) return 'La data di inizio è obbligatoria';
    if (c.tipoContratto !== 'indeterminato' && c.dataFine && c.dataFine < c.dataInizio)
      return 'La data di fine deve essere successiva alla data di inizio';
    if (c.oreSett != null && c.oreSett !== '') {
      const v = Number(c.oreSett);
      if (v <= 0 || v > 80) return 'Le ore settimanali devono essere tra 1 e 80';
    }
    if (c.giorniSett != null && c.giorniSett !== '') {
      const v = Number(c.giorniSett);
      if (v < 1 || v > 7 || !Number.isInteger(v)) return 'I giorni settimanali devono essere tra 1 e 7';
    }
    if (c.retribuzioneLorda != null && c.retribuzioneLorda !== '') {
      if (Number(c.retribuzioneLorda) <= 0) return 'La retribuzione lorda deve essere maggiore di zero';
    }
    if (c.retribuzioneNetta != null && c.retribuzioneNetta !== '') {
      if (Number(c.retribuzioneNetta) <= 0) return 'La retribuzione netta deve essere maggiore di zero';
      if (c.retribuzioneLorda != null && c.retribuzioneLorda !== '' && Number(c.retribuzioneNetta) > Number(c.retribuzioneLorda))
        return 'La retribuzione netta non può superare quella lorda';
    }
    if (c.periodoDiProva != null && c.periodoDiProva !== '') {
      const v = Number(c.periodoDiProva);
      if (v < 0 || v > 24) return 'Il periodo di prova deve essere tra 0 e 24 mesi';
    }
    if (c.giorniFerie != null && c.giorniFerie !== '') {
      const v = Number(c.giorniFerie);
      if (v < 0 || v > 365) return 'I giorni di ferie devono essere tra 0 e 365';
    }
    if (c.permessiOre != null && c.permessiOre !== '') {
      if (Number(c.permessiOre) < 0) return 'Le ore di permesso non possono essere negative';
    }
    return null;
  }

  salvaContratto() {
    const err = this.validateContratto(this.newContratto);
    if (err) { this.contrattoModalError = err; return; }
    this.contrattoModalError = null;
    this.apiService.createContract(this.newContratto).subscribe({
      next: () => { this.closeContrattoModal(); this.loadContratti(this.selectedUser.id); },
      error: (err) => { this.contrattoModalError = err.error?.message ?? 'Errore durante la creazione'; this.cdr.detectChanges(); },
    });
  }

  openEditContrattoModal(c: any) {
    this.editContrattoId     = c.contractId;
    this.editContratto       = { ...c };
    this.contrattoModalError = null;
    this.showEditContrattoModal = true;
  }

  salvaModificaContratto() {
    const err = this.validateContratto(this.editContratto);
    if (err) { this.contrattoModalError = err; return; }
    this.contrattoModalError = null;
    const { contractId, userId, createdAt, ...payload } = this.editContratto;
    this.apiService.updateContract(this.editContrattoId, payload).subscribe({
      next: () => { this.showEditContrattoModal = false; this.loadContratti(this.selectedUser.id); },
      error: (err) => { this.contrattoModalError = err.error?.message ?? 'Errore durante la modifica'; this.cdr.detectChanges(); },
    });
  }

  eliminaContratto(contractId: string) {
    this.apiService.deleteContract(contractId).subscribe({
      next: () => this.loadContratti(this.selectedUser.id),
      error: (err) => console.error('Errore eliminazione contratto:', err),
    });
  }

  tipoContrattoLabel(tipo: string): string {
    return { indeterminato: 'Indeterminato', determinato: 'Determinato', part_time: 'Part-time', apprendistato: 'Apprendistato', stage: 'Stage' }[tipo] ?? tipo;
  }


  // ─── Richieste ────────────────────────────────────────────────────────────

  loadRichieste() {
    this.richiesteLoading = true;
    this.richieste        = [];
    this.apiService.getRequestsPendenti().subscribe({
      next: (data) => { this.richieste = data; this.richiesteLoading = false; this.cdr.detectChanges(); },
      error: (err)  => { console.error('Errore richieste:', err); this.richiesteLoading = false; this.cdr.detectChanges(); },
    });
  }

  approvaRichiesta(r: any) {
    this.approvaModalRichiesta       = r;
    this.approvaModalTimbrature      = [];
    this.approvaModalAltreRichieste  = [];
    this.approvaModalLoading         = true;
    this.approvaModalError           = null;
    this.showApprovaModal            = true;

    // Altre richieste pendenti dello stesso utente per lo stesso giorno
    this.approvaModalAltreRichieste = this.richieste.filter(
      p => p.requestId !== r.requestId && p.userId === r.userId && p.data === r.data
    ).sort((a: any, b: any) => a.ora.localeCompare(b.ora));

    const mese = r.data.slice(0, 7);
    this.apiService.getTimbratureUtente(r.userId, mese).subscribe({
      next: (data) => {
        this.approvaModalTimbrature = data
          .filter((t: any) => t.timestamp?.startsWith(r.data))
          .sort((a: any, b: any) => a.timestamp.localeCompare(b.timestamp));
        this.approvaModalLoading = false;
        this.cdr.detectChanges();
      },
      error: () => { this.approvaModalLoading = false; this.cdr.detectChanges(); },
    });
  }

  confermaApprova() {
    this.approvaModalError = null;
    this.apiService.approvaRequest(this.approvaModalRichiesta.requestId).subscribe({
      next: () => { this.showApprovaModal = false; this.loadRichieste(); },
      error: (err) => {
        this.approvaModalError = err.error?.message ?? 'Errore durante l\'approvazione';
        this.cdr.detectChanges();
      },
    });
  }

  apriRifiutaModal(r: any) {
    this.richiestaSelezionata = r;
    this.motivoRifiuto        = '';
    this.rifiutaModalError    = null;
    this.showRifiutaModal     = true;
  }

  confermaRifiuto() {
    if (!this.motivoRifiuto.trim()) { this.rifiutaModalError = 'Il motivo è obbligatorio'; return; }
    this.apiService.rifiutaRequest(this.richiestaSelezionata.requestId, this.motivoRifiuto).subscribe({
      next: () => { this.showRifiutaModal = false; this.loadRichieste(); },
      error: (err) => { this.rifiutaModalError = err.error?.message ?? 'Errore'; this.cdr.detectChanges(); },
    });
  }

  get richiestePendentiCount(): number {
    return this.richieste.filter(r => r.stato === 'pendente').length;
  }

  statoLabel(stato: string): string {
    return { pendente: 'In attesa', approvata: 'Approvata', rifiutata: 'Rifiutata' }[stato] ?? stato;
  }


  // ─── Stazioni ─────────────────────────────────────────────────────────────

  loadStazioni() {
    this.isLoading = true;
    this.stazioni  = [];
    this.apiService.getStazioni().subscribe({
      next: (data) => { this.stazioni = data; this.isLoading = false; this.cdr.detectChanges(); },
      error: (err)  => { console.error('Errore caricamento stazioni:', err); this.isLoading = false; this.cdr.detectChanges(); },
    });
  }

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


  // ─── Timbrature — caricamento e periodo ───────────────────────────────────

  loadTimbrature(userId: string) {
    this.timbratureLoading = true;
    this.apiService.getTimbratureUtente(userId, this.getPeriodoApi()).subscribe({
      next: (data) => { this.timbrature = data; this.timbratureLoading = false; this.cdr.detectChanges(); },
      error: (err)  => { console.error('Errore caricamento timbrature:', err); this.timbratureLoading = false; this.cdr.detectChanges(); },
    });
  }

  cambiaPeriodo() {
    if (this.selectedUser?.id) this.loadTimbrature(this.selectedUser.id);
  }

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


  // ─── Timbrature — statistiche ─────────────────────────────────────────────

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

  get turni(): { data: string; entrata: string; uscita: string | null; durata: string | null; sede: string }[] {
    const perGiorno = new Map<string, any[]>();
    for (const t of this.timbrature) {
      const giorno = t.timestamp?.slice(0, 10);
      if (!giorno) continue;
      if (!perGiorno.has(giorno)) perGiorno.set(giorno, []);
      perGiorno.get(giorno)!.push(t);
    }

    const risultato: { data: string; entrata: string; uscita: string | null; durata: string | null; sede: string }[] = [];

    const giorni = [...perGiorno.keys()].sort((a, b) => b.localeCompare(a));
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


  // ─── Timbrature — export Excel ────────────────────────────────────────────

  scaricaTimbratureExcel() {
    if (this.timbrature.length === 0) return;

    const u    = this.selectedUser;
    const c    = this.contrattoAttivo;
    const nome = `${u?.given_name ?? ''} ${u?.family_name ?? ''}`.trim();
    const mm   = this.meseSelezionato ? `-${String(this.meseSelezionato).padStart(2, '0')}` : '-annuale';
    const slug = nome.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const e    = (v: string) => this.escapeCsv(v);

    const sezioni: string[] = [];

    // ── ANAGRAFICA ────────────────────────────────────────────────────────────
    sezioni.push(
      [e('=== ANAGRAFICA ==='), ''].join(';'),
      [e('Dipendente'),    e(nome)].join(';'),
      ...(u?.email          ? [[e('Email'),          e(u.email)].join(';')]          : []),
      ...(u?.codice_fiscale ? [[e('Codice fiscale'),  e(u.codice_fiscale)].join(';')] : []),
      '',
    );

    // ── CONTRATTO ─────────────────────────────────────────────────────────────
    if (c) {
      const tl = (t: string) => ({ indeterminato: 'Indeterminato', determinato: 'Determinato', part_time: 'Part-time', apprendistato: 'Apprendistato', stage: 'Stage' }[t] ?? t);
      sezioni.push(
        [e('=== CONTRATTO ==='), ''].join(';'),
        [e('Tipo'),        e(tl(c.tipoContratto))].join(';'),
        [e('Data inizio'), e(c.dataInizio)].join(';'),
        [e('Data fine'),   e(c.dataFine || '—')].join(';'),
        ...(c.oreSett            ? [[e('Ore sett.'),       e(`${c.oreSett}h`)].join(';')]                  : []),
        ...(c.giorniSett         ? [[e('Giorni sett.'),    e(String(c.giorniSett))].join(';')]              : []),
        ...(c.retribuzioneLorda  ? [[e('Lordo mensile'),   e(`${c.retribuzioneLorda.toLocaleString('it-IT')} €`)].join(';')]  : []),
        ...(c.retribuzioneNetta  ? [[e('Netto mensile'),   e(`${c.retribuzioneNetta.toLocaleString('it-IT')} €`)].join(';')]  : []),
        ...(c.livello            ? [[e('Livello'),         e(c.livello)].join(';')]                         : []),
        ...(c.mansione           ? [[e('Mansione'),        e(c.mansione)].join(';')]                        : []),
        ...(c.ccnl               ? [[e('CCNL'),            e(c.ccnl)].join(';')]                            : []),
        ...(c.giorniFerie        ? [[e('Ferie annuali'),   e(`${c.giorniFerie} gg`)].join(';')]             : []),
        ...(c.permessiOre        ? [[e('Permessi ROL'),    e(`${c.permessiOre}h`)].join(';')]               : []),
        '',
      );
    }

    // ── ANALISI PERIODO ───────────────────────────────────────────────────────
    if (c?.oreSett) {
      const minutiLavorati     = this.calcolaMinutiLavorati(this.timbrature);
      const giorniLavAtt       = this.countWorkingDays(this.annoSelezionato, this.meseSelezionato);
      const orePerGiorno       = c.oreSett / (c.giorniSett ?? 5);
      const minutiAttesi       = Math.round(giorniLavAtt * orePerGiorno * 60);
      const minutiStraord      = Math.max(0, minutiLavorati - minutiAttesi);
      const minutiMancanti     = Math.max(0, minutiAttesi - minutiLavorati);
      const retribOraria       = c.retribuzioneLorda ? c.retribuzioneLorda / (c.oreSett * 52 / 12) : null;
      const importoStraord     = retribOraria ? (minutiStraord / 60) * retribOraria : null;

      sezioni.push(
        [e('=== ANALISI PERIODO ==='), ''].join(';'),
        [e('Periodo'),                     e(this.periodoLabel)].join(';'),
        [e('Giorni lavorativi attesi'),    e(String(giorniLavAtt))].join(';'),
        [e('Ore contrattuali attese'),     e(this.formatDurata(minutiAttesi))].join(';'),
        [e('Ore effettivamente lavorate'), e(this.formatDurata(minutiLavorati))].join(';'),
        [e('Ore straordinarie'),           e(minutiStraord > 0 ? this.formatDurata(minutiStraord) : '—')].join(';'),
        [e('Ore mancanti'),                e(minutiMancanti > 0 ? this.formatDurata(minutiMancanti) : '—')].join(';'),
        ...(retribOraria             ? [[e('Retribuzione oraria lorda'),   e(`${retribOraria.toFixed(2).replace('.', ',')} €`)].join(';')]              : []),
        ...(c.retribuzioneNetta && this.meseSelezionato != null ? [[e('Stipendio base netto'), e(`${c.retribuzioneNetta.toLocaleString('it-IT')} €`)].join(';')] : []),
        ...(importoStraord != null && minutiStraord > 0 ? [[e('Importo straordinari lordo (indicativo)'), e(`${importoStraord.toFixed(2).replace('.', ',')} €`)].join(';')] : []),
        [e('* I festivi non sono inclusi nel conteggio dei giorni lavorativi'), ''].join(';'),
        '',
      );
    }

    // ── TURNI ─────────────────────────────────────────────────────────────────
    sezioni.push(
      [e('=== TURNI ==='), ''].join(';'),
      ['Data', 'Entrata', 'Uscita', 'Durata', 'Ore decimali', 'Sede'].map(e).join(';'),
      ...this.turni.map(t => [
        t.data,
        t.entrata,
        t.uscita ?? '—',
        t.durata ?? '—',
        this.durataToDecimal(t.durata),
        t.sede,
      ].map(v => e(v)).join(';')),
    );

    const csv  = '\ufeff' + sezioni.join('\n');
    const blob = new Blob([csv], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const link = document.createElement('a');
    link.href  = URL.createObjectURL(blob);
    link.download = `timbrature-${slug}-${this.annoSelezionato}${mm}.xls`;
    link.click();
    URL.revokeObjectURL(link.href);
  }


  // ─── Audit Trail ──────────────────────────────────────────────────────────

  loadAuditTrail() {
    this.auditLoading  = true;
    this.auditRecords  = [];
    const params = new URLSearchParams({
      from:  this.auditDataInizio,
      to:    this.auditDataFine,
      limit: '100',
    });
    this.apiService.getAuditTrail(params.toString()).subscribe({
      next: (data) => {
        this.auditRecords = data.records || [];
        this.auditLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Errore caricamento audit trail:', err);
        this.auditLoading = false;
        this.cdr.detectChanges();
      },
    });
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

  private resetPeriodoTimbrature() {
    const adesso = new Date();
    this.annoSelezionato = adesso.getFullYear();
    this.meseSelezionato = adesso.getMonth() + 1;
  }

  private formatDurata(minuti: number): string {
    if (minuti <= 0) return '0h 0min';
    const h = Math.floor(minuti / 60);
    const m = minuti % 60;
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  }

  private durataToDecimal(durata: string | null): string {
    if (!durata) return '';
    const h = durata.match(/(\d+)h/);
    const m = durata.match(/(\d+)min/);
    const tot = (h ? parseInt(h[1]) * 60 : 0) + (m ? parseInt(m[1]) : 0);
    return (tot / 60).toFixed(2).replace('.', ',');
  }

  private countWorkingDays(anno: number, mese: number | null): number {
    if (mese == null) {
      return Array.from({ length: 12 }, (_, i) => this.countWorkingDays(anno, i + 1))
                  .reduce((a, b) => a + b, 0);
    }
    let count = 0;
    const days = new Date(anno, mese, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const dow = new Date(anno, mese - 1, d).getDay();
      if (dow !== 0 && dow !== 6) count++;
    }
    return count;
  }

  private escapeCsv(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
  }
}
