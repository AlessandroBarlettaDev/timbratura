import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly storageKey = 'theme';
  private readonly _isDark = signal(false);

  readonly isDark = this._isDark.asReadonly();

  init(): void {
    const saved = localStorage.getItem(this.storageKey);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (saved === 'dark' || (!saved && prefersDark)) {
      this.apply('dark');
    }
  }

  toggle(): void {
    this.apply(this._isDark() ? 'light' : 'dark');
  }

  private apply(theme: 'light' | 'dark'): void {
    const dark = theme === 'dark';
    if (dark) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    this._isDark.set(dark);
    localStorage.setItem(this.storageKey, theme);
  }
}
