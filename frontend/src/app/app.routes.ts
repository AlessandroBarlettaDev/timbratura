import { Routes } from '@angular/router';
import { Login } from './components/login/login';
import { FirstAccess } from './components/first-access/first-access';
import { DashboardEmployee } from './components/dashboard-employee/dashboard-employee';
import { DashboardManager } from './components/dashboard-manager/dashboard-manager';
import { Station } from './components/station/station';
import { Timbratura } from './components/timbratura/timbratura';
import { authGuard, onboardingGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: '',                   redirectTo: '/login', pathMatch: 'full' },
  { path: 'login',              component: Login },
  { path: 'first-access',       component: FirstAccess,        canActivate: [authGuard] },
  { path: 'dashboard-employee', component: DashboardEmployee,  canActivate: [onboardingGuard] },
  { path: 'dashboard-manager',  component: DashboardManager,   canActivate: [onboardingGuard] },
  { path: 'stazione',           component: Station },           // login proprio con JWT custom
  { path: 'timbratura',         component: Timbratura },        // pubblica — aperta da QR scan
];
