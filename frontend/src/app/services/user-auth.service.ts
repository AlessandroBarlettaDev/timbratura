import { Injectable, signal } from '@angular/core';
import { signIn, fetchAuthSession, getCurrentUser, signOut, confirmSignIn } from 'aws-amplify/auth';

@Injectable({ providedIn: 'root' })
export class AuthService {
    // Usiamo i Signals per rendere i dati reattivi nei componenti
    currentUser = signal<any>(null);
    userGroups = signal<string[]>([]);
    utente = signal<{ userId: string; nome: string; cognome: string; email: string } | null>(null);
    passwordChanged = signal<boolean>(false);
    biometricsReg   = signal<boolean>(false);

    constructor() {
        // Controlla la sessione all'avvio dell'app
        this.checkCurrentSession();
    }

    // Restituisce 'success' oppure 'password_change_required' invece di lanciare eccezioni
    // così il componente Login può gestire il cambio password senza navigare via
    async loginWithAmplify(identifier: string, password: string): Promise<'success' | 'password_change_required'> {
        await signOut().catch(() => {});

        const { isSignedIn, nextStep } = await signIn({
            username: identifier,
            password: password,
        });

        if (nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
            return 'password_change_required';
        }

        if (isSignedIn) {
            await this.checkCurrentSession();
            return 'success';
        }

        throw new Error('Errore sconosciuto');
    }

    // Completa la challenge del primo accesso con la nuova password scelta dall'utente
    async confirmNewPassword(newPassword: string): Promise<void> {
        const { isSignedIn } = await confirmSignIn({ challengeResponse: newPassword });
        if (!isSignedIn) throw new Error('Errore durante il cambio password');
        await this.checkCurrentSession();
    }

    // Recupera i dati dell'utente e i gruppi dai token
    async checkCurrentSession() {
        try {
            const session = await fetchAuthSession();
            const user = await getCurrentUser();

            if (session.tokens) {
                this.currentUser.set(user);

                // Estraiamo i gruppi dai claim del token ID
                const payload = session.tokens.idToken?.payload;
                this.userGroups.set((payload?.['cognito:groups'] as string[]) || []);

                // Estraiamo nome, cognome ed email dal token — disponibili ovunque nell'app
                this.utente.set({
                    userId:  user.username,
                    nome:    payload?.['given_name']  as string ?? '',
                    cognome: payload?.['family_name'] as string ?? '',
                    email:   payload?.['email']       as string ?? '',
                });
                this.passwordChanged.set(payload?.['custom:password_changed'] === 'true');
                this.biometricsReg.set(payload?.['custom:biometrics_reg']     === 'true');
            }
        } catch (err) {
            this.currentUser.set(null);
            this.userGroups.set([]);
            this.utente.set(null);
            this.passwordChanged.set(false);
            this.biometricsReg.set(false);
        }
    }

    // --- Helper per i controlli rapidi ---

    get isManager(): boolean {
        return this.userGroups().includes('manager');
    }

    get isEmployee(): boolean {
        return this.userGroups().includes('employee');
    }

    async getToken(): Promise<string | null> {
        try {
            const session = await fetchAuthSession();
            return session.tokens?.idToken?.toString() ?? null;
        } catch {
            return null;
        }
    }

    async getUserEmail(): Promise<string | undefined> {
        const session = await fetchAuthSession();
        return session.tokens?.idToken?.payload['email'] as string;
    }

    async logout() {
        await signOut();
        this.currentUser.set(null);
        this.userGroups.set([]);
        this.utente.set(null);
        window.location.href = '/login';
    }
}