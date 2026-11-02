// node scripts/test/v1-dump.mjs out.json – starts the fakes and wrangler dev, writes the API v1 snapshot
// (compare a run on the old code with one on the new code to prove API v1 did not change).
import fs from 'node:fs';
import { startHttpFakes } from './fakes.mjs';
import { startDev } from './dev.mjs';
import { snapshotV1 } from './v1-snapshot.mjs';

const fakes = await startHttpFakes(8790);
const dev = await startDev({ port: 8788, vars: { GITHUB_API: 'http://127.0.0.1:8790/github' } });
try {
  fs.writeFileSync(process.argv[2], JSON.stringify(await snapshotV1(dev.base), null, 1));
} finally {
  dev.stop();
  fakes.server.close();
}
