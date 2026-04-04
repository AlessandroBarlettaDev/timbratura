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
  profile: any = null;
  profileLoading = false;

  // Timbrature
  timbrature: any[] = [];
  readonly mesi = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
  annoSelezionato = new Date().getFullYear();
  meseSelezionato: number | null = new Date().getMonth() + 1;
  timbratureLoading = false;

  constructor(private apiService: ApiService, public authService: AuthService, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    // Aspetta che la sessione Cognito sia caricata prima di caricare il profilo
    // (necessario quando si arriva da pagine pubbliche come /timbratura)
    this.authService.checkCurrentSession().then(() => {
      console.log('[employee] sessione caricata, utente:', this.authService.utente());
      this.loadProfile();
    });
  }

  private loadProfile() {
    const me = this.authService.utente();
    console.log('[employee] loadProfile, utente:', me);
    if (!me) { console.warn('[employee] utente null — profilo non caricato'); return; }
    this.profileLoading = true;
    this.apiService.getUser(me.userId).subscribe({
      next: (data) => {
        console.log('[employee] profilo caricato:', data);
        this.profile      = data;
        this.profileLoading = false;
        this.loadTimbrature();
        this.cdr.detectChanges();
      },
      error: (err) => { console.error('[employee] errore profilo:', err); this.profileLoading = false; this.cdr.detectChanges(); },
    });
  }

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

  deselezionaMese()       { this.meseSelezionato = null;                    this.cambiaPeriodo(); }
  selezionaMeseCorrente() { this.meseSelezionato = new Date().getMonth() + 1; this.cambiaPeriodo(); }

  get meseLabel(): string {
    if (this.meseSelezionato == null) return 'Tutto l\'anno';
    return this.mesi[this.meseSelezionato - 1];
  }

  get periodoLabel(): string {
    return this.meseSelezionato == null ? `${this.annoSelezionato}` : `${this.meseLabel} ${this.annoSelezionato}`;
  }

  // Calcola se il dipendente è presente ora, basandosi sull'ultima timbratura di oggi
  get presenteOra(): boolean | null {
    const oggi = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const timbratureOggi = this.timbrature.filter(t => t.timestamp?.startsWith(oggi));
    if (timbratureOggi.length === 0) return null;
    return timbratureOggi[timbratureOggi.length - 1].tipo === 'entrata';
  }

  scaricaTimbratureExcel() {
    if (this.timbrature.length === 0) return;
    const intestazione = ['Tipo', 'Data', 'Ora', 'Stazione'];
    const righe = this.timbrature.map((t) => {
      const f = this.formatTimestamp(t.timestamp);
      return [String(t.tipo ?? ''), f.data, f.ora, String(t.stationId ?? '')];
    });
    const csv  = ['\ufeff' + intestazione.join(';'), ...righe.map(r => r.map(v => this.escapeCsv(v)).join(';'))].join('\n');
    const blob = new Blob([csv], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const link = document.createElement('a');
    const mm   = this.meseSelezionato ? `-${String(this.meseSelezionato).padStart(2, '0')}` : '-annuale';
    const nomeUtente = `${this.profile?.given_name ?? ''}-${this.profile?.family_name ?? ''}`;
    const slug = nomeUtente.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    link.href  = URL.createObjectURL(blob);
    link.download = `timbrature-${slug}-${this.annoSelezionato}${mm}.xls`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  private getPeriodoApi(): string {
    if (this.meseSelezionato == null) return String(this.annoSelezionato);
    return `${this.annoSelezionato}-${String(this.meseSelezionato).padStart(2, '0')}`;
  }

  private escapeCsv(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
  }

  formatTimestamp(ts: string): { data: string; ora: string } {
    const d = new Date(ts);
    return {
      data: d.toLocaleDateString('it-IT'),
      ora:  d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
    };
  }
}
