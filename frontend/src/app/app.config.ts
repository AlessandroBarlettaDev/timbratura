import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';

import { Amplify } from 'aws-amplify';
import { environment } from './environments/environment';
import { provideHttpClient, withInterceptors } from '@angular/common/http'; 
import { authInterceptor } from './services/auth-interceptor';

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId:               environment.UserPoolId,
      userPoolClientId:         environment.UserPoolClientId,
      signUpVerificationMethod: 'code',
      loginWith: { email: true },
    }
  }
});

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor]))
  ]


};
