import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { startAuthentication } from '@simplewebauthn/browser';
import { ApiService } from '../../services/api.service';

type Step = 'verifica' | 'biometrica' | 'conferma' | 'errore';

@Component({
  selector: 'app-timbratura',
  imports: [],
  templateUrl: './timbratura.html',
  styleUrl: '../../app.css',
})
export class Timbratura implements OnInit {
  step: Step   = 'verifica';
  tipo         = '';   // 'entrata' o 'uscita' — determinato dal backend
  nome         = '';
  cognome      = '';
  errore       = '';
  caricamento  = false;

  private stationId    = '';
  private qrToken      = '';
  private expiresAt    = '';
  private confirmToken = '';

  constructor(
    private route:  ActivatedRoute,
    private router: Router,
    private api:    ApiService,
  ) {}

  ngOnInit() {
    this.stationId = this.route.snapshot.queryParamMap.get('s')   ?? '';
    this.qrToken   = this.route.snapshot.queryParamMap.get('t')   ?? '';
    this.expiresAt = this.route.snapshot.queryParamMap.get('exp') ?? '';

    if (!this.stationId || !this.qrToken || !this.expiresAt) {
      this.mostraErrore('QR non valido. Scansiona di nuovo il codice.');
      return;
    }

    if (Math.floor(Date.now() / 1000) > parseInt(this.expiresAt)) {
      this.mostraErrore('QR scaduto. Attendi che la stazione si aggiorni (ogni 3 minuti).');
      return;
    }

    this.step = 'biometrica';
  }

  // Step 1 — verifica biometrica, ottieni anteprima tipo
  async confermaIdentita() {
    this.caricamento = true;
    this.errore      = '';

    try {
      const { options, sessionId } = await new Promise<any>((resolve, reject) => {
        this.api.startBiometricAuthentication().subscribe({ next: resolve, error: reject });
      });

      const assertion = await startAuthentication({ optionsJSON: options, useBrowserAutofill: false });

      const result = await new Promise<any>((resolve, reject) => {
        this.api.anteprimaTimbratura({
          stationId: this.stationId,
          qrToken:   this.qrToken,
          expiresAt: this.expiresAt,
          assertion,
          sessionId,
        }).subscribe({ next: resolve, error: reject });
      });

      this.tipo         = result.tipo;
      this.nome         = result.nome;
      this.cognome      = result.cognome;
      this.confirmToken = result.confirmToken;
      this.step         = 'conferma';

    } catch (err: any) {
      this.mostraErrore(err?.error?.message ?? err?.message ?? 'Errore durante la verifica');
    } finally {
      this.caricamento = false;
    }
  }

  // Step 2 — salva definitivamente e vai alla dashboard
  async timbra() {
    this.caricamento = true;
    this.errore      = '';

    try {
      await new Promise<any>((resolve, reject) => {
        this.api.confermaTimbratura(this.confirmToken).subscribe({ next: resolve, error: reject });
      });
      this.router.navigate(['/dashboard-employee']);

    } catch (err: any) {
      this.mostraErrore(err?.error?.message ?? err?.message ?? 'Errore durante la timbratura');
    } finally {
      this.caricamento = false;
    }
  }

  private mostraErrore(msg: string) {
    this.errore = msg;
    this.step   = 'errore';
  }
}
