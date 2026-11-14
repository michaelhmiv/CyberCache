import React from 'react';
import ReactDOM from 'react-dom/client';
import { NumbersHomeHarnessPage } from './NumbersHomeHarnessPage';
import '../index.css';

/**
 * Entry for the numbers-on-Home harness page (THROWAWAY,
 * 2026-11-14). Mirrors the game's main.tsx: StrictMode, index.css.
 * The AuthProvider is NOT needed here — the harness vite config
 * stubs every AuthProvider import specifier to ./authStub.tsx
 * (the auth boundary lives in the components, not providers).
 * WebGL is forced off when ?renderer=dom is present so the
 * diorama falls back to DOM art (the numbers harness parity
 * option); default captures use the production Pixi stage.
 */

const params = new URLSearchParams(window.location.search);
if (params.get('renderer') === 'dom') {
  try {
    const probe = document.createElement('canvas');
    const stub = () => {
      probe.getContext = (() => null) as typeof probe.getContext;
    };
    stub();
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value: function (type: string) {
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
        return null;
      },
    });
  } catch {
    /* best-effort */
  }
}

const el = document.getElementById('root');
if (el) {
  ReactDOM.createRoot(el).render(
    <React.StrictMode>
      <NumbersHomeHarnessPage />
    </React.StrictMode>,
  );
}
