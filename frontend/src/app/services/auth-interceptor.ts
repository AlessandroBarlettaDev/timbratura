// Interceptor HTTP che aggiunge il token JWT corretto a ogni richiesta:
// - rotte /stazioni/me/* → JWT custom della stazione (sincrono, da localStorage)
// - tutte le altre rotte → JWT Cognito dell'utente (asincrono, da Amplify)
import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './user-auth.service';
import { StationAuthService } from './station-auth.service';
import { from, switchMap } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService    = inject(AuthService);
  const stationAuth    = inject(StationAuthService);

  // Le rotte della stazione usano il JWT custom — il token è già in localStorage
  if (req.url.includes('/stazioni/me/')) {
    const token = stationAuth.getToken();
    if (token) {
      return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
    }
    return next(req);
  }

  // Tutte le altre rotte usano il JWT Cognito (ottenuto in modo asincrono da Amplify)
  return from(authService.getToken()).pipe(
    switchMap(token => {
      if (token) {
        return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
      }
      return next(req);
    })
  );
};