import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

// PR #646 before/after capture main (dev only): pick the auth
// mode for this page load, install the fetch backstop, then
// render the harness page. Auth mode: ?auth= wins; the App
// (onboarding) page defaults to a fresh account and the Profile
// Account page can pass ?auth=guest.
const params = new URLSearchParams(window.location.search);
const screen = params.get('screen') ?? 'profile';
const auth = params.get('auth') ?? (screen === 'app' ? 'fresh' : 'verified');
(window as unknown as { __PR646_AUTH__?: string }).__PR646_AUTH__ = auth;

import { installPr646Backstop } from './pr646Backstop';

installPr646Backstop();

import { Pr646HarnessPage } from './Pr646HarnessPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <Pr646HarnessPage />
    </React.StrictMode>,
  );
}
