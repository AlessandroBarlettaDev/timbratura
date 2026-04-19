import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { authInterceptor } from '../../src/app/services/auth-interceptor';
import { AuthService } from '../../src/app/services/user-auth.service';
import { StationAuthService } from '../../src/app/services/station-auth.service';
import { vi } from 'vitest';

vi.mock('aws-amplify/auth', () => ({
  signIn:           vi.fn(),
  signOut:          vi.fn().mockResolvedValue(undefined),
  fetchAuthSession: vi.fn().mockResolvedValue({ tokens: undefined }),
  getCurrentUser:   vi.fn().mockResolvedValue({ username: 'u' }),
  confirmSignIn:    vi.fn(),
}));

// Attende che la coda microtask si svuoti (per interceptor che usano Promise)
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function setup(authToken: string | null, stationToken: string | null) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      { provide: AuthService,        useValue: { getToken: () => Promise.resolve(authToken) } },
      { provide: StationAuthService, useValue: { getToken: () => stationToken            } },
    ],
  });
  return {
    http:     TestBed.inject(HttpClient),
    httpMock: TestBed.inject(HttpTestingController),
  };
}

afterEach(() => TestBed.inject(HttpTestingController).verify());

describe('rotte utente (Cognito)', () => {
  it('aggiunge Bearer <token> per le rotte normali', async () => {
    const { http, httpMock } = setup('cognito-token', null);

    http.get('/api/users').subscribe();
    await tick();

    const req = httpMock.expectOne('/api/users');
    expect(req.request.headers.get('Authorization')).toBe('Bearer cognito-token');
    req.flush({});
  });

  it('non aggiunge Authorization se il token è null', async () => {
    const { http, httpMock } = setup(null, null);

    http.get('/api/timbrature').subscribe();
    await tick();

    const req = httpMock.expectOne('/api/timbrature');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });
});

describe('rotte stazione (/stazioni/me/)', () => {
  it('aggiunge Bearer <token> stazione (flusso sincrono)', async () => {
    const { http, httpMock } = setup(null, 'station-token');

    http.get('/api/stazioni/me/qr').subscribe();
    // Nessun await: il token stazione è letto in modo sincrono

    const req = httpMock.expectOne('/api/stazioni/me/qr');
    expect(req.request.headers.get('Authorization')).toBe('Bearer station-token');
    req.flush({});
  });

  it('non aggiunge Authorization se il token stazione è null', async () => {
    const { http, httpMock } = setup(null, null);

    http.get('/api/stazioni/me/position').subscribe();

    const req = httpMock.expectOne('/api/stazioni/me/position');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });
});
