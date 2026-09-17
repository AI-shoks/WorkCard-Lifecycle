import { ownerCli } from './owner-cli.js';

const command = process.argv[2];
if (
  process.argv.length !== 3 ||
  !['bootstrap', 'reset', 'verify', 'release'].includes(command ?? '')
) {
  process.stderr.write('Usage: owner-maintenance.js bootstrap|reset|verify|release\n');
  process.exitCode = 1;
} else {
  await ownerCli(command as 'bootstrap' | 'reset' | 'verify' | 'release');
}
