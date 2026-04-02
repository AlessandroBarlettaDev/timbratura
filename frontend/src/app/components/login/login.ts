import { Component, ChangeDetectorRef } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/user-auth.service';
import { ApiService } from '../../services/api.service';
import { StationAuthService } from '../../services/station-auth.service';
import { Router } from '@angular/router';
import { resetPassword, confirmResetPassword } from 'aws-amplify/auth';

@Component({
  selector: 'app-login',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login.html',
  styleUrl: '../../app.css',
})
export class Login {
  mode: 'dipendenti' | 'stazioni' = 'dipendenti';
  step: 'login' | 'change_password' | 'reset_request' | 'reset_confirm' = 'login';
  showPassword = false;

  form: FormGroup;
  changePasswordForm: FormGroup;
  resetRequestForm: FormGroup;
  resetConfirmForm: FormGroup;
  loginError: string | null = null;

  constructor(
    private fb: FormBuilder,                // form reattivi di login e cambio password
    private authService: AuthService,
    private apiService: ApiService,
    private stationAuth: StationAuthService,
    private router: Router,
    private cdr: ChangeDetectorRef,         // forza il refresh del template in caso di errori asincroni
  ) {
    this.form = this.fb.group({
      user:     ['', Validators.required],
      password: ['', Validators.required],
    });
    // Form per il cambio password al primo accesso (challenge NEW_PASSWORD_REQUIRED di Cognito)
    this.changePasswordForm = this.fb.group({
      newPassword:     ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', Validators.required],
    });
    // Form per richiedere il codice di reset
    this.resetRequestForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
    });
    // Form per impostare la nuova password con il codice ricevuto via email
    this.resetConfirmForm = this.fb.group({
      code:            ['', Validators.required],
      newPassword:     ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', Validators.required],
    });
  }

  // Verifica se la password e la conferma password coincidono
  get passwordMismatch(): boolean {
    const form = this.step === 'change_password' ? this.changePasswordForm : this.resetConfirmForm;
    const { newPassword, confirmPassword } = form.value;
    return confirmPassword && newPassword !== confirmPassword;
  }

  // Titoli e placeholder dinamici in base alla modalità e allo step
  get formTitle() {
    if (this.step === 'change_password') return 'Imposta la tua password';
    if (this.step === 'reset_request')   return 'Recupera password';
    if (this.step === 'reset_confirm')   return 'Inserisci il codice';
    return this.mode === 'dipendenti' ? 'Login Dipendenti' : 'Login Stazioni';
  }

  // Placeholder dinamico per il campo user (email per dipendenti, codice stazione per stazioni)
  get userPlaceholder() {
    return this.mode === 'dipendenti' ? 'E-mail' : 'Codice Stazione';
  }

  // Cambia modalità tra login dipendenti e stazioni
  setMode(mode: 'dipendenti' | 'stazioni') {
    this.mode = mode;
    // resetta il campo user quando si cambia modalità
    this.form.get('user')?.reset();
  }


  async login() {
    if (this.form.valid) {
      try {
        if (this.mode === 'stazioni') {
          // Login stazione — usa JWT custom, non Amplify
          await this.stationAuth.login(this.form.value.user, this.form.value.password);
          this.router.navigate(['/stazione']);
        } else {
          // Login dipendente con Amplify
          const result = await this.authService.loginWithAmplify(this.form.value.user, this.form.value.password);

          if (result === 'password_change_required') {
            // La challenge è attiva in memoria: mostriamo il form inline senza navigare via, altrimenti Amplify perde lo stato della sessione
            this.step = 'change_password';
            this.cdr.detectChanges();
            return;
          }
          // Login riuscito: vai alla dashboard corretta in base al ruolo
          if (this.authService.isManager) {
            this.router.navigate(['/dashboard-manager']);
          } else {
            this.router.navigate(['/dashboard-employee']);
          }
        }
      } catch (err: any) {
        this.loginError = err.message;
        this.cdr.detectChanges();
      }
    } else {
      this.form.markAllAsTouched();     // Visualizza errori di validazione
    }
  }

  // Completa la challenge NEW_PASSWORD_REQUIRED — deve essere chiamato nello stesso contesto di signIn
  async changePassword() {
    if (this.changePasswordForm.invalid || this.passwordMismatch) return;
    this.loginError = null;

    try {
      await this.authService.confirmNewPassword(this.changePasswordForm.value.newPassword);
      this.apiService.markPasswordChanged().subscribe();        // Aggiorna il flag su Cognito (non bloccante)
      this.router.navigate(['/first-access']);                  // Vai al first-access per la registrazione biometrica
    } catch (err: any) {
      this.loginError = err.message;
      this.cdr.detectChanges();
    }
  }

  // Step 1 reset: chiede a Cognito di inviare il codice di verifica via email
  async requestPasswordReset() {
    if (this.resetRequestForm.invalid) return;
    this.loginError = null;

    try {
      await resetPassword({ username: this.resetRequestForm.value.email });
      // Precompila l'email nel form successivo per non doverla reinserire
      this.resetConfirmForm.patchValue({ code: '' });
      this.step = 'reset_confirm';
      this.cdr.detectChanges();
    } catch (err: any) {
      this.loginError = err.message;
      this.cdr.detectChanges();
    }
  }

  // Step 2 reset: verifica il codice e imposta la nuova password
  async confirmPasswordReset() {
    if (this.resetConfirmForm.invalid || this.passwordMismatch) return;
    this.loginError = null;

    try {
      await confirmResetPassword({
        username:         this.resetRequestForm.value.email,
        confirmationCode: this.resetConfirmForm.value.code,
        newPassword:      this.resetConfirmForm.value.newPassword,
      });
      // Reset completato: torna al login
      this.step = 'login';
      this.cdr.detectChanges();
    } catch (err: any) {
      this.loginError = err.message;
      this.cdr.detectChanges();
    }
  }
}