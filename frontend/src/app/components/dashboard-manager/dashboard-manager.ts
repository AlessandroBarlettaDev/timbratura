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
  utenti:   any[] = [];
  stazioni: any[] = [];
  selectedUser:     any = null;
  selectedStazione: any = null;
  showProfile  = false;
  isLoading    = false;

  // --- Stato modale nuovo utente ---
  showModal  = false;
  newUser    = { email: '', nome: '', cognome: '', birthdate: '', codice_fiscale: '', data_assunzione: '', termine_contratto: '', ruolo: 'employee' };
  modalError: string | null = null;

  // --- Stato modifica/elimina utente ---
  showEditModal     = false;
  editUser: any     = {};
  showDeleteConfirm = false;

  // --- Stato sezione stazioni ---
  showStazioneModal         = false;
  newStazione               = { descrizione: '', password: '' };
  stazioneModalError: string | null = null;
  stazioneToDelete:   any   = null;
  showDeleteStazioneConfirm = false;

  constructor(private apiService: ApiService, public authService: AuthService, private cdr: ChangeDetectorRef) {}

  // --- Gestione navigazione tra sezioni ---
  setSection(section: Section) {
    this.selectedUser     = null;
    this.selectedStazione = null;
    this.showProfile      = false;
    this.activeSection    = section;
    if (section === 'utenti'   && this.utenti.length   === 0) this.loadUtenti();
    if (section === 'stazioni' && this.stazioni.length === 0) this.loadStazioni();
  }

  // --- Gestione utenti ---
  selectUser(user: any) {
    this.apiService.getUser(user.id).subscribe({
      next: (data) => { this.selectedUser = data; this.cdr.detectChanges(); },
      error: (err)  => console.error('Errore caricamento utente:', err),
    });
  }

  backToList() { this.selectedUser = null; }

  openEditModal() {
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

  saveEdit() {
    this.apiService.modifyUser(this.selectedUser.id, this.editUser).subscribe({
      next: ()     => { this.showEditModal = false; this.cdr.detectChanges(); this.selectUser({ id: this.selectedUser.id }); },
      error: (err) => console.error('Errore modifica utente:', err),
    });
  }

  confirmDeleteUser() { this.showDeleteConfirm = true; }

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

  openModal() {
    this.newUser    = { email: '', nome: '', cognome: '', birthdate: '', codice_fiscale: '', data_assunzione: '', termine_contratto: '', ruolo: 'employee' };
    this.modalError = null;
    this.showModal  = true;
  }

  closeModal() { this.showModal = false; this.modalError = null; }

  addUser() {
    this.modalError = null;
    this.apiService.createUser(this.newUser).subscribe({
      next: ()     => { this.closeModal(); this.utenti = []; this.cdr.detectChanges(); this.loadUtenti(); },
      error: (err) => { this.modalError = err.error?.message ?? 'Errore durante la creazione'; this.cdr.detectChanges(); },
    });
  }

  private loadUtenti() {
    this.isLoading = true;
    this.apiService.getUsers().subscribe({
      next: (data) => { this.utenti = data; this.isLoading = false; this.cdr.detectChanges(); },
      error: (err)  => { console.error('Errore caricamento utenti:', err); this.isLoading = false; this.cdr.detectChanges(); },
    });
  }

  // --- Gestione stazioni ---
  selectStazione(stazione: any) {
    this.apiService.getStazione(stazione.stationId).subscribe({
      next: (data) => { this.selectedStazione = data; this.cdr.detectChanges(); },
      error: (err)  => console.error('Errore caricamento stazione:', err),
    });
  }

  backToListStazioni() { this.selectedStazione = null; }

  openStazioneModal() {
    this.newStazione        = { descrizione: '', password: '' };
    this.stazioneModalError = null;
    this.showStazioneModal  = true;
  }

  closeStazioneModal() { this.showStazioneModal = false; this.stazioneModalError = null; }

  addStazione() {
    this.stazioneModalError = null;
    this.apiService.createStazione(this.newStazione).subscribe({
      next: ()     => { this.closeStazioneModal(); this.stazioni = []; this.cdr.detectChanges(); this.loadStazioni(); },
      error: (err) => { this.stazioneModalError = err.error?.message ?? 'Errore durante la creazione'; this.cdr.detectChanges(); },
    });
  }

  richiediEliminaStazione(stazione: any) {
    this.stazioneToDelete          = stazione;
    this.showDeleteStazioneConfirm = true;
  }

  confirmDeleteStazione() {
    const id = this.stazioneToDelete?.stationId ?? this.selectedStazione?.stationId;
    this.apiService.deleteStazione(id).subscribe({
      next: () => {
        this.showDeleteStazioneConfirm = false;
        this.stazioneToDelete          = null;
        this.selectedStazione          = null;
        this.stazioni = [];
        this.cdr.detectChanges();
        this.loadStazioni();
      },
      error: (err) => console.error('Errore eliminazione stazione:', err),
    });
  }

  private loadStazioni() {
    this.isLoading = true;
    this.apiService.getStazioni().subscribe({
      next: (data) => { this.stazioni = data; this.isLoading = false; this.cdr.detectChanges(); },
      error: (err)  => { console.error('Errore caricamento stazioni:', err); this.isLoading = false; this.cdr.detectChanges(); },
    });
  }
}
