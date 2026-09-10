import 'dotenv/config';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '../..');
const ENV_PATH = resolve(ROOT, '.env');

export function envVar(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

/** Persist a generated secret into .env so re-runs reuse it. Never prints the value. */
export function saveEnvVar(name: string, value: string): void {
  process.env[name] = value;
  if (!existsSync(ENV_PATH)) writeFileSync(ENV_PATH, '');
  const current = readFileSync(ENV_PATH, 'utf8');
  if (new RegExp(`^${name}=`, 'm').test(current)) {
    writeFileSync(ENV_PATH, current.replace(new RegExp(`^${name}=.*$`, 'm'), `${name}=${value}`));
  } else {
    appendFileSync(ENV_PATH, `${current.endsWith('\n') || current === '' ? '' : '\n'}${name}=${value}\n`);
  }
}

export const log = (msg: string) => console.log(`\x1b[1;34m[deploy]\x1b[0m ${msg}`);
export const warn = (msg: string) => console.log(`\x1b[1;33m[deploy]\x1b[0m ${msg}`);
