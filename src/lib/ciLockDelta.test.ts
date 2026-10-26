// Temporary CI diagnostic: emit ONLY non-sensitive npm lockfile metadata.
// Remove this file in the next commit after updating package-lock.json.
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

it('emits dependency lockfile changes for reproducible CI', () => {
  const original = JSON.parse(execFileSync('git', ['show', 'HEAD:package-lock.json'], { encoding:'utf8' }));
  const current = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const changed: Record<string, unknown> = {};
  const removed: string[] = [];
  for (const [name, entry] of Object.entries(current.packages)) {
    if (JSON.stringify(entry) !== JSON.stringify(original.packages[name])) changed[name] = entry;
  }
  for (const name of Object.keys(original.packages)) {
    if (!(name in current.packages)) removed.push(name);
  }
  const delta = JSON.stringify({ changed, removed, lockfileVersion: current.lockfileVersion });
  console.log('CI_LOCK_DELTA_BEGIN');
  for (let i=0;i<delta.length;i+=1800) console.log('CI_LOCK_DELTA_CHUNK:'+delta.slice(i,i+1800));
  console.log('CI_LOCK_DELTA_END');
  expect(current.packages[''].dependencies['pdfjs-dist']).toBeDefined();
});
