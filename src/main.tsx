import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { ProfileRecordDemo } from './demo/ProfileRecordDemo';
import { setSession } from './lib/api/session';
import { AccountStorageBoundary } from './auth/AccountStorageBoundary';
import { AuthProvider } from './auth/AuthProvider';
import { GlobalErrorBoundary } from './components/debug/GlobalErrorBoundary';

function renderErrorToRoot(error: unknown, source: string) {
  const root = document.getElementById('root');
  if (!root) return;

  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const stack = error instanceof Error ? error.stack : '';

  root.innerHTML = `
    <div style="min-height:100vh;padding:16px;background:#08090d;color:#f3f4f6;font-family:sans-serif;display:flex;flex-direction:column;gap:12px;">
      <div style="font-size:20px;font-weight:900;color:#ff4b5c;">App Failed to Start (${source})</div>
      <div style="font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.12em;">CyberCache mobile debug</div>
      <div style="padding:12px;border:1px solid rgba(255,75,92,0.4);border-radius:8px;background:#0e1016;word-break:break-word;font-size:13px;color:#f3f4f6;">${message}</div>
      ${stack ? `<div style="padding:12px;border:1px solid #2a2d36;border-radius:8px;background:#0e1016;overflow:auto;max-height:60vh;"><pre style="white-space:pre-wrap;font-size:11px;color:#9ca3af;margin:0;">${stack}</pre></div>` : ''}
      <button onclick="window.location.reload()" style="padding:12px;border-radius:8px;background:#ffb800;color:#08090d;font-weight:900;border:none;cursor:pointer;">Reload App</button>
    </div>
  `;
}

window.addEventListener('error', (event) => {
  console.error('[global error]', event.error);
  renderErrorToRoot(event.error ?? event.message, 'window.onerror');
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[global unhandledrejection]', event.reason);
  renderErrorToRoot(event.reason, 'unhandledrejection');
});

// PROTOTYPE (design/hunter-subpages-profile): /profile-demo mounts
// the Profile record-plate fixture harness instead of the app. This
// branch dies with the prototype; it is never merged.
if (window.location.pathname.startsWith('/profile-demo')) {
  // Install the fixture session through the app's OWN session writer
  // before first render, so the AuthProvider boot restores a signed-in
  // user and the screen's user-guarded reads fire against the seam.
  await setSession({
    accessToken: 'fixture-access',
    refreshToken: 'fixture-refresh',
    refreshExpiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    account: { id: 'fixture-rook', email: 'rook@example.com', isGuest: false, emailVerified: true },
  });
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <GlobalErrorBoundary>
        <AuthProvider>
          <ProfileRecordDemo />
        </AuthProvider>
      </GlobalErrorBoundary>
    </StrictMode>,
  );
} else try {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <GlobalErrorBoundary>
        <AuthProvider>
          <AccountStorageBoundary>
            <App />
          </AccountStorageBoundary>
        </AuthProvider>
      </GlobalErrorBoundary>
    </StrictMode>,
  );
} catch (error) {
  console.error('[createRoot] failed to render:', error);
  renderErrorToRoot(error, 'createRoot');
}
