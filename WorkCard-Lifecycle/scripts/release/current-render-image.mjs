import assert from 'node:assert/strict';
import process from 'node:process';
import { resolveCurrentRenderImage, renderClient } from './render-adapter.mjs';

assert(process.argv.length === 2, 'Current-image reader takes no configurable commands.');
const expected = {
  serviceId: process.env.RENDER_SERVICE_ID,
  ownerId: process.env.RENDER_OWNER_ID,
  origin: process.env.RENDER_ORIGIN,
  repository: `ghcr.io/${process.env.GITHUB_REPOSITORY.toLowerCase()}/work-card`,
};
const image = await resolveCurrentRenderImage(
  renderClient({ token: process.env.RENDER_API_KEY }),
  expected,
);
process.stdout.write(`${image}\n`);
