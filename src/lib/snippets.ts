/**
 * "Under the hood" panels show real code, not pseudocode. Source files carry
 * `// snippet:start <name>` and `// snippet:end <name>` markers; pages import
 * the file with Vite's `?raw` suffix and slice the region out at runtime.
 */
export function extractSnippet(source: string, name: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => l.includes(`snippet:start ${name}`));
  const end = lines.findIndex((l, i) => i > start && l.includes(`snippet:end ${name}`));
  if (start === -1 || end === -1) return `// snippet "${name}" not found`;
  const body = lines.slice(start + 1, end);
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^\s*/)?.[0].length ?? 0));
  return body.map((l) => l.slice(indent)).join('\n').trim();
}

export function listSnippets(source: string): string[] {
  return [...source.matchAll(/snippet:start (\S+)/g)].map((m) => m[1]!);
}
