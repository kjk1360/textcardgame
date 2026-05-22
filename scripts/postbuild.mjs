#!/usr/bin/env node
/**
 * Post-build fix-ups.
 *
 * - TypeScript strips the leading `#!/usr/bin/env node` shebang from
 *   the compiled output. npm uses the shebang to make the bin entry
 *   directly executable on Unix systems. We prepend it back here.
 * - chmod +x dist/cli.js so `./dist/cli.js` works without `node` prefix
 *   on Unix (npm normally does this too via bin install, but a clean
 *   build artifact is friendlier).
 */
import { readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(__dirname, '..', 'dist', 'cli.js');

if (!existsSync(cliPath)) {
  console.error(`[postbuild] dist/cli.js not found at ${cliPath} — did tsc run?`);
  process.exit(1);
}

let source = readFileSync(cliPath, 'utf8');
const shebang = '#!/usr/bin/env node\n';
if (!source.startsWith('#!')) {
  source = shebang + source;
  writeFileSync(cliPath, source);
  console.log('[postbuild] prepended shebang to dist/cli.js');
}

try {
  chmodSync(cliPath, 0o755);
  console.log('[postbuild] chmod +x dist/cli.js');
} catch (err) {
  // Windows chmod is a no-op — silently OK.
}
