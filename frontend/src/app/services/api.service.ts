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

} 