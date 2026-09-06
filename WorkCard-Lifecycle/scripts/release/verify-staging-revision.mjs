import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { validateRevisionBinding } from './hosted-smoke.mjs';
import { validateReleaseManifest } from './validate-release-manifest.mjs';

function parseOptions(arguments_) {
  const allowed = new Set([
    '--manifest',
    '--metadata',
    '--origin',
    '--project',
    '--revision',
    '--secret-versions',
  ]);
  const options = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (!allowed.has(name) || value === undefined || value.startsWith('--') || options.has(name)) {
      throw new Error(`Некорректный аргумент staging revision verifier: ${name ?? '<missing>'}`);
    }
    options.set(name, value);
  }
  for (const required of allowed) {
    if (!options.has(required)) throw new Error(`Обязательный аргумент ${required} отсутствует.`);
  }
  return options;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

async function runCli() {
  const options = parseOptions(process.argv.slice(2));
  const [manifest, metadata, secretVersions] = await Promise.all([
    readJson(options.get('--manifest')),
    readJson(options.get('--metadata')),
    readJson(options.get('--secret-versions')),
  ]);
  await validateReleaseManifest(manifest);
  const result = validateRevisionBinding(metadata, manifest, options.get('--revision'), {
    origin: options.get('--origin'),
    project: options.get('--project'),
    secretVersions,
  });
  process.stdout.write(`${result.revision}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
