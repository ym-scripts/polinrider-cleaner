import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

  stripPayload, cleanGitignore, cleanPackageJson, packageJsonInfected, isMaliciousVscode,
  isFakeFont, isKitPath, scanTree, surgicalClean,
} from '../polinrider-cleaner.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'polinrider-cleaner.mjs');

// Harmless stand-in for the obfuscated payload: hundreds of tabs, then a long line of code.
const PAYLOAD = '\t'.repeat(300) + 'var x=1;'.repeat(40);

function sh(dir, ...args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
}

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'polinrider-test-'));
  sh(dir, 'init', '-q', '-b', 'main');
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  sh(dir, 'add', '-A', '-f'); // -f: the infected .gitignore ignores itself
  sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  return dir;
}

const INFECTED = {
  'api.js': PAYLOAD,
  '.gitignore': 'node_modules/\n.env\nbranch_structure.json\ntemp_auto_push.bat\ntemp_interactive_push.bat\n.gitignore\n',
  'package.json': '{\n  "scripts": {\n    "dev": "node api.js && next dev",\n    "build": "node api.js && next build"\n  }\n}\n',
  'postcss.config.mjs': "import { createRequire } from 'module';\n\nconst require = createRequire(import.meta.url);\n\nconst config = {};\n\nexport default config;" + PAYLOAD,
  '.vscode/tasks.json': '{"tasks":[{"command":"node","args":["./public/fonts/fa-solid-300.ttf"],"hide":true,"runOptions":{"runOn":"folderOpen"}}]}\n',
  'public/fonts/fa-solid-300.ttf': PAYLOAD,
  'public/fonts/README.md': '# Fonts Directory\n\nCustom fonts for the Blockchain Explorer application.\n',
  'public/fonts/fa-solid-900.woff': Buffer.from([0, 1, 0, 0, 0, 9]),
  'src/app.js': 'export const ok = true;\n',
};

test('stripPayload cuts the hidden tail and the createRequire shim', () => {
  assert.equal(stripPayload(INFECTED['postcss.config.mjs']), 'const config = {};\n\nexport default config;\n');
  assert.equal(stripPayload(PAYLOAD), '');
  assert.equal(stripPayload('const a = 1;\n'), null);
});

test('stripPayload keeps the shim when the file really uses require()', () => {
  const src = "import { createRequire } from 'module';\nconst require = createRequire(import.meta.url);\nconst x = require('x');" + PAYLOAD;
  assert.match(stripPayload(src), /createRequire/);
});

test('stripPayload ignores normal indentation and short whitespace runs', () => {
  assert.equal(stripPayload('\t'.repeat(10) + 'x();\n' + ' '.repeat(199) + 'y'.repeat(300)), null);
});

test('cleanGitignore removes only the markers and the self-ignore line', () => {
  assert.equal(cleanGitignore(INFECTED['.gitignore']), 'node_modules/\n.env\n');
  assert.equal(cleanGitignore('node_modules/\n.gitignore\n'), null);
});

test('package.json scripts lose the api.js prefix', () => {
  assert.ok(packageJsonInfected(INFECTED['package.json']));
  assert.equal(cleanPackageJson(INFECTED['package.json']), '{\n  "scripts": {\n    "dev": "next dev",\n    "build": "next build"\n  }\n}\n');
  assert.equal(cleanPackageJson('{"scripts":{"dev":"next dev"}}'), null);
});

test('VS Code auto-run tasks: both command forms, and legitimate tasks left alone', () => {
  assert.ok(isMaliciousVscode('.vscode/tasks.json', INFECTED['.vscode/tasks.json']));
  assert.ok(isMaliciousVscode('.vscode/tasks.json', '{"command":"(command -v node && node ./public/fonts/fa-solid.lfk)","runOn":"folderOpen"}'));
  assert.ok(!isMaliciousVscode('.vscode/tasks.json', '{"command":"npm run dev","runOptions":{"runOn":"folderOpen"}}'));
  assert.ok(!isMaliciousVscode('.vscode/tasks.json', '{"command":"node scripts/watch.js"}'));
});

test('fake fonts are text, real fonts are binary', () => {
  assert.ok(isFakeFont('public/fonts/fa-solid.lfk', Buffer.from(PAYLOAD)));
  assert.ok(!isFakeFont('public/fonts/fa-solid-900.woff', Buffer.from([0, 1, 0, 0])));
  assert.ok(!isFakeFont('src/api.js', Buffer.from(PAYLOAD)));
});

test('isKitPath only accepts infection files', () => {
  const sig = new Set(['postcss.config.mjs']);
  assert.ok(isKitPath('postcss.config.mjs', sig));
  assert.ok(isKitPath('.vscode/launch.json', sig));
  assert.ok(isKitPath('public/fonts/fa-brands-400.svg', sig));
  assert.ok(!isKitPath('public/fonts/brand/Inter.woff2', sig));
  assert.ok(!isKitPath('src/app.js', sig));
});

test('scanTree finds every signature in a commit', async () => {
  const dir = repo(INFECTED);
  const found = Object.fromEntries((await scanTree(dir, 'HEAD')).map(([p, why]) => [p, why]));
  assert.deepEqual(Object.keys(found).sort(), [
    '.gitignore', '.vscode/tasks.json', 'api.js', 'package.json', 'postcss.config.mjs',
    'public/fonts/README.md', 'public/fonts/fa-solid-300.ttf',
  ]);
});

test('scanTree reports nothing for a clean repo', async () => {
  const dir = repo({ 'src/app.js': 'export const ok = true;\n', '.gitignore': 'node_modules/\n' });
  assert.deepEqual(await scanTree(dir, 'HEAD'), []);
});

test('surgicalClean leaves a tree with no signatures and keeps real files', async () => {
  const dir = repo(INFECTED);
  const notes = [];
  await surgicalClean(dir, notes);
  const tree = sh(dir, 'write-tree').trim();
  assert.deepEqual(await scanTree(dir, tree), []);
  assert.ok(!existsSync(join(dir, 'api.js')));
  assert.ok(!existsSync(join(dir, '.vscode/tasks.json')));
  assert.ok(!existsSync(join(dir, 'public/fonts/fa-solid-900.woff')), 'unreferenced decoy font removed');
  assert.equal(readFileSync(join(dir, 'src/app.js'), 'utf8'), 'export const ok = true;\n');
  assert.equal(readFileSync(join(dir, 'postcss.config.mjs'), 'utf8'), 'const config = {};\n\nexport default config;\n');
});

test('surgicalClean keeps decoy-named fonts the project actually uses', async () => {
  const dir = repo({ ...INFECTED, 'src/styles.css': '@font-face { src: url(/fonts/fa-solid-900.woff); }\n' });
  const notes = [];
  await surgicalClean(dir, notes);
  assert.ok(existsSync(join(dir, 'public/fonts/fa-solid-900.woff')));
  assert.ok(notes.some((n) => n.includes('referenced elsewhere')));
});

test('CLI: help, version, bad option', () => {
  const r = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  assert.equal(r(['--help']).status, 0);
  assert.match(r(['--version']).stdout, /^\d+\.\d+\.\d+/);
  assert.equal(r(['--nope']).status, 2);
  assert.equal(r(['--via-pr']).status, 2);
});
