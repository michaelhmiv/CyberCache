import express, { type Express } from 'express';
import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isWebClientEnabled, mountWebClient } from '../server/webClient';

const INDEX_HTML = '<!doctype html><html><body>CYBERCACHE-WEB-CLIENT</body></html>';
const ASSET_JS = 'console.log("CYBERCACHE-ASSET");';

let distDir: string;

function stubApi(app: Express): void {
  // Mirrors mountChefHealthRoute's position in src/server/index.ts:
  // mounted before the web-client surface.
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', chef: 'ready' });
  });
}

function stubLateApi(app: Express): void {
  // Route B's API routes mount asynchronously AFTER the web-client
  // surface in src/server/index.ts; the gate must let /api through to
  // them even when it is off.
  app.get('/api/ping', (_req, res) => {
    res.json({ pong: true });
  });
}

async function boot(enabled: boolean): Promise<{ base: string; server: Server }> {
  const app = express();
  stubApi(app);
  mountWebClient(app, distDir, enabled);
  stubLateApi(app);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, server };
}

const servers: Server[] = [];

beforeAll(() => {
  distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-webclient-dist-'));
  fs.mkdirSync(path.join(distDir, 'assets'));
  fs.writeFileSync(path.join(distDir, 'index.html'), INDEX_HTML);
  fs.writeFileSync(path.join(distDir, 'assets', 'app.js'), ASSET_JS);
});

afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  fs.rmSync(distDir, { recursive: true, force: true });
});

describe('isWebClientEnabled', () => {
  it('serves by default (flag unset or empty)', () => {
    expect(isWebClientEnabled({})).toBe(true);
    expect(isWebClientEnabled({ SERVE_WEB_CLIENT: '' })).toBe(true);
    expect(isWebClientEnabled({ SERVE_WEB_CLIENT: '  ' })).toBe(true);
  });

  it('serves for any non-off value', () => {
    for (const v of ['true', '1', 'yes', 'on', 'serve']) {
      expect(isWebClientEnabled({ SERVE_WEB_CLIENT: v })).toBe(true);
    }
  });

  it('turns off only for an explicit off value, any case', () => {
    for (const v of ['false', 'FALSE', ' False ', '0', 'off', 'Off', 'no', 'NO']) {
      expect(isWebClientEnabled({ SERVE_WEB_CLIENT: v })).toBe(false);
    }
  });
});

describe('web client served (flag on — the default everywhere but production)', () => {
  let base: string;

  beforeAll(async () => {
    const b = await boot(true);
    base = b.base;
    servers.push(b.server);
  });

  it('serves the page at / and /index.html', async () => {
    for (const p of ['/', '/index.html']) {
      const res = await fetch(`${base}${p}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('CYBERCACHE-WEB-CLIENT');
    }
  });

  it('serves static assets', async () => {
    const res = await fetch(`${base}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('CYBERCACHE-ASSET');
  });

  it('serves index.html for SPA routes (fallback)', async () => {
    const res = await fetch(`${base}/some/deep/route`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('CYBERCACHE-WEB-CLIENT');
  });

  it('answers /health (the e2e workflow probes it)', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
  });

  it('leaves the API exactly as it was', async () => {
    const health = await fetch(`${base}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', chef: 'ready' });

    const ping = await fetch(`${base}/api/ping`);
    expect(ping.status).toBe(200);
    expect(await ping.json()).toEqual({ pong: true });
  });
});

describe('web client off (production app-only mode)', () => {
  let base: string;

  beforeAll(async () => {
    const b = await boot(false);
    base = b.base;
    servers.push(b.server);
  });

  it('404s the page and the index', async () => {
    for (const p of ['/', '/index.html']) {
      const res = await fetch(`${base}${p}`);
      expect(res.status).toBe(404);
    }
  });

  it('404s static asset paths', async () => {
    const res = await fetch(`${base}/assets/app.js`);
    expect(res.status).toBe(404);
  });

  it('404s SPA routes instead of serving the fallback', async () => {
    const res = await fetch(`${base}/some/deep/route`);
    expect(res.status).toBe(404);
  });

  it('404s non-GET requests to the page too', async () => {
    const res = await fetch(`${base}/`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('keeps /health answering 200', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', chef: 'ready' });
  });

  it('leaves the API exactly as it was, including routes mounted after the gate', async () => {
    const health = await fetch(`${base}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', chef: 'ready' });

    const ping = await fetch(`${base}/api/ping`);
    expect(ping.status).toBe(200);
    expect(await ping.json()).toEqual({ pong: true });
  });
});
