import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-login',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login.html',
  styleUrl: '../../app.css',
})
export class Login {
  mode: 'dipendenti' | 'stazioni' = 'dipendenti';
  form: FormGroup;
  loginError: string | null = null;

  constructor(private fb: FormBuilder, private authService: AuthService, private router: Router) {
    this.form = this.fb.group({
      user: ['', Validators.required],
      password: ['', Validators.required],
    });
  }

  get formTitle() {
    return this.mode === 'dipendenti' ? 'Login Dipendenti' : 'Login Stazioni';
  }

  get userPlaceholder() {
    return this.mode === 'dipendenti' ? 'E-mail' : 'Codice Stazione';
  }

  setMode(mode: 'dipendenti' | 'stazioni') {
    this.mode = mode;
    // resetta il campo user quando si cambia modalità
    this.form.get('user')?.reset();
  }

  async login() {
    if (this.form.valid) {
      try {
        if (this.mode === 'stazioni') {
          // TODO: implementa chiamata API login stazione
        } else {
          // Login dipendente con Amplify
          await this.authService.loginWithAmplify(this.form.value.user, this.form.value.password);
          if (this.authService.isManager) {
            // Successo: reindirizza alla dashboard
            this.router.navigate(['/dashboard-manager']);
          } else {
            this.router.navigate(['/dashboard-employee']);
          }
        }
      } catch (err: any) {
        this.loginError = err.message;
      }
    } else {
      // Visualizza errori di validazione
      this.form.markAllAsTouched();
    }
  }

  resetPassword() {
    // TODO: implementa chiamata API reset password
    console.log('Reset password', this.form.get('user')?.value, 'mode:', this.mode);
  }
}
