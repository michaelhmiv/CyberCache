// @ts-nocheck
// iter-05 harness config (Actions variant): the base clone's config
// (auth stub plugin + '@' alias) with the dev-server fs allow list
// disabled. The local wrapper pinned /home/hatch/workspace paths for
// the symlink forest; those paths do not exist on a runner, and Vite
// refused to serve chunk-harness.html ("outside of Vite serving
// allow list"). Throwaway harness on a private runner: strict off.
import base from './vite.base.config.ts';

export default {
  ...base,
  cacheDir: '/tmp/vite-i05-cache',
  server: {
    fs: {
      strict: false,
    },
  },
};
