
// Interceptor HTTP che aggiunge il token JWT alle richieste
import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';
import { from, switchMap } from 'rxjs';


// Funzione interceptor che intercetta tutte le richieste HTTP
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // Recupera l'istanza di AuthService tramite dependency injection
  const authService = inject(AuthService);

  // Ottiene il token JWT in modo asincrono (può essere una Promise)
  return from(authService.getToken()).pipe(
    switchMap(token => {
      // Se il token esiste, clona la richiesta e aggiunge l'header Authorization
      if (token) {
        const cloned = req.clone({
          setHeaders: { Authorization: `Bearer ${token}` }
        });
        // Passa la richiesta clonata (con token) al prossimo handler
        return next(cloned);
      }
      // Se non c'è token, passa la richiesta originale
      return next(req);
    })
  );
};