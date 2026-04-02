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
  nomestazione   = '';
  qrDataUrl      = '';             // immagine QR generata da qrcode
  secondiRimasti = QR_REFRESH_MS / 1000;
  errore: string | null = null;

  private refreshTimer: any;      // interval per il rinnovo del QR
  private countdownTimer: any;    // interval per il countdown visivo

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

    this.nomestazione = this.stationAuth.getStazione()?.nome ?? '';

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
        // Genera l'immagine QR a partire dall'URL restituito dal backend
        this.qrDataUrl = await QRCode.toDataURL(res.qrUrl, { width: 400, margin: 2 });
        this.avviaCountdown();
        this.cdr.detectChanges();
      },
      error: (err: any) => {
        this.errore = err.error?.message ?? 'Errore nel caricamento del QR';
        this.cdr.detectChanges();
      },
    });
  }

  // Avvia il countdown visivo che mostra i secondi al prossimo rinnovo
  private avviaCountdown() {
    clearInterval(this.countdownTimer);
    this.secondiRimasti = QR_REFRESH_MS / 1000;

    this.countdownTimer = setInterval(() => {
      this.secondiRimasti--;
      if (this.secondiRimasti <= 0) clearInterval(this.countdownTimer);
      this.cdr.detectChanges();
    }, 1000);
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
