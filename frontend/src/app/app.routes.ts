import { Routes } from '@angular/router';
import { Login } from './components/login/login';
import { DashboardEmployee } from './components/dashboard-employee/dashboard-employee';
import { DashboardManager } from './components/dashboard-manager/dashboard-manager';

export const routes: Routes = [
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: 'login', component: Login },
  { path: 'dashboard-employee', component: DashboardEmployee },
  { path: 'dashboard-manager', component: DashboardManager },
];
