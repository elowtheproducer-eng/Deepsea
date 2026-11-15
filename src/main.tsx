import React, { Component, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

if ('serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        registration.update().catch(() => {});
      }
    },
  });
}

interface ErrorBoundaryState {
  error: Error | null;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 bg-black text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-slate-950 border border-white/15 rounded-2xl p-5 space-y-3">
            <h1 className="text-base font-bold text-white">Launch Recovery</h1>
            <p className="text-xs text-slate-300 leading-relaxed">
              {this.state.error.message || 'An unexpected error occurred while initializing the ocean renderer.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="min-h-[48px] px-5 rounded-xl bg-sky-600 text-white text-xs font-semibold"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);
