import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiService } from '../../src/app/services/api.service';
import { environment } from '../../src/app/environments/environment';

const BASE = environment.ApiUrl;

describe('ApiService', () => {
  let service: ApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ApiService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service  = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  // ── Utenti ────────────────────────────────────────────────────────────────

  it('getUsers fa GET su /users', () => {
    service.getUsers().subscribe();
    httpMock.expectOne(`${BASE}/users`).flush([]);
  });

  it('createUser fa POST su /users con il body corretto', () => {
    const body = { nome: 'Mario', ruolo: 'employee' };
    service.createUser(body).subscribe();
    const req = httpMock.expectOne(`${BASE}/users`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush({ userId: 'new-1' });
  });

  it('modifyUser fa PUT su /users/:id', () => {
    service.modifyUser('u-1', { nome: 'Luigi' }).subscribe();
    const req = httpMock.expectOne(`${BASE}/users/u-1`);
    expect(req.request.method).toBe('PUT');
    req.flush({});
  });

  it('deleteUser fa DELETE su /users/:id', () => {
    service.deleteUser('u-1').subscribe();
    const req = httpMock.expectOne(`${BASE}/users/u-1`);
    expect(req.request.method).toBe('DELETE');
    req.flush({});
  });

  it('resetPassword fa POST su /users/:id/reset-password', () => {
    service.resetPassword('u-1').subscribe();
    const req = httpMock.expectOne(`${BASE}/users/u-1/reset-password`);
    expect(req.request.method).toBe('POST');
    req.flush({});
  });

  // ── Timbrature ────────────────────────────────────────────────────────────

  it('registraTimbratura fa POST su /timbrature', () => {
    const data = { stationId: 's-1', qrToken: 'tok' };
    service.registraTimbratura(data).subscribe();
    const req = httpMock.expectOne(`${BASE}/timbrature`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(data);
    req.flush({ tipo: 'entrata' });
  });

  it('anteprimaTimbratura fa POST su /timbrature/anteprima', () => {
    service.anteprimaTimbratura({ stationId: 's-1' }).subscribe();
    const req = httpMock.expectOne(`${BASE}/timbrature/anteprima`);
    expect(req.request.method).toBe('POST');
    req.flush({ tipo: 'entrata', confirmToken: 'abc' });
  });

  it('confermaTimbratura fa POST su /timbrature/conferma con token e override', () => {
    service.confermaTimbratura('token-123', 'entrata').subscribe();
    const req = httpMock.expectOne(`${BASE}/timbrature/conferma`);
    expect(req.request.body).toEqual({ confirmToken: 'token-123', tipoOverride: 'entrata' });
    req.flush({ tipo: 'entrata' });
  });

  it('getMieTimbrature fa GET su /timbrature/me con mese opzionale', () => {
    service.getMieTimbrature('2025-03').subscribe();
    httpMock.expectOne(`${BASE}/timbrature/me?mese=2025-03`).flush([]);
  });

  it('getMieTimbrature fa GET su /timbrature/me senza query se mese assente', () => {
    service.getMieTimbrature().subscribe();
    httpMock.expectOne(`${BASE}/timbrature/me`).flush([]);
  });

  it('getTimbratureUtente costruisce correttamente la query', () => {
    service.getTimbratureUtente('u-1', '2025-04').subscribe();
    httpMock.expectOne(`${BASE}/timbrature?userId=u-1&mese=2025-04`).flush([]);
  });

  it('getDashboardOggi fa GET su /timbrature/dashboard', () => {
    service.getDashboardOggi().subscribe();
    httpMock.expectOne(`${BASE}/timbrature/dashboard`).flush([]);
  });

  // ── Stazioni ──────────────────────────────────────────────────────────────

  it('getStazioneQr fa GET su /stazioni/me/qr', () => {
    service.getStazioneQr().subscribe();
    httpMock.expectOne(`${BASE}/stazioni/me/qr`).flush({});
  });

  it('getStazioni fa GET su /stazioni', () => {
    service.getStazioni().subscribe();
    httpMock.expectOne(`${BASE}/stazioni`).flush([]);
  });

  it('createStazione fa POST su /stazioni', () => {
    const data = { codice: 'S001', descrizione: 'Ingresso' };
    service.createStazione(data).subscribe();
    const req = httpMock.expectOne(`${BASE}/stazioni`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(data);
    req.flush({});
  });

  it('deleteStazione fa DELETE su /stazioni/:id', () => {
    service.deleteStazione('s-1').subscribe();
    const req = httpMock.expectOne(`${BASE}/stazioni/s-1`);
    expect(req.request.method).toBe('DELETE');
    req.flush({});
  });

  // ── Contratti ─────────────────────────────────────────────────────────────

  it('getMyContracts fa GET su /contracts/me', () => {
    service.getMyContracts().subscribe();
    httpMock.expectOne(`${BASE}/contracts/me`).flush([]);
  });

  it('createContract fa POST su /contracts', () => {
    const data = { tipo: 'full-time' };
    service.createContract(data).subscribe();
    const req = httpMock.expectOne(`${BASE}/contracts`);
    expect(req.request.method).toBe('POST');
    req.flush({});
  });
});
