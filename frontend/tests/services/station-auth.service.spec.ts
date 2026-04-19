import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { StationAuthService } from '../../src/app/services/station-auth.service';
import { environment } from '../../src/app/environments/environment';

const BASE = environment.ApiUrl;

function makeJwt(payload: object): string {
  // Crea un JWT finto con un payload base64url valido
  const encoded = btoa(JSON.stringify(payload)).replace(/=/g, '');
  return `header.${encoded}.signature`;
}

describe('StationAuthService', () => {
  let service: StationAuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        StationAuthService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service  = TestBed.inject(StationAuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  // ── login ─────────────────────────────────────────────────────────────────

  it('login salva token e info stazione in localStorage', async () => {
    const fakeStazione = { stationId: 's-1', descrizione: 'Ingresso', codice: 'ING' };
    const loginPromise = service.login('ING', 'secret');

    const req = httpMock.expectOne(`${BASE}/stazioni/login`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ codice: 'ING', password: 'secret' });
    req.flush({ token: 'jwt-station', stazione: fakeStazione });

    await loginPromise;

    expect(localStorage.getItem('station_token')).toBe('jwt-station');
    expect(JSON.parse(localStorage.getItem('station_info')!)).toEqual(fakeStazione);
  });

  // ── logout ────────────────────────────────────────────────────────────────

  it('logout rimuove token e info da localStorage', () => {
    localStorage.setItem('station_token', 'some-token');
    localStorage.setItem('station_info',  '{"stationId":"s-1"}');

    service.logout();

    expect(localStorage.getItem('station_token')).toBeNull();
    expect(localStorage.getItem('station_info')).toBeNull();
  });

  // ── getToken ──────────────────────────────────────────────────────────────

  it('getToken restituisce il token salvato', () => {
    localStorage.setItem('station_token', 'my-jwt');
    expect(service.getToken()).toBe('my-jwt');
  });

  it('getToken restituisce null se non presente', () => {
    expect(service.getToken()).toBeNull();
  });

  // ── getStazione ───────────────────────────────────────────────────────────

  it('getStazione restituisce le info della stazione parsate', () => {
    const info = { stationId: 's-2', descrizione: 'Uscita', codice: 'USC' };
    localStorage.setItem('station_info', JSON.stringify(info));
    expect(service.getStazione()).toEqual(info);
  });

  it('getStazione restituisce null se non presente', () => {
    expect(service.getStazione()).toBeNull();
  });

  // ── isLoggedIn ────────────────────────────────────────────────────────────

  it('isLoggedIn restituisce false se non c\'è token', () => {
    expect(service.isLoggedIn()).toBe(false);
  });

  it('isLoggedIn restituisce true per un token non scaduto', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600; // scade tra 1h
    localStorage.setItem('station_token', makeJwt({ exp }));
    expect(service.isLoggedIn()).toBe(true);
  });

  it('isLoggedIn restituisce false per un token scaduto', () => {
    const exp = Math.floor(Date.now() / 1000) - 1; // scaduto 1s fa
    localStorage.setItem('station_token', makeJwt({ exp }));
    expect(service.isLoggedIn()).toBe(false);
  });

  it('isLoggedIn restituisce false per un token malformato', () => {
    localStorage.setItem('station_token', 'non-è-un-jwt');
    expect(service.isLoggedIn()).toBe(false);
  });
});
