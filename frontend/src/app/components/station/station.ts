import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import QRCode from 'qrcode';
import { StationAuthService } from '../../services/station-auth.service';
import { ApiService } from '../../services/api.service';

const QR_REFRESH_MS = 3 * 60 * 1000; // 3 minuti — stesso TTL del backend

@Component({
  selector: 'app-station',
  imports: [],
  templateUrl: './station.html',
  styleUrl: '../../app.css',
})
export class Station implements OnInit, OnDestroy {
  descrizione    = '';
  qrDataUrl      = '';             // immagine QR generata da qrcode
  secondiRimasti = QR_REFRESH_MS / 1000;
  orario         = '';             // ora corrente aggiornata ogni secondo
  scadenzaQrOra  = '';             // orario di scadenza del QR (HH:MM:SS)
  errore: string | null = null;

  private scadenzaTimestamp = 0;   // timestamp Unix scadenza QR
  private refreshTimer: any;       // interval per il rinnovo del QR
  private countdownTimer: any;     // interval per il countdown visivo + orologio

  constructor(
    private stationAuth: StationAuthService,
    private api:         ApiService,
    private router:      Router,
    private cdr:         ChangeDetectorRef,
  ) {}

  ngOnInit() {
    // Redirect al login se la stazione non è autenticata
    if (!this.stationAuth.isLoggedIn()) {
      this.router.navigate(['/login']);
      return;
    }

    this.descrizione = this.stationAuth.getStazione()?.descrizione ?? '';

    // Avvia subito l'orologio — si aggiorna ogni secondo insieme al countdown
    this.avviaOrologio();

    // Acquisisce la posizione GPS e la invia al backend
    this.inviaPosizioneGps();

    // Carica subito il primo QR poi lo rinnova ogni 3 minuti
    this.rinnovaQr();
    this.refreshTimer = setInterval(() => this.rinnovaQr(), QR_REFRESH_MS);
  }

  ngOnDestroy() {
    clearInterval(this.refreshTimer);
    clearInterval(this.countdownTimer);
  }

  // Richiede il QR al backend e lo converte in immagine
  private rinnovaQr() {
    this.api.getStazioneQr().subscribe({
      next: async (res: { qrUrl: string; expiresAt: number }) => {
        this.scadenzaTimestamp = res.expiresAt;
        this.qrDataUrl = await QRCode.toDataURL(res.qrUrl, { width: 380, margin: 2 });
        this.cdr.detectChanges();
      },
      error: (err: any) => {
        this.errore = err.error?.message ?? 'Errore nel caricamento del QR';
        this.cdr.detectChanges();
      },
    });
  }

  // Interval unico ogni secondo: aggiorna orologio, countdown QR e orario scadenza
  private avviaOrologio() {
    const tick = () => {
      const ora = new Date();
      this.orario = ora.toLocaleTimeString('it-IT');

      if (this.scadenzaTimestamp > 0) {
        const secondiAllaScadenza = this.scadenzaTimestamp - Math.floor(Date.now() / 1000);
        this.secondiRimasti = Math.max(0, secondiAllaScadenza);

        // Mostra l'orario assoluto di scadenza del QR
        const scadenza = new Date(this.scadenzaTimestamp * 1000);
        this.scadenzaQrOra = scadenza.toLocaleTimeString('it-IT');
      }

      this.cdr.detectChanges();
    };

    tick(); // prima esecuzione immediata
    this.countdownTimer = setInterval(tick, 1000);
  }

  // Rileva la posizione GPS del dispositivo e la invia al backend
  private inviaPosizioneGps() {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.api.updateStazionePosition(pos.coords.latitude, pos.coords.longitude).subscribe({
          error: (err: any) => console.error('Errore invio posizione:', err),
        });
      },
      (err: any) => console.warn('Posizione GPS non disponibile:', err.message),
    );
  }

  logout() {
    this.stationAuth.logout();
    this.router.navigate(['/login']);
  }
}
