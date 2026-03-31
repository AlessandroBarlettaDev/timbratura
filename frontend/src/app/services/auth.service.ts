import { Injectable, signal } from '@angular/core';
import { signIn, fetchAuthSession, getCurrentUser, signOut } from 'aws-amplify/auth';

@Injectable({ providedIn: 'root' })
export class AuthService {
    // Usiamo i Signals per rendere i dati reattivi nei componenti
    currentUser = signal<any>(null);
    userGroups = signal<string[]>([]);

    constructor() {
        // Controlla la sessione all'avvio dell'app
        this.checkCurrentSession();
    }

    async loginWithAmplify(identifier: string, password: string): Promise<string> {
        try {
            // Se c'è già una sessione attiva la chiudiamo prima di fare login
            await signOut().catch(() => {});

            const { isSignedIn, nextStep } = await signIn({
                username: identifier,
                password: password,
            });

            if (nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
                throw new Error('PASSWORD_CHANGE_REQUIRED');
            }

            if (isSignedIn) {
                await this.checkCurrentSession(); // Popola le variabili dopo il login
                const session = await fetchAuthSession();
                return session.tokens?.idToken?.toString() || '';
            }

            throw new Error('Errore sconosciuto');
        } catch (error: any) {
            throw error;
        }
    }

    // Recupera i dati dell'utente e i gruppi dai token
    async checkCurrentSession() {
        try {
            const session = await fetchAuthSession();
            const user = await getCurrentUser();

            if (session.tokens) {
                this.currentUser.set(user);
                
                // Estraiamo i gruppi dai claim del token ID
                const groups = session.tokens.idToken?.payload['cognito:groups'] as string[];
                this.userGroups.set(groups || []);
            }
        } catch (err) {
            this.currentUser.set(null);
            this.userGroups.set([]);
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
        window.location.href = '/login';
    }
}