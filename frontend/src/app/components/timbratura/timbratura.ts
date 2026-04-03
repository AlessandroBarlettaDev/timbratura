import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { startAuthentication } from '@simplewebauthn/browser';
import { ApiService } from '../../services/api.service';

type Step = 'verifica' | 'biometrica' | 'successo' | 'errore';

@Component({
  selector: 'app-timbratura',
  imports: [],
  templateUrl: './timbratura.html',
  styleUrl: '../../app.css',
})
export class Timbratura implements OnInit {
  step: Step     = 'verifica';
  tipo: string   = '';         // 'entrata' o 'uscita' — determinato dal backend
  orario         = '';         // orario della timbratura confermata
  errore         = '';
  caricamento    = false;

  // Parametri estratti dall'URL del QR
  private stationId  = '';
  private qrToken    = '';
  private expiresAt  = '';

  constructor(
    private route: ActivatedRoute,
    private api:   ApiService,
  ) {}

  ngOnInit() {
    // Legge i parametri dal QR: /timbratura?s=...&t=...&exp=...
    this.stationId = this.route.snapshot.queryParamMap.get('s')   ?? '';
    this.qrToken   = this.route.snapshot.queryParamMap.get('t')   ?? '';
    this.expiresAt = this.route.snapshot.queryParamMap.get('exp') ?? '';

    // Controlla che i parametri siano presenti
    if (!this.stationId || !this.qrToken || !this.expiresAt) {
      this.mostraErrore('QR non valido. Scansiona di nuovo il codice.');
      return;
    }

    // Controlla che il QR non sia scaduto lato client (risparmia una chiamata al backend)
    if (Math.floor(Date.now() / 1000) > parseInt(this.expiresAt)) {
      this.mostraErrore('QR scaduto. Attendi che la stazione si aggiorni (ogni 3 minuti).');
      return;
    }

    // Tutto ok — mostra il pulsante di conferma biometrica
    this.step = 'biometrica';
  }

  // Avvia il flusso di autenticazione biometrica e registra la timbratura
  async timbra() {
    this.caricamento = true;
    this.errore      = '';

    try {
      // 1. Ottieni la challenge dal backend
      const { options, sessionId } = await new Promise<any>((resolve, reject) => {
        this.api.startBiometricAuthentication().subscribe({ next: resolve, error: reject });
      });

      // 2. Chiedi al browser di eseguire l'autenticazione biometrica (Face ID / Touch ID)
      // useBrowserAutofill: false + nessun allowCredentials vuoto = forza il platform authenticator
      const assertion = await startAuthentication({ optionsJSON: options, useBrowserAutofill: false });

      // 3. Invia al backend: QR + assertion biometrica → backend verifica tutto e salva
      const result = await new Promise<any>((resolve, reject) => {
        this.api.registraTimbratura({
          stationId:  this.stationId,
          qrToken:    this.qrToken,
          expiresAt:  this.expiresAt,
          assertion,
          sessionId,
        }).subscribe({ next: resolve, error: reject });
      });

      // 4. Mostra il risultato
      this.tipo    = result.tipo;
      this.orario  = new Date(result.timestamp).toLocaleTimeString('it-IT');
      this.step    = 'successo';

    } catch (err: any) {
      const msg = err?.error?.message ?? err?.message ?? 'Errore durante la timbratura';
      this.mostraErrore(msg);
    } finally {
      this.caricamento = false;
    }
  }

  private mostraErrore(msg: string) {
    this.errore = msg;
    this.step   = 'errore';
  }
}
