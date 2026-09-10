/**
 * Compile the EVM test contracts with solc-js (no Foundry/Hardhat needed) and
 * write ABI + bytecode artifacts the deploy script and the site read.
 *
 *   pnpm compile:evm
 */
import solc from 'solc';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const srcDir = resolve(root, 'contracts/evm/src');
const outDir = resolve(root, 'contracts/evm/artifacts');
mkdirSync(outDir, { recursive: true });

const sources: Record<string, { content: string }> = {};
for (const f of readdirSync(srcDir).filter((f) => f.endsWith('.sol'))) sources[f] = { content: readFileSync(resolve(srcDir, f), 'utf8') };

/** Resolve `@scope/pkg/path.sol` from node_modules, including pnpm's hoisted store for transitive deps. */
function findImports(path: string): { contents: string } | { error: string } {
  const candidates = [resolve(root, 'node_modules', path), resolve(root, 'node_modules/.pnpm/node_modules', path)];
  for (const c of candidates) if (existsSync(c)) return { contents: readFileSync(c, 'utf8') };
  return { error: `import not found: ${path}` };
}

const input = {
  language: 'Solidity',
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'paris',
    metadata: { bytecodeHash: 'none' },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};
console.log(`solc ${solc.version()} compiling ${Object.keys(sources).join(', ')}`);
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports })) as {
  errors?: { severity: string; formattedMessage: string }[];
  contracts?: Record<string, Record<string, { abi: unknown[]; evm: { bytecode: { object: string } } }>>;
};
let failed = false;
for (const e of output.errors ?? []) {
  if (e.severity === 'error') failed = true;
  if (e.severity === 'error' || process.env.VERBOSE) console.log(e.formattedMessage);
}
if (failed || !output.contracts) process.exit(1);
for (const [file, contracts] of Object.entries(output.contracts)) {
  if (!Object.keys(sources).includes(file)) continue; // skip library contracts
  for (const [name, c] of Object.entries(contracts)) {
    const artifact = {
      contractName: name,
      sourceName: file,
      compiler: `solc ${solc.version()}`,
      sourceSha256: createHash('sha256').update(sources[file]!.content).digest('hex'),
      abi: c.abi,
      bytecode: `0x${c.evm.bytecode.object}`,
    };
    writeFileSync(resolve(outDir, `${name}.json`), JSON.stringify(artifact, null, 2) + '\n');
    console.log(`  ${name}: ${c.evm.bytecode.object.length / 2} bytes -> contracts/evm/artifacts/${name}.json`);
  }
}
