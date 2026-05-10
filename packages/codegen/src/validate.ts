#!/usr/bin/env tsx
import Ajv from 'ajv';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const schemaPath = resolve(__dirname, '../../schema/threat-schema.json');
const raw = readFileSync(schemaPath, 'utf-8');
const schema = JSON.parse(raw) as object;

const ajv = new Ajv({ strict: true, allErrors: true });

try {
  ajv.compile(schema);
  console.log('✓ threat-schema.json is valid');
  process.exit(0);
} catch (err) {
  console.error('✗ threat-schema.json is INVALID');
  console.error(err);
  process.exit(1);
}
