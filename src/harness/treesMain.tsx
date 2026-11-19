import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

// Trees harness (first-screen fix R1 render round): Chef API
// calls in the capture rig resolve same-origin — answer them
// fast and offline so mount-time reads settle immediately. One
// exception: the action-skill read gets a REAL state view,
// built by the content module's own actionSkillStateView from
// the harness seed, so the shipped Action Skill plate renders
// its true unqualified state instead of vanishing. The seeded
// stores carry every other value the screen renders; nothing
// here is imported by the app bundle.
import { actionSkillStateView } from '@/content/actionSkills';
import { TREES_SEED_SPENT, TreesHarnessPage } from './TreesHarnessPage';

const realFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/action-skill/me')) {
    const view = actionSkillStateView({
      spent: { ...TREES_SEED_SPENT },
      classModBoosts: {},
      selection: null,
      charge: 0,
    });
    return Promise.resolve(
      new Response(JSON.stringify({ actionSkill: view }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }
  if (url.includes('/api/')) {
    return Promise.resolve(
      new Response(JSON.stringify({ error: 'harness offline' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }
  return realFetch(input, init);
};

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <TreesHarnessPage />
    </React.StrictMode>,
  );
}
