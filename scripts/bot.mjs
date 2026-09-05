#!/usr/bin/env node
// Starts the local bot, and only ever one of it.
//
// Two gateway connections on the same token both receive every message, so the
// bot answers twice and the second answer comes from whichever copy of the code
// that process started with. Restarting therefore means killing every one of
// them first, not just the one we remember.
//
//   node scripts/bot.mjs stop
//   node scripts/bot.mjs start
import { spawn, spawnSync } from 'node:child_process';
import { openSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const botDir = fileURLToPath(new URL('apps/bot/', root));

function running() {
  const ps = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*index.ts*' } | ForEach-Object { $_.ProcessId }",
    ],
    { encoding: 'utf8' },
  );
  return (ps.stdout ?? '')
    .split(/\s+/)
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0);
}

function stop() {
  const ids = running();
  for (const id of ids) {
    spawnSync('powershell.exe', ['-NoProfile', '-Command', `Stop-Process -Id ${id} -Force`]);
  }
  console.log(ids.length === 0 ? 'no bot was running' : `stopped ${ids.length} process(es)`);
}

const command = process.argv[2] ?? 'start';
if (command === 'stop') {
  stop();
} else {
  stop();
  // Its output goes to a file rather than nowhere, so a restart can be checked.
  const log = openSync(fileURLToPath(new URL('bot.log', root)), 'a');
  const child = spawn(process.execPath, ['./node_modules/tsx/dist/cli.mjs', 'src/index.ts'], {
    cwd: botDir,
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
  console.log(`started the bot as pid ${child.pid}; output goes to bot.log`);
}
