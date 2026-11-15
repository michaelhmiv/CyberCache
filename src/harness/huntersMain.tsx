import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

// DOM-forced loads (renderer=dom, and the boss/endless/huntertab/
// roster pages whose subjects are DOM components): hide WebGL from
// the detection probe before anything mounts, so the production
// renderer switches take their real fallback paths — the same swap a
// WebGL-less device gets. Dev harness only.
const params = new URLSearchParams(window.location.search);
const page = params.get('page') ?? 'roam';
if (params.get('renderer') === 'dom' || page === 'boss' || page === 'endless' || page === 'huntertab' || page === 'roster') {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
    return (original as (this: HTMLCanvasElement, ...args: unknown[]) => unknown).call(this, type, ...rest) as RenderingContext | null;
  } as typeof HTMLCanvasElement.prototype.getContext;
}

import { HuntersCapturePage } from './HuntersCapturePage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <HuntersCapturePage />
    </React.StrictMode>,
  );
}
