/* global process */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A deliberately bounded publication audit, not a complete secret scanner.
 * Never prints matching values, source lines, Git errors, or connection strings.
 * See docs/SOURCE_AUDIT.md for scope, exit codes, and the fixture exception policy.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const maxBytes = 64 * 1024 * 1024;
const rules = [
  ['private-key.pem', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
  ['provider.openai', /(?<![A-Za-z0-9])sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{30,}/g],
  ['provider.anthropic', /(?<![A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{30,}/g],
  ['provider.telegram', /(?<![A-Za-z0-9])\d{7,}:[A-Za-z0-9_-]{30,}/g],
  ['provider.github', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g],
  ['provider.slack', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ['provider.google-api', /\bAIza[A-Za-z0-9_-]{35}\b/g],
  ['provider.stripe-live', /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g],
  ['provider.aws-access-id', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['path.personal-home', /\/(?:Users|home)\/[^\s/"'`<>]+(?:\/[^\s"'`<>]*)?/g],
  ['path.windows-home', /\b[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\s\\/"'`<>]+/g],
];

// Exact synthetic doctor fixtures, reviewed as non-live values used only for local validation.
// Every exception binds file + rule + SHA-256 of the complete matched value. No test-directory
// wildcard exists. Moving, changing, or adding any different credential-shaped value fails.
const allowedFixtures = new Set([
  'tests/doctor.test.ts|provider.openai|6eabc55f43dbc52bf91b96f299b11582ab5d8fdfc5a4ced71d8e394a3af2b50f',
  'tests/doctor.test.ts|provider.telegram|16058dfeb85f5e6461f8074aebb1dc0a01f26f5e819446560f609a8a2b297e91',
]);
const findings = new Set();
const inspected = new Set();
const blobMatches = new Map();
let allowedCount = 0;
let historyCommits = 0;
let gitAvailable = true;

function report(path, rule) { findings.add(`${JSON.stringify(path)} ${rule}`); }
function git(args, optional = false) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: null, maxBuffer: maxBytes, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) {
    if (!optional) report('(repository)', 'audit.git-command-failed');
    return null;
  }
  return result.stdout;
}
function forbidden(path) {
  const parts = path.split('/');
  const name = parts.at(-1);
  return parts.some(part => ['.git', '.data', 'node_modules', 'dist', 'coverage', '.aws', '.ssh', '.gnupg'].includes(part))
    || (name !== '.env.example' && (name === '.env' || name.startsWith('.env.')))
    || /^(?:\.DS_Store|id_rsa|id_ed25519|id_ecdsa|credentials\.json|service-account(?:[-.].*)?\.json)$/i.test(name)
    || /\.(?:log|dump|sqlite|sqlite3|db|p12|pfx|key)$/i.test(name);
}
function matchedRules(bytes) {
  const text = bytes.toString('utf8');
  const matches = [];
  for (const [rule, regex] of rules) {
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      matches.push([rule, createHash('sha256').update(match[0]).digest('hex')]);
    }
  }
  return matches;
}
function checkMatches(path, matches) {
  for (const [rule, digest] of matches) {
    if (allowedFixtures.has(`${path}|${rule}|${digest}`)) allowedCount++;
    else report(path, rule);
  }
}
function scanBlob(path, objectId, mode) {
  if (forbidden(path)) report(path, 'file.forbidden-publication-path');
  if (mode === '160000') { report(path, 'audit.submodule-not-inspected'); return; }
  const key = `${path}\0${objectId}`;
  if (inspected.has(key)) return;
  inspected.add(key);
  if (!blobMatches.has(objectId)) {
    const bytes = git(['cat-file', 'blob', objectId]);
    if (!bytes) { report(path, 'audit.blob-unreadable'); return; }
    blobMatches.set(objectId, matchedRules(bytes));
  }
  checkMatches(path, blobMatches.get(objectId));
}
function scanWorking(path) {
  const full = join(root, path);
  if (forbidden(path)) report(path, 'file.forbidden-publication-path');
  if (!existsSync(full)) return; // Deleted working file is still inspected from index/history.
  try {
    const metadata = lstatSync(full);
    if (metadata.isSymbolicLink()) {
      report(path, 'audit.symlink-not-followed');
      checkMatches(path, matchedRules(readlinkSync(full)));
      return;
    }
    if (!metadata.isFile() || metadata.size > maxBytes) { report(path, 'audit.file-not-inspected'); return; }
    inspected.add(`working\0${path}`);
    checkMatches(path, matchedRules(readFileSync(full)));
  } catch { report(path, 'audit.file-unreadable'); }
}
function candidates(directory = root) {
  const paths = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    const path = relative(root, full).split('\\').join('/');
    // Before Git exists these private/generated paths are local state, not publication candidates.
    if (forbidden(path)) continue;
    if (entry.isDirectory()) paths.push(...candidates(full));
    else paths.push(path);
  }
  return paths;
}

try {
  const top = git(['rev-parse', '--show-toplevel'], true);
  if (top && resolve(top.toString('utf8').trim()) === root) {
    const index = git(['ls-files', '--stage', '-z']);
    for (const entry of index?.toString('utf8').split('\0').filter(Boolean) ?? []) {
      const tab = entry.indexOf('\t');
      const [mode, objectId, stage] = entry.slice(0, tab).split(' ');
      const path = entry.slice(tab + 1);
      if (stage !== '0') report(path, 'audit.unmerged-index');
      scanBlob(path, objectId, mode);
    }
    const work = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
    for (const path of new Set(work?.toString('utf8').split('\0').filter(Boolean) ?? [])) scanWorking(path);
    const revisions = git(['rev-list', '--all']);
    const commits = revisions?.toString('utf8').trim().split('\n').filter(Boolean) ?? [];
    historyCommits = commits.length;
    for (const commit of commits) {
      const tree = git(['ls-tree', '-r', '-z', commit]);
      for (const entry of tree?.toString('utf8').split('\0').filter(Boolean) ?? []) {
        const tab = entry.indexOf('\t');
        const [mode, type, objectId] = entry.slice(0, tab).split(' ');
        const path = entry.slice(tab + 1);
        if (type === 'blob' || mode === '160000') scanBlob(path, objectId, mode);
      }
    }
    process.stdout.write(`Scope: working publication files, staged blobs, and ${historyCommits} reachable Git commits.\n`);
  } else {
    gitAvailable = false;
    if (existsSync(join(root, '.git')) || top) report('(repository)', 'audit.git-scope-unavailable');
    for (const path of candidates()) scanWorking(path);
    process.stdout.write('Scope: source candidates only; this directory has no usable Git history. Re-run after staging and committing.\n');
  }
} catch { report('(repository)', 'audit.incomplete'); }

for (const finding of [...findings].sort()) process.stderr.write(`${finding}\n`);
process.stdout.write(`Reviewed ${inspected.size} file versions; exact synthetic fixture exceptions applied ${allowedCount} times.\n`);
if (findings.size) {
  process.stderr.write(`Source audit failed: ${findings.size} file/rule findings. Matching values are never printed.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Source audit passed for the stated scope${gitAvailable ? '' : ' (Git history unavailable)'}. This is a bounded pattern audit, not a complete secret scan.\n`);
}
