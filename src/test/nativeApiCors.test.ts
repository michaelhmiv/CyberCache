import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const serverIndex = readFileSync(resolve(process.cwd(), 'src/server/index.ts'), 'utf8');

describe('native API CORS contract', () => {
  it('allows Capacitor WebView origins to call server-authoritative Chef API routes', () => {
    expect(serverIndex).toContain("'http://localhost'");
    expect(serverIndex).toContain("'capacitor://localhost'");
    expect(serverIndex).toContain("app.use('/api', apiCors)");
  });

  it('answers API preflights with the headers required by authenticated Chef POSTs', () => {
    expect(serverIndex).toContain("Access-Control-Allow-Origin");
    expect(serverIndex).toContain("Access-Control-Allow-Methods', 'GET,POST,OPTIONS'");
    expect(serverIndex).toContain("Access-Control-Allow-Headers', 'Content-Type,Authorization'");
    expect(serverIndex).toContain("req.method === 'OPTIONS'");
    expect(serverIndex).toContain('res.status(204).end()');
  });

  it('keeps CORS scoped to /api instead of the static app shell', () => {
    expect(serverIndex).toContain("app.use('/api', apiCors)");
    expect(serverIndex).not.toContain('app.use(apiCors)');
  });
});
