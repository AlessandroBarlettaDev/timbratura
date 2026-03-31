import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

type Section = 'dashboard' | 'utenti' | 'stazioni';

@Component({
  selector: 'app-dashboard-manager',
  imports: [FormsModule],
  templateUrl: './dashboard-manager.html',
  styleUrl: '../../app.css',
})
export class DashboardManager {
  activeSection: Section = 'dashboard';
  utenti: any[] = [];
  stazioni: any[] = [];
  selectedUser: any = null;

  showModal = false;
  newUser = { email: '', nome: '', cognome: '', birthdate: '', codice_fiscale: '', data_assunzione: '', termine_contratto: '' };

  constructor(private apiService: ApiService) {}

  // --- Gestione navigazione tra sezioni ---
  setSection(section: Section) {
    this.activeSection = section;
    this.selectedUser = null;
    if (section === 'utenti' && this.utenti.length === 0) this.loadUtenti();
  }

  // --- Gestione utente ---
  selectUser(user: any) {
    this.apiService.getUser(user.id).subscribe({
      next: (data) => { this.selectedUser = data; console.log('Utente selezionato:', data); },
      error: (err) => console.error('Errore caricamento utente:', err),
    });
  }

  // Torna alla lista utenti
  backToList() {
    this.selectedUser = null;
  }

  openModal() {
    this.newUser = { email: '', nome: '', cognome: '', birthdate: '', codice_fiscale: '', data_assunzione: '', termine_contratto: '' };
    this.showModal = true;
  }

  closeModal() {
    this.showModal = false;
  }

  addUser() {
    this.apiService.createUser(this.newUser).subscribe({
      next: () => {
        this.closeModal();
        this.utenti = [];
        this.loadUtenti();
      },
      error: (err) => console.error('Errore creazione utente:', err),
    });
  }

  private loadUtenti() {
    this.apiService.getUsers().subscribe({
      next: (data) => this.utenti = data,
      error: (err) => console.error('Errore caricamento utenti:', err),
    });
  }
}
