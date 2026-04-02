import { Component, ChangeDetectorRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/user-auth.service';

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
  showProfile = false;
  isLoading = false;

  showModal = false;
  newUser = { email: '', nome: '', cognome: '', birthdate: '', codice_fiscale: '', data_assunzione: '', termine_contratto: '', ruolo: 'employee' };
  modalError: string | null = null;

  showEditModal = false;
  editUser: any = {};

  showDeleteConfirm = false;

  constructor(private apiService: ApiService, public authService: AuthService, private cdr: ChangeDetectorRef) {}

  // --- Gestione navigazione tra sezioni ---
  setSection(section: Section) {
    this.selectedUser = null;
    this.showProfile = false;
    this.activeSection = section;
    if (section === 'utenti' && this.utenti.length === 0) this.loadUtenti();
  }

  // --- Gestione utente ---
  selectUser(user: any) {
    this.apiService.getUser(user.id).subscribe({
      next: (data) => { this.selectedUser = data; this.cdr.detectChanges(); },
      error: (err) => console.error('Errore caricamento utente:', err),
    });
  }

  // Torna alla lista utenti
  backToList() {
    this.selectedUser = null;
  }

  // Apre il modal di modifica con i dati dell'utente selezionato
  openEditModal() {
    // Copia i dati dell'utente selezionato nel form di modifica
    this.editUser = {
      nome:              this.selectedUser.given_name,
      cognome:           this.selectedUser.family_name,
      birthdate:         this.selectedUser.birthdate         ?? '',
      codice_fiscale:    this.selectedUser.codice_fiscale    ?? '',
      data_assunzione:   this.selectedUser.data_assunzione   ?? '',
      termine_contratto: this.selectedUser.termine_contratto ?? '',
    };
    this.showEditModal = true;
  }

  // Salva le modifiche dell'utente selezionato
  saveEdit() {
    this.apiService.modifyUser(this.selectedUser.id, this.editUser).subscribe({
      next: () => {
        this.showEditModal = false;
        this.cdr.detectChanges();
        this.selectUser({ id: this.selectedUser.id });
      },
      error: (err) => console.error('Errore modifica utente:', err),
    });
  }

  // Apre la conferma di eliminazione dell'utente selezionato
  confirmDeleteUser() {
    this.showDeleteConfirm = true;
  }

  // Elimina l'utente selezionato
  confirmDelete() {
    this.apiService.deleteUser(this.selectedUser.id).subscribe({
      next: () => {
        this.showDeleteConfirm = false;
        this.selectedUser = null;
        this.utenti = [];
        this.cdr.detectChanges();
        this.loadUtenti();
      },
      error: (err) => console.error('Errore eliminazione utente:', err),
    });
  }

  // --- Gestione creazione nuovo utente ---
  openModal() {
    this.newUser = { email: '', nome: '', cognome: '', birthdate: '', codice_fiscale: '', data_assunzione: '', termine_contratto: '', ruolo: 'employee' };
    this.modalError = null;
    this.showModal = true;
  }

  // Chiude il modal di creazione/modifica utente
  closeModal() {
    this.showModal = false;
    this.modalError = null;
  }

  // Crea un nuovo utente con i dati inseriti nel form
  addUser() {
    this.modalError = null;
    this.apiService.createUser(this.newUser).subscribe({
      next: () => {
        this.closeModal();
        this.utenti = [];
        this.cdr.detectChanges();
        this.loadUtenti();
      },
      error: (err) => { this.modalError = err.error?.message ?? 'Errore durante la creazione'; this.cdr.detectChanges(); },
    });
  }

  // Carica la lista degli utenti dal backend
  private loadUtenti() {
    this.isLoading = true;
    this.apiService.getUsers().subscribe({
      next: (data) => { this.utenti = data; this.isLoading = false; this.cdr.detectChanges(); },
      error: (err) => { console.error('Errore caricamento utenti:', err); this.isLoading = false; this.cdr.detectChanges(); },
    });
  }
}
