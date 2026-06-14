import { spawnSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import process from 'node:process';

const gradleArgs = process.argv.slice(2);

if (gradleArgs.length === 0) {
  console.error('[android] Missing Gradle task. Example: node scripts/run-gradle-wrapper.mjs bundleRelease');
  process.exit(1);
}

const isWindows = process.platform === 'win32';
const gradleCommand = isWindows ? 'gradlew.bat' : './gradlew';

if (!isWindows) {
  chmodSync('android/gradlew', 0o755);
}

const result = spawnSync(gradleCommand, gradleArgs, {
  cwd: 'android',
  stdio: 'inherit',
  shell: isWindows,
});

if (typeof result.status === 'number') process.exit(result.status);

if (result.error) {
  console.error('[android] Failed to run Gradle wrapper:', result.error.message);
}
process.exit(1);
