import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/user-auth.service';

// Guard per route protette: richiede sessione Cognito attiva
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
export const onboardingGuard: CanActivateFn = async () => {
    const auth   = inject(AuthService);
    const router = inject(Router);

    await auth.checkCurrentSession();

    if (!auth.currentUser()) {
        router.navigate(['/login']);
        return false;
    }
    if (!auth.passwordChanged() || !auth.biometricsReg()) {
        router.navigate(['/first-access']);
        return false;
    }
    return true;
};
