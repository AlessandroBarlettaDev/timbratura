import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../environments/environment';
import {
  Utente, Contratto, Timbratura, RichiestaManuale, Stazione,
  StazioneQrResponse, AnteprimaResponse, ConfermaResponse,
  DashboardStazione, CreaUtenteInput, CreaRequestInput,
} from '../models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private apiUrl = environment.ApiUrl;

  constructor(private http: HttpClient) {}

  // --- User Management ---
  createUser(userData: CreaUtenteInput): Observable<{ message: string }> { return this.http.post<{ message: string }>(`${this.apiUrl}/users`, userData); }
  modifyUser(userId: string, userData: Partial<CreaUtenteInput>): Observable<{ message: string }> { return this.http.put<{ message: string }>(`${this.apiUrl}/users/${userId}`, userData); }
  deleteUser(userId: string): Observable<{ message: string }> { return this.http.delete<{ message: string }>(`${this.apiUrl}/users/${userId}`); }
  getUser(userId: string): Observable<Utente> { return this.http.get<Utente>(`${this.apiUrl}/users/${userId}`); }

  getUsers(): Observable<Utente[]> { return this.http.get<Utente[]>(`${this.apiUrl}/users`); }
  markPasswordChanged(): Observable<{ message: string }>      { return this.http.post<{ message: string }>(`${this.apiUrl}/users/password-changed`, {}); }
  markBiometricsRegistered(): Observable<{ message: string }> { return this.http.post<{ message: string }>(`${this.apiUrl}/users/biometrics-registered`, {}); }
  resetPassword(userId: string): Observable<{ message: string }>    { return this.http.post<{ message: string }>(`${this.apiUrl}/users/${userId}/reset-password`, {}); }
  resetBiometrics(userId: string): Observable<{ message: string }>  { return this.http.post<{ message: string }>(`${this.apiUrl}/users/${userId}/reset-biometrics`, {}); }

  // --- Biometric Registration ---
  startBiometricRegistration(): Observable<any>                    { return this.http.post(`${this.apiUrl}/biometric/registration/start`, {}); }
  completeBiometricRegistration(credential: any): Observable<{ message: string }>  { return this.http.post<{ message: string }>(`${this.apiUrl}/biometric/registration/complete`, credential); }

  // --- Biometric Authentication (timbratura) ---
  startBiometricAuthentication(): Observable<{ options: any; sessionId: string }>  { return this.http.post<{ options: any; sessionId: string }>(`${this.apiUrl}/biometric/authentication/start`, {}); }

  // --- Timbrature ---
  anteprimaTimbratura(data: unknown): Observable<AnteprimaResponse>             { return this.http.post<AnteprimaResponse>(`${this.apiUrl}/timbrature/anteprima`, data); }
  confermaTimbratura(confirmToken: string, tipoOverride?: string): Observable<ConfermaResponse> { return this.http.post<ConfermaResponse>(`${this.apiUrl}/timbrature/conferma`, { confirmToken, tipoOverride }); }
  getMieTimbrature(mese?: string): Observable<Timbratura[]>            { return this.http.get<Timbratura[]>(`${this.apiUrl}/timbrature/me${mese ? '?mese=' + mese : ''}`); }
  getDashboardOggi(): Observable<DashboardStazione[]>                  { return this.http.get<DashboardStazione[]>(`${this.apiUrl}/timbrature/dashboard`); }
  getTimbratureUtente(userId: string, mese?: string): Observable<Timbratura[]> {
    const params = `?userId=${userId}${mese ? '&mese=' + mese : ''}`;
    return this.http.get<Timbratura[]>(`${this.apiUrl}/timbrature${params}`);
  }

  // --- Requests (timbrature manuali) ---
  creaRequest(data: CreaRequestInput): Observable<{ message: string }>                          { return this.http.post<{ message: string }>(`${this.apiUrl}/requests`, data); }
  getMieRequests(): Observable<RichiestaManuale[]>                                { return this.http.get<RichiestaManuale[]>(`${this.apiUrl}/requests/me`); }
  getRequestsPendenti(): Observable<RichiestaManuale[]>                           { return this.http.get<RichiestaManuale[]>(`${this.apiUrl}/requests`); }
  approvaRequest(id: string): Observable<{ message: string }>                     { return this.http.post<{ message: string }>(`${this.apiUrl}/requests/${id}/approve`, {}); }
  rifiutaRequest(id: string, motivo: string): Observable<{ message: string }>     { return this.http.post<{ message: string }>(`${this.apiUrl}/requests/${id}/reject`, { motivo }); }

  // --- Stazioni (JWT custom iniettato dall'interceptor per le rotte /stazioni/me/*) ---
  getStazioneQr(): Observable<StazioneQrResponse> { return this.http.get<StazioneQrResponse>(`${this.apiUrl}/stazioni/me/qr`); }
  updateStazionePosition(lat: number, lng: number): Observable<{ message: string }> { return this.http.post<{ message: string }>(`${this.apiUrl}/stazioni/me/position`, { lat, lng }); }

  // --- Contracts ---
  getContracts(userId: string): Observable<Contratto[]>              { return this.http.get<Contratto[]>(`${this.apiUrl}/contracts?userId=${userId}`); }
  getMyContracts(): Observable<Contratto[]>                          { return this.http.get<Contratto[]>(`${this.apiUrl}/contracts/me`); }
  createContract(data: Partial<Contratto>): Observable<{ message: string }>                 { return this.http.post<{ message: string }>(`${this.apiUrl}/contracts`, data); }
  updateContract(id: string, data: Partial<Contratto>): Observable<{ message: string }>     { return this.http.put<{ message: string }>(`${this.apiUrl}/contracts/${id}`, data); }
  deleteContract(id: string): Observable<{ message: string }>                { return this.http.delete<{ message: string }>(`${this.apiUrl}/contracts/${id}`); }

  // --- Stazioni CRUD (Cognito manager) ---
  getStazioni(): Observable<Stazione[]>              { return this.http.get<Stazione[]>(`${this.apiUrl}/stazioni`); }
  getStazione(id: string): Observable<Stazione>    { return this.http.get<Stazione>(`${this.apiUrl}/stazioni/${id}`); }
  createStazione(data: { descrizione: string; password: string }): Observable<{ message: string }>  { return this.http.post<{ message: string }>(`${this.apiUrl}/stazioni`, data); }
  deleteStazione(id: string): Observable<{ message: string }> { return this.http.delete<{ message: string }>(`${this.apiUrl}/stazioni/${id}`); }
}
