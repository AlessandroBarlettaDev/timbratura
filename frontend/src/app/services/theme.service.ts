import { Injectable, signal } from '@angular/core';


@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly storageKey = 'theme';
  private readonly _isDark = signal(false);


  readonly isDark = this._isDark.asReadonly();

  init(): void {
    const saved = localStorage.getItem(this.storageKey);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');

    if (saved === 'dark' || (!saved && mq.matches)) {
      this.apply('dark');
    }

    mq.addEventListener('change', (e) => {
      if (!localStorage.getItem(this.storageKey)) {
        this.applyOnly(e.matches ? 'dark' : 'light');
      }
    });
  }

  toggle(): void {
    this.apply(this._isDark() ? 'light' : 'dark');
  }

  private applyOnly(theme: 'light' | 'dark'): void {
    const dark = theme === 'dark';
    if (dark) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    this._isDark.set(dark);
  }

  private apply(theme: 'light' | 'dark'): void {
    this.applyOnly(theme);
    localStorage.setItem(this.storageKey, theme);
  }
}
