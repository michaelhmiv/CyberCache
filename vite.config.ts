// @ts-nocheck
// iter-05 harness clone config: the base clone's config (auth stub
// plugin + '@' alias) with the dev-server widened to serve the
// symlink forest (clone root + base realpaths) and the Vite cache
// redirected to /tmp so nothing writes into the shared base tree.
import base from './vite.base.config.ts';

export default {
  ...base,
  cacheDir: '/tmp/vite-i05-cache',
  server: {
    fs: {
      allow: ['/home/hatch/workspace/cc-dash-i05', '/home/hatch/workspace/cc-vendor-qty-wt'],
    },
  },
};
