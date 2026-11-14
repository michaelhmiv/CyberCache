import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

const params = new URLSearchParams(window.location.search);
if (params.get('renderer') === 'dom') {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
    return (original as (this: HTMLCanvasElement, ...args: unknown[]) => unknown).call(this, type, ...rest) as RenderingContext | null;
  } as typeof HTMLCanvasElement.prototype.getContext;
}

import { SignalHarnessPage } from './SignalHarnessPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <SignalHarnessPage />
    </React.StrictMode>,
  );
}
