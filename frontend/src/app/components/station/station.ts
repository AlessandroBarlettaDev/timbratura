import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
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
  qrDataUrl      = '';
  secondiRimasti = QR_REFRESH_MS / 1000;
  orario         = '';
  scadenzaQrOra  = '';
  presenti       = 0;
  errore: string | null = null;

  // Mappa GPS stazione
  mapUrl: SafeResourceUrl | null = null;

  // Notifica ultima timbratura
  ultimaNotifica: { nome: string; cognome: string; tipo: string; ora: string } | null = null;
  private notificaTimer: ReturnType<typeof setTimeout> | null = null;

  private scadenzaTimestamp = 0;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private stationAuth: StationAuthService,
    private api:         ApiService,
    private router:      Router,
    private sanitizer:   DomSanitizer,
    private cdr:         ChangeDetectorRef,
  ) {}

  ngOnInit() {
    if (!this.stationAuth.isLoggedIn()) {
      this.router.navigate(['/login']);
      return;
    }

    this.descrizione = this.stationAuth.getStazione()?.descrizione ?? '';
    this.avviaOrologio();
    this.inviaPosizioneGps();
    this.rinnovaQr();
    this.refreshTimer = setInterval(() => this.rinnovaQr(), QR_REFRESH_MS);
  }

  ngOnDestroy() {
    if (this.refreshTimer)   clearInterval(this.refreshTimer);
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    if (this.notificaTimer)  clearTimeout(this.notificaTimer);
  }

  private rinnovaQr() {
    this.inviaPosizioneGps();
    this.api.getStazioneQr().subscribe({
      next: async (res) => {
        const presentiPrecedenti = this.presenti;
        this.scadenzaTimestamp   = res.expiresAt;
        this.presenti            = res.presenti ?? 0;
        this.qrDataUrl = await QRCode.toDataURL(res.qrUrl, { width: 380, margin: 2 });

        if (res.lat != null && res.lng != null) {
          const url = `https://maps.google.com/maps?q=${res.lat},${res.lng}&z=17&output=embed`;
          this.mapUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
        }

        if (res.ultimaTimbratura && this.presenti !== presentiPrecedenti) {
          this.mostraNotifica(res.ultimaTimbratura);
        }

        this.cdr.detectChanges();
      },
      error: (err: any) => {
        this.errore = err.error?.message ?? 'Errore nel caricamento del QR';
        this.cdr.detectChanges();
      },
    });
  }

  private mostraNotifica(timbratura: any) {
    const ora = new Date(timbratura.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    this.ultimaNotifica = { nome: timbratura.nome, cognome: timbratura.cognome, tipo: timbratura.tipo, ora };
    if (this.notificaTimer) clearTimeout(this.notificaTimer);
    this.notificaTimer = setTimeout(() => { this.ultimaNotifica = null; this.cdr.detectChanges(); }, 5000);
  }

  private avviaOrologio() {
    const tick = () => {
      this.orario = new Date().toLocaleTimeString('it-IT');
      if (this.scadenzaTimestamp > 0) {
        this.secondiRimasti = Math.max(0, this.scadenzaTimestamp - Math.floor(Date.now() / 1000));
        this.scadenzaQrOra  = new Date(this.scadenzaTimestamp * 1000).toLocaleTimeString('it-IT');
      }
      this.cdr.detectChanges();
    };
    tick();
    this.countdownTimer = setInterval(tick, 1000);
  }

  private inviaPosizioneGps() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => this.api.updateStazionePosition(pos.coords.latitude, pos.coords.longitude).subscribe({
        error: (err: any) => console.error('Errore invio posizione:', err),
      }),
      (err: any) => console.warn('Posizione GPS non disponibile:', err.message),
    );
  }

  logout() {
    this.stationAuth.logout();
    this.router.navigate(['/login']);
  }
}
