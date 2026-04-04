import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../environments/environment';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private apiUrl = environment.ApiUrl;

  constructor(private http: HttpClient) {}

  // --- User Management ---
  createUser(userData: any): Observable<any> { return this.http.post(`${this.apiUrl}/users`, userData); }
  modifyUser(userId: string, userData: any): Observable<any> { return this.http.put(`${this.apiUrl}/users/${userId}`, userData); }
  deleteUser(userId: string): Observable<any> { return this.http.delete(`${this.apiUrl}/users/${userId}`); }
  getUser(userId: string): Observable<any> { return this.http.get(`${this.apiUrl}/users/${userId}`); }
  
  getUsers(): Observable<any> { return this.http.get(`${this.apiUrl}/users`); }
  markPasswordChanged(): Observable<any>      { return this.http.post(`${this.apiUrl}/users/password-changed`, {}); }
  markBiometricsRegistered(): Observable<any> { return this.http.post(`${this.apiUrl}/users/biometrics-registered`, {}); }

  // --- Biometric Registration ---
  startBiometricRegistration(): Observable<any>                    { return this.http.post(`${this.apiUrl}/biometric/registration/start`, {}); }
  completeBiometricRegistration(credential: any): Observable<any>  { return this.http.post(`${this.apiUrl}/biometric/registration/complete`, credential); }

  // --- Biometric Authentication (timbratura) ---
  startBiometricAuthentication(): Observable<any>                  { return this.http.post(`${this.apiUrl}/biometric/authentication/start`, {}); }

  // --- Timbrature ---
  registraTimbratura(data: any): Observable<any>              { return this.http.post(`${this.apiUrl}/timbrature`, data); }
  anteprimaTimbratura(data: any): Observable<any>             { return this.http.post(`${this.apiUrl}/timbrature/anteprima`, data); }
  confermaTimbratura(confirmToken: string): Observable<any>   { return this.http.post(`${this.apiUrl}/timbrature/conferma`, { confirmToken }); }
  getMieTimbrature(mese?: string): Observable<any>            { return this.http.get(`${this.apiUrl}/timbrature/me${mese ? '?mese=' + mese : ''}`); }
  getDashboardOggi(): Observable<any>                         { return this.http.get(`${this.apiUrl}/timbrature/dashboard`); }
  getTimbratureUtente(userId: string, mese?: string): Observable<any> {
    const params = `?userId=${userId}${mese ? '&mese=' + mese : ''}`;
    return this.http.get(`${this.apiUrl}/timbrature${params}`);
  }

  // --- Stazioni (JWT custom iniettato dall'interceptor per le rotte /stazioni/me/*) ---
  getStazioneQr(): Observable<{ qrUrl: string; expiresAt: number; presenti: number }> { return this.http.get<any>(`${this.apiUrl}/stazioni/me/qr`); }
  updateStazionePosition(lat: number, lng: number): Observable<any> { return this.http.post(`${this.apiUrl}/stazioni/me/position`, { lat, lng }); }

  // --- Stazioni CRUD (Cognito manager) ---
  getStazioni(): Observable<any>              { return this.http.get(`${this.apiUrl}/stazioni`); }
  getStazione(id: string): Observable<any>    { return this.http.get(`${this.apiUrl}/stazioni/${id}`); }
  createStazione(data: any): Observable<any>  { return this.http.post(`${this.apiUrl}/stazioni`, data); }
  deleteStazione(id: string): Observable<any> { return this.http.delete(`${this.apiUrl}/stazioni/${id}`); }
} 