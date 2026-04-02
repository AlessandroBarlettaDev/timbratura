import { Routes } from '@angular/router';
import { Login } from './components/login/login';
import { FirstAccess } from './components/first-access/first-access';
import { DashboardEmployee } from './components/dashboard-employee/dashboard-employee';
import { DashboardManager } from './components/dashboard-manager/dashboard-manager';
import { Station } from './components/station/station';

export const routes: Routes = [
  { path: '',                 redirectTo: '/login', pathMatch: 'full' },
  { path: 'login',            component: Login },
  { path: 'first-access',     component: FirstAccess },
  { path: 'dashboard-employee', component: DashboardEmployee },
  { path: 'dashboard-manager',  component: DashboardManager },
  { path: 'stazione',         component: Station },
];
