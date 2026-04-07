import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
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
  tipo          = '';
  nome          = '';
  cognome       = '';
  durataMinuti: number | undefined;
  errore        = '';
  caricamento   = false;

  private stationId    = '';
  private qrToken      = '';
  private expiresAt    = '';
  private confirmToken = '';

  constructor(
    private route:  ActivatedRoute,
    private router: Router,
    private api:    ApiService,
    private cdr:    ChangeDetectorRef,
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

  private getPosizione(): Promise<{ lat: number; lng: number }> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Il tuo dispositivo non supporta la geolocalizzazione.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        err => {
          if (err.code === err.PERMISSION_DENIED) {
            reject(new Error('Permesso GPS negato. Abilita la geolocalizzazione nelle impostazioni del browser e riprova.'));
          } else {
            reject(new Error('Impossibile rilevare la posizione GPS. Assicurati di avere il GPS attivo e riprova.'));
          }
        },
        { timeout: 8000, maximumAge: 30000 },
      );
    });
  }

  // Step 1 — verifica biometrica, ottieni anteprima tipo
  async confermaIdentita() {
    this.caricamento = true;
    this.errore      = '';

    let posizione: { lat: number; lng: number };
    try {
      posizione = await this.getPosizione();
    } catch (err: any) {
      this.mostraErrore(err.message);
      this.caricamento = false;
      this.cdr.detectChanges();
      return;
    }

    try {
      const authResult = await new Promise<any>((resolve, reject) => {
        this.api.startBiometricAuthentication().subscribe({ next: resolve, error: reject });
      });

      const { options, sessionId } = authResult;
      const assertion = await startAuthentication({ optionsJSON: options, useBrowserAutofill: false });

      const result = await new Promise<any>((resolve, reject) => {
        this.api.anteprimaTimbratura({
          stationId: this.stationId,
          qrToken:   this.qrToken,
          expiresAt: this.expiresAt,
          assertion,
          sessionId,
          lat: posizione.lat,
          lng: posizione.lng,
        }).subscribe({ next: resolve, error: reject });
      });

      this.tipo         = result.tipo;
      this.nome         = result.nome;
      this.cognome      = result.cognome;
      this.confirmToken = result.confirmToken;
      this.step         = 'conferma';
      this.cdr.detectChanges();

    } catch (err: any) {
      console.error('[timbratura] errore:', err);
      this.mostraErrore(err?.error?.message ?? err?.message ?? 'Errore durante la verifica');
    } finally {
      this.caricamento = false;
      this.cdr.detectChanges();
    }
  }

  // Step 2 — salva definitivamente
  async timbra() {
    this.caricamento = true;
    this.errore      = '';

    try {
      const result = await new Promise<any>((resolve, reject) => {
        this.api.confermaTimbratura(this.confirmToken).subscribe({ next: resolve, error: reject });
      });
      this.durataMinuti = result.durataMinuti;
      this.cdr.detectChanges();
      await new Promise(r => setTimeout(r, this.tipo === 'uscita' && result.durataMinuti ? 1800 : 0));
      this.router.navigate(['/dashboard-employee']);

    } catch (err: any) {
      this.mostraErrore(err?.error?.message ?? err?.message ?? 'Errore durante la timbratura');
    } finally {
      this.caricamento = false;
      this.cdr.detectChanges();
    }
  }

  get durataLabel(): string {
    if (this.durataMinuti == null) return '';
    const h = Math.floor(this.durataMinuti / 60);
    const m = this.durataMinuti % 60;
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  }

  private mostraErrore(msg: string) {
    this.errore = msg;
    this.step   = 'errore';
    this.cdr.detectChanges();
  }
}
