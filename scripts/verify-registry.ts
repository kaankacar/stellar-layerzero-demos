/**
 * Fetch the LayerZero registry, write the compact snapshot the app bundles as
 * its offline fallback, and report any drift between the live Stellar
 * deployments and the addresses documented in src/config/layerzero.fallback.ts.
 *
 *   pnpm verify:registry           # refresh snapshot, print diff
 *   pnpm verify:registry --strict  # exit 1 on drift (CI)
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compactRegistry, diffStellarDeployment, type RawRegistry } from '../src/lib/layerzero/chains';
import { METADATA_API } from '../src/config/networks';
import { STELLAR_FALLBACK } from '../src/config/layerzero.fallback';

const strict = process.argv.includes('--strict');
const url = `${METADATA_API}/deployments`;
const res = await fetch(url);
if (!res.ok) throw new Error(`registry fetch failed: HTTP ${res.status}`);
const raw = (await res.json()) as RawRegistry;
const snapshot = compactRegistry(raw);
const out = resolve(import.meta.dirname, '../src/config/registry.snapshot.json');
writeFileSync(out, JSON.stringify(snapshot, null, 1) + '\n');
console.log(`snapshot: ${Object.keys(snapshot.chains).length} chains -> ${out}`);

let drift = 0;
for (const stage of ['mainnet', 'testnet'] as const) {
  const diffs = diffStellarDeployment(snapshot, stage);
  const eid = snapshot.chains[`stellar-${stage}`]?.deployments[0]?.eid;
  console.log(`\nstellar-${stage} (eid ${eid ?? '?'}; documented ${STELLAR_FALLBACK[stage].eid})`);
  for (const d of diffs) {
    const mark = d.live === undefined ? '?' : d.changed ? 'CHANGED' : 'ok';
    if (d.changed) drift += 1;
    console.log(`  ${mark.padEnd(8)} ${d.field.padEnd(18)} ${d.live ?? '(missing)'}${d.changed ? `  (documented ${d.fallback})` : ''}`);
  }
  const dvns = Object.values(snapshot.chains[`stellar-${stage}`]?.dvns ?? {});
  console.log(`  DVNs: ${dvns.filter((d) => !d.deprecated).map((d) => d.name).join(', ')}` + (dvns.some((d) => d.deprecated) ? ` (+${dvns.filter((d) => d.deprecated).length} deprecated)` : ''));
}
if (drift > 0) {
  console.log(`\n${drift} address(es) differ from the documented fallbacks. Update src/config/layerzero.fallback.ts and the README.`);
  if (strict) process.exit(1);
} else {
  console.log('\nRegistry matches the documented fallbacks.');
}
