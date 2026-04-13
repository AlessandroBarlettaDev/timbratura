import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/user-auth.service';

// Guard per route protette: Controlla che ci sia una sessione Cognito attiva. Se non sei loggato → ti manda a /login
export const authGuard: CanActivateFn = async () => {
    const auth   = inject(AuthService);
    const router = inject(Router);

    await auth.checkCurrentSession();

    if (!auth.currentUser()) {
        router.navigate(['/login']);
        return false;
    }
    return true;
};

// Guard per dashboard/timbratura: richiede password cambiata + biometria registrata
// Usato su /dashboard-employee e /dashboard-manager
export const onboardingGuard: CanActivateFn = async () => {
    const auth   = inject(AuthService);
    const router = inject(Router);

    // Controlla sessione Cognito attivae aggiorna i signal di auth.service
    await auth.checkCurrentSession();

    // Se non loggato → /login
    if (!auth.currentUser()) {
        router.navigate(['/login']);
        return false;
    }
    // Controlla anche che tu abbia già cambiato la password e registrato la biometria (onboarding completato)
    if (!auth.passwordChanged() || !auth.biometricsReg()) {
        // Se loggato ma onboarding non completato → /first-access
        router.navigate(['/first-access']);
        return false;
    }
    return true;
};
