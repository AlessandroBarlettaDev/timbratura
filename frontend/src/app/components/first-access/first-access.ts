import { Component, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { startRegistration } from '@simplewebauthn/browser';
import { fetchAuthSession } from 'aws-amplify/auth';
import { AuthService } from '../../services/user-auth.service';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-first-access',
  imports: [],
  templateUrl: './first-access.html',
  styleUrl: '../../app.css',
})
export class FirstAccess {
  error: string | null = null;
  loading = false;

  constructor(
    private router: Router,
    private authService: AuthService,
    private apiService: ApiService,
    private cdr: ChangeDetectorRef,
  ) {}

  // Registra il dispositivo biometrico tramite WebAuthn
  async registerBiometrics() {
    this.error = null;
    this.loading = true;

    try {
      // 1. Chiede al backend le opzioni di registrazione (challenge inclusa)
      this.apiService.startBiometricRegistration().subscribe({
        next: async (options) => {
          try {
            // 2. Il browser mostra il prompt biometrico (Touch ID, Face ID, Windows Hello...)
            const credential = await startRegistration({ optionsJSON: options });

            // 3. Invia la risposta al backend per la verifica crittografica
            this.apiService.completeBiometricRegistration(credential).subscribe({
              next: () => {
                // 4. Aggiorna il flag su Cognito e vai alla dashboard
                this.apiService.markBiometricsRegistered().subscribe({
                  next:  async () => this.navigateToDashboard(),
                  error: async () => this.navigateToDashboard(), // procedi anche se il flag fallisce
                });
              },
              error: (err) => {
                this.error = err.error?.message ?? 'Verifica biometrica fallita';
                this.loading = false;
                this.cdr.detectChanges();
              },
            });
          } catch (err: any) {
            // L'utente ha annullato il prompt o il dispositivo non supporta WebAuthn
            this.error = err.message ?? 'Registrazione biometrica annullata';
            this.loading = false;
            this.cdr.detectChanges();
          }
        },
        error: (err) => {
          this.error = err.error?.message ?? 'Impossibile avviare la registrazione';
          this.loading = false;
          this.cdr.detectChanges();
        },
      });
    } catch (err: any) {
      this.error = err.message ?? 'Errore imprevisto';
      this.loading = false;
    }
  }

  // Naviga alla dashboard corretta in base al ruolo
  private async navigateToDashboard() {
    await fetchAuthSession({ forceRefresh: true });
    await this.authService.checkCurrentSession();
    if (this.authService.isManager) {
      this.router.navigate(['/dashboard-manager']);
    } else {
      this.router.navigate(['/dashboard-employee']);
    }
  }
}