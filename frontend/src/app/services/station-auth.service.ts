import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';

// Dati della stazione salvati in localStorage dopo il login
interface StazioneInfo {
  stationId: string;
  nome:      string;
  codice:    string;
}

const TOKEN_KEY   = 'station_token';
const INFO_KEY    = 'station_info';

@Injectable({ providedIn: 'root' })
export class StationAuthService {
  private apiUrl = environment.ApiUrl;

  constructor(private http: HttpClient) {}

  // Autentica la stazione con codice e password — salva JWT e info in localStorage
  async login(codice: string, password: string): Promise<void> {
    const res: any = await firstValueFrom(
      this.http.post(`${this.apiUrl}/stazioni/login`, { codice, password })
    );
    localStorage.setItem(TOKEN_KEY, res.token);
    localStorage.setItem(INFO_KEY,  JSON.stringify(res.stazione));
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(INFO_KEY);
  }

  // Restituisce il JWT della stazione — usato da StationApiService per le chiamate autenticate
  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  // Restituisce le info della stazione (nome, codice, id)
  getStazione(): StazioneInfo | null {
    const raw = localStorage.getItem(INFO_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  // Controlla se c'è un token valido (non scaduto)
  isLoggedIn(): boolean {
    const token = this.getToken();
    if (!token) return false;
    try {
      // Il payload è la seconda parte del JWT (base64url)
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp > Math.floor(Date.now() / 1000);
    } catch {
      return false;
    }
  }
}
