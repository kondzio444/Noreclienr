#!/usr/bin/env node
// Writes config.schema.json from src/config/schema-source.js (npm run schema).
// The website copies this file to web/src/bot-schema.json at build time (docs/bot-api.md).
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/lib/env.js';
import { buildSchema } from '../src/config/schema-source.js';

const file = path.join(ROOT, 'config.schema.json');
writeFileSync(file, JSON.stringify(buildSchema(), null, 2) + '\n');
console.log(`wrote ${path.relative(process.cwd(), file)}`);
