import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../src/app/services/user-auth.service';

vi.mock('aws-amplify/auth', () => ({
  signIn:           vi.fn(),
  signOut:          vi.fn().mockResolvedValue(undefined),
  fetchAuthSession: vi.fn().mockResolvedValue({ tokens: undefined }),
  getCurrentUser:   vi.fn().mockResolvedValue({ username: 'user-1' }),
  confirmSignIn:    vi.fn(),
}));

import {
  signIn, signOut, fetchAuthSession, getCurrentUser, confirmSignIn,
} from 'aws-amplify/auth';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default: sessione non autenticata
    vi.mocked(fetchAuthSession).mockResolvedValue({ tokens: undefined } as any);
    vi.mocked(signOut).mockResolvedValue(undefined as any);

    TestBed.configureTestingModule({});
    service = TestBed.inject(AuthService);
    // Aspetta il checkCurrentSession asincrono del costruttore
    await vi.mocked(fetchAuthSession).mock.results.at(-1)?.value;
  });

  // ── loginWithAmplify ──────────────────────────────────────────────────────

  it('restituisce "success" dopo un login corretto', async () => {
    vi.mocked(signIn).mockResolvedValue({
      isSignedIn: true,
      nextStep: { signInStep: 'DONE' },
    } as any);

    const result = await service.loginWithAmplify('user@test.it', 'Password1!');

    expect(result).toBe('success');
    expect(signIn).toHaveBeenCalledWith({ username: 'user@test.it', password: 'Password1!' });
  });

  it('restituisce "password_change_required" al primo accesso', async () => {
    vi.mocked(signIn).mockResolvedValue({
      isSignedIn: false,
      nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED' },
    } as any);

    const result = await service.loginWithAmplify('user@test.it', 'TempPass1!');

    expect(result).toBe('password_change_required');
  });

  it('lancia errore se signIn termina in stato sconosciuto', async () => {
    vi.mocked(signIn).mockResolvedValue({
      isSignedIn: false,
      nextStep: { signInStep: 'SOME_UNKNOWN_STEP' },
    } as any);

    await expect(service.loginWithAmplify('u', 'p')).rejects.toThrow();
  });

  // ── checkCurrentSession ───────────────────────────────────────────────────

  it('popola i signal utente dalla sessione autenticata', async () => {
    const fakePayload = {
      'cognito:groups': ['employee'],
      given_name:  'Mario',
      family_name: 'Rossi',
      email:       'mario@test.it',
      'custom:password_changed': 'true',
      'custom:biometrics_reg':   'false',
    };
    vi.mocked(fetchAuthSession).mockResolvedValue({
      tokens: { idToken: { payload: fakePayload, toString: () => 'fake-token' } },
    } as any);
    vi.mocked(getCurrentUser).mockResolvedValue({ username: 'mario-id' } as any);

    await service.checkCurrentSession();

    expect(service.utente()).toEqual({
      userId:  'mario-id',
      nome:    'Mario',
      cognome: 'Rossi',
      email:   'mario@test.it',
    });
    expect(service.userGroups()).toContain('employee');
    expect(service.passwordChanged()).toBe(true);
    expect(service.biometricsReg()).toBe(false);
    expect(service.currentUser()).toEqual({ username: 'mario-id' });
  });

  it('azzera i signal se la sessione fallisce', async () => {
    vi.mocked(fetchAuthSession).mockRejectedValueOnce(new Error('not authenticated'));

    await service.checkCurrentSession();

    expect(service.currentUser()).toBeNull();
    expect(service.utente()).toBeNull();
    expect(service.userGroups()).toEqual([]);
  });

  // ── isManager / isEmployee ────────────────────────────────────────────────

  it('isManager è true quando il gruppo include manager', () => {
    service.userGroups.set(['manager']);
    expect(service.isManager).toBe(true);
    expect(service.isEmployee).toBe(false);
  });

  it('isEmployee è true quando il gruppo include employee', () => {
    service.userGroups.set(['employee']);
    expect(service.isEmployee).toBe(true);
    expect(service.isManager).toBe(false);
  });

  // ── getToken ──────────────────────────────────────────────────────────────

  it('getToken restituisce il token ID come stringa', async () => {
    vi.mocked(fetchAuthSession).mockResolvedValue({
      tokens: { idToken: { toString: () => 'my-id-token' } },
    } as any);

    const token = await service.getToken();
    expect(token).toBe('my-id-token');
  });

  it('getToken restituisce null se non autenticato', async () => {
    vi.mocked(fetchAuthSession).mockRejectedValueOnce(new Error('no session'));

    const token = await service.getToken();
    expect(token).toBeNull();
  });

  // ── logout ────────────────────────────────────────────────────────────────

  it('logout chiama signOut e azzera lo stato', async () => {
    service.currentUser.set({ username: 'user-1' });
    service.userGroups.set(['employee']);
    service.utente.set({ userId: 'u1', nome: 'Mario', cognome: 'Rossi', email: 'x@x.it' });

    // Evita errori su window.location.href in jsdom
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
      configurable: true,
    });

    await service.logout();

    expect(signOut).toHaveBeenCalled();
    expect(service.currentUser()).toBeNull();
    expect(service.utente()).toBeNull();
    expect(service.userGroups()).toEqual([]);
    expect(window.location.href).toBe('/login');
  });
});
