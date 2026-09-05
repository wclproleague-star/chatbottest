#!/usr/bin/env node
// Runs the dev server out of its own directory.
//
// `next dev` and `next build` share .next by default, so building while the
// dev server is up replaces the chunks it is still serving: every open page
// comes back as raw HTML with a 404 for its stylesheet, and only a restart
// fixes it. The dev server writes to .next-dev instead, and a build cannot
// touch it. Production is unchanged: `next build` still writes .next.

import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const next = fileURLToPath(new URL('node_modules/next/dist/bin/next', import.meta.url));
const child = spawn(process.execPath, [next, 'dev', '--port', '3000', ...process.argv.slice(2)], {
  cwd: fileURLToPath(new URL('.', import.meta.url)),
  env: { ...process.env, NEXT_DIST_DIR: '.next-dev' },
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 1));
