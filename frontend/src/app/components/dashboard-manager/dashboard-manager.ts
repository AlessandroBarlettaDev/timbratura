import { Component } from '@angular/core';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-dashboard-manager',
  imports: [],
  templateUrl: './dashboard-manager.html',
  styleUrl: '../../app.css',
})
export class DashboardManager {
  userData = {
    email: 'alessandro.barletta.dev@gmail.com',
    nome: 'Mario',
    cognome: 'Rossi',
    birthdate: '1990-01-01',
    codice_fiscale: 'RSSMRA90A01H501U',
    role: 'employee',
    data_assunzione: '2024-01-01',
    termine_contratto: '2025-05-01',
    password_changed: 'false',
    biometrics_reg: 'false'
  };

  constructor(private apiService: ApiService) {}

  createUser() {
    
    this.apiService.createUser(this.userData).subscribe({
      next: (res) => console.log('Risposta backend:', res),
      error: (err) => console.error('Errore backend:', err)
    });
    
  }
}
