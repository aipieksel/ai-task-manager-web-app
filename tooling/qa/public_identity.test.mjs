import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PUBLIC_APP_SUPPORT_NAME, resolveRuntimeRegistry } = require('../../electron/registry-resolver.cjs');
const product = 'Agentic AI Projects Task Manager';
const electronId = 'com.aipieksel.agenticaiprojectstaskmanager';
const pwaId = `${electronId}.pwa`;

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('src/taskmanager/manifest.webmanifest', 'utf8'));
const pwa = JSON.parse(readFileSync('src/taskmanager/data/runtime/config/pwa.json', 'utf8'));
const identityFiles = [
  'electron/main.cjs',
  'electron/registry-resolver.cjs',
  'tooling/scripts/after-pack.cjs',
  'tooling/scripts/taskmanager_registry.py',
  'src/taskmanager/data/runtime/config/pwa.json',
].map((file) => readFileSync(file, 'utf8')).join('\n');

assert.equal(pkg.name, 'ai-task-manager-web-app');
assert.equal(pkg.build.productName, product);
assert.equal(pkg.build.appId, electronId);
assert.equal(pkg.build.afterPack, 'tooling/scripts/after-pack.cjs');
assert.equal(manifest.name, product);
assert.equal(manifest.id, pwaId);
assert.equal(pwa.app.name, product);
assert.equal(pwa.app.bundleIdentifier, pwaId);
assert.equal(PUBLIC_APP_SUPPORT_NAME, product);
const legacyBundlePattern = new RegExp(`com\\.aipieksel\\.${'task' + 'manager'}(?:\\.pwa)?`);
const legacyDataPattern = new RegExp(`Application Support[\\\\/]${'Task' + 'Manager'}(?:[\\\\/]|['\"])`);
assert.doesNotMatch(identityFiles, legacyBundlePattern);
assert.doesNotMatch(identityFiles, legacyDataPattern);
const removedRegistryHelpers = new RegExp(`registry-migration|${'mergeProject' + 'Payloads'}|syncProjectRegistries`);
assert.doesNotMatch(identityFiles, removedRegistryHelpers);
assert.match(identityFiles, new RegExp(`${'NSMicrophone' + 'UsageDescription'}`));

const fixture = mkdtempSync(join(tmpdir(), 'agentic-task-identity-'));
try {
  const resolution = resolveRuntimeRegistry({
    app: { getPath: () => join(fixture, product) },
    repoRoot: process.cwd(),
  });
  assert.equal(resolution.source, 'public-app-support');
  assert.match(resolution.activePath, /Agentic AI Projects Task Manager/);
  assert.deepEqual(JSON.parse(readFileSync(resolution.activePath, 'utf8')), { version: 1, projects: [] });
  assert.equal(Object.hasOwn(resolution, 'ignoredPaths'), false);
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log('public_identity.test.mjs: PASS');
