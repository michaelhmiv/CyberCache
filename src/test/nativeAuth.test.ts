import { describe, expect, it } from 'vitest';
import { getGoogleWebClientId, GOOGLE_WEB_CLIENT_ID_ENV } from '../lib/nativeAuth';

describe('native auth config', () => {
  it('reads the Google web client id from Vite env', () => {
    const clientId = '123-example.apps.googleusercontent.com';
    expect(getGoogleWebClientId({ VITE_GOOGLE_WEB_CLIENT_ID: ` ${clientId} ` } as ImportMetaEnv)).toBe(clientId);
  });

  it('throws an actionable error when the Google web client id is missing', () => {
    expect(() => getGoogleWebClientId({} as ImportMetaEnv)).toThrow(GOOGLE_WEB_CLIENT_ID_ENV);
    expect(() => getGoogleWebClientId({ VITE_GOOGLE_WEB_CLIENT_ID: ' ' } as ImportMetaEnv)).toThrow(
      'Google Web OAuth client ID',
    );
  });
});
