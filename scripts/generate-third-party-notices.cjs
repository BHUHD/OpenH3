#!/usr/bin/env node
'use strict';

// Collect an intentionally conservative superset: every installed npm package,
// including build tools. Never infer a license grant from a package's SPDX field.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'resources/third-party-licenses');
const seen = new Set();
const packages = new Map();
let collectionScope = 'installed-project-dependencies';
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
const normalize = (value) => value.replace(/\r\n/g, '\n').trim() + '\n';

function collectDocuments(directory, prefix = '', depth = 0) {
  const documents = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    const fullPath = path.join(directory, entry.name);
    if (entry.isFile() && /^(licen[cs]e|copying|copyright|notice|third[-_ ]party)([._ -]|$)/i.test(entry.name)) {
      const text = normalize(fs.readFileSync(fullPath, 'utf8'));
      if (!text.includes('\0')) documents.push({ file: relative, sha256: hash(text), text });
    } else if (entry.isDirectory() && depth < 2 && /^(licen[cs]es?|legal|notices?)$/i.test(entry.name)) {
      documents.push(...collectDocuments(fullPath, relative + '/', depth + 1));
    }
  }
  return documents.sort((a, b) => a.file.localeCompare(b.file));
}

function visitPackage(directory) {
  let real;
  try {
    real = fs.realpathSync(directory);
  } catch {
    return;
  }
  if (seen.has(real)) return;
  seen.add(real);
  const manifestPath = path.join(real, 'package.json');
  if (!fs.existsSync(manifestPath)) return;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.name || !manifest.version) return;
  const documents = collectDocuments(real);
  if (!documents.some((doc) => /licen[cs]e|copying/i.test(doc.file))) {
    for (const entry of fs.readdirSync(real)) {
      if (!/^readme([.]|$)/i.test(entry)) continue;
      const fullPath = path.join(real, entry);
      if (!fs.statSync(fullPath).isFile()) continue;
      const text = normalize(fs.readFileSync(fullPath, 'utf8'));
      if (
        /Permission is hereby granted|Redistribution and use in source and binary|DO WHAT THE FUCK YOU WANT TO|This software is hereby released into the public domain/i.test(
          text
        )
      ) {
        documents.push({ file: entry + ' (embedded license)', sha256: hash(text), text });
      }
    }
  }
  // Workspace sources use the repository's license and are not third parties.
  const internal = !path.relative(root, real).startsWith('..') && !real.includes(`${path.sep}node_modules${path.sep}`);
  if (!internal) {
    const id = `${manifest.name}@${manifest.version}`;
    const item = packages.get(id) || {
      name: manifest.name,
      version: manifest.version,
      declaredLicense: manifest.license || manifest.licenses || 'UNSPECIFIED',
      scopes: [],
      documents: [],
    };
    if (!item.scopes.includes(collectionScope)) item.scopes.push(collectionScope);
    for (const document of documents) {
      if (!item.documents.some((existing) => existing.sha256 === document.sha256)) item.documents.push(document);
    }
    packages.set(id, item);
  }
  visitModules(path.join(real, 'node_modules'));
}

function visitModules(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.bun' || entry.name === '.pnpm') {
      const store = path.join(directory, entry.name);
      for (const child of fs.readdirSync(store, { withFileTypes: true })) {
        if (child.isDirectory()) visitModules(path.join(store, child.name, 'node_modules'));
      }
      continue;
    }
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.name.startsWith('@')) {
      for (const child of fs.readdirSync(fullPath)) visitPackage(path.join(fullPath, child));
    } else if (entry.isDirectory() || entry.isSymbolicLink()) visitPackage(fullPath);
  }
}

visitModules(path.join(root, 'node_modules'));
collectionScope = 'bundled-managed-node-npm';
function visitManagedResources(directory, depth = 0) {
  if (!fs.existsSync(directory) || depth > 10) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(directory, entry.name);
    if (entry.name === 'node_modules') visitModules(child);
    else visitManagedResources(child, depth + 1);
  }
}
visitManagedResources(path.join(root, 'resources/bundled-aioncore'));
// Platform-specific Sentry packages are the binaries of the exact-version CLI.
for (const item of packages.values()) {
  if (item.name.startsWith('@sentry/cli-') && item.documents.length === 0) {
    const cli = packages.get(`@sentry/cli@${item.version}`);
    if (cli)
      item.documents.push(...cli.documents.map((doc) => ({ ...doc, file: `@sentry/cli@${item.version}/${doc.file}` })));
  }
}
const supplementsPath = path.join(output, 'npm-license-supplements.json');
if (fs.existsSync(supplementsPath)) {
  const supplements = JSON.parse(fs.readFileSync(supplementsPath, 'utf8'));
  for (const [id, documents] of Object.entries(supplements)) {
    const item = packages.get(id);
    if (!item) continue;
    for (const document of documents) {
      if (hash(normalize(document.text)) !== document.sha256) throw new Error(`License evidence hash mismatch: ${id}`);
      if (!item.documents.some((existing) => existing.sha256 === document.sha256)) item.documents.push(document);
    }
  }
}
const items = [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
const missing = items.filter((item) => !item.documents.some((doc) => /licen[cs]e|copying/i.test(doc.file)));
const standardOnly = items.filter((item) =>
  item.documents.some((doc) => doc.evidenceKind === 'declared-license-with-standard-text')
);
const asarPath = path.join(root, 'out/win-unpacked/resources/app.asar');
const packaged = new Map();
if (fs.existsSync(asarPath)) {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const prefix = Buffer.alloc(16);
    fs.readSync(fd, prefix, 0, 16, 0);
    const headerBytes = prefix.readUInt32LE(12);
    const header = Buffer.alloc(headerBytes);
    fs.readSync(fd, header, 0, headerBytes, 16);
    const dataOffset = 8 + prefix.readUInt32LE(4);
    function inspect(files, parent = '') {
      for (const [name, node] of Object.entries(files)) {
        const relative = parent + name;
        if (node.files) inspect(node.files, relative + '/');
        else if (/(^|\/)node_modules\/(?:@[^/]+\/)?[^/]+\/package.json$/.test(relative)) {
          let bytes;
          if (node.unpacked) bytes = fs.readFileSync(path.join(asarPath + '.unpacked', relative));
          else {
            bytes = Buffer.alloc(node.size);
            fs.readSync(fd, bytes, 0, node.size, dataOffset + Number(node.offset));
          }
          const manifest = JSON.parse(bytes.toString('utf8'));
          if (manifest.name && manifest.version)
            packaged.set(`${manifest.name}@${manifest.version}`, { name: manifest.name, version: manifest.version });
        }
      }
    }
    inspect(JSON.parse(header.toString('utf8')).files);
  } finally {
    fs.closeSync(fd);
  }
}
const uncovered = [...packaged]
  .filter(([id]) => !packages.has(id) && !id.startsWith('@aionui/'))
  .map(([, item]) => item);
const intro = [
  'OpenH3 — Third-party npm license notices',
  '',
  'Scope: conservative superset of all installed npm packages, including build and development tools, plus bundled managed Node/npm dependencies.',
  'Inclusion does not imply a package is distributed in the application. Runtime binary notices are provided separately.',
  'License declarations are metadata, not substitutes for the original license texts below.',
  'This inventory covers npm dependencies, not model weights, Python runtimes, Electron/Chromium, Node, Bun, FFmpeg or 7-Zip binary licenses.',
  'Regenerate with: node scripts/generate-third-party-notices.cjs',
  '',
];
const blocks = items.map((item) =>
  [
    '='.repeat(78),
    `${item.name}@${item.version}`,
    `Declared license: ${JSON.stringify(item.declaredLicense)}`,
    ...item.documents.map(
      (document) =>
        `\n--- ${document.file} ---\n${document.source ? 'Source: ' + document.source + '\n' : ''}${document.text}`
    ),
    ...(item.documents.length ? [] : ['License text not present in installed package; see inventory evidence gaps.']),
  ].join('\n')
);
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'THIRD-PARTY-NOTICES.txt'), intro.join('\n') + blocks.join('\n\n') + '\n');
const inventory = {
  schemaVersion: 1,
  scope:
    'All installed npm packages, including development tools, plus bundled managed Node/npm dependencies; conservative superset',
  packages: items.map(({ documents, ...item }) => ({ ...item, documents: documents.map(({ text, ...doc }) => doc) })),
  evidenceGaps: missing.map(({ name, version, declaredLicense }) => ({ name, version, declaredLicense })),
  originalLicenseTextUnavailable: standardOnly.map(({ name, version }) => ({ name, version })),
  packagedAsarChecked: fs.existsSync(asarPath),
  packagedPackageCount: packaged.size,
  packagedPackagesWithoutInstalledEvidence: uncovered,
};
fs.writeFileSync(path.join(output, 'npm-license-inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
console.log(
  JSON.stringify({
    packages: items.length,
    evidenceGaps: missing.length,
    packaged: packaged.size,
    uncovered: uncovered.length,
  })
);
if (uncovered.length) process.exitCode = 1;
if (process.argv.includes('--strict') && missing.length) process.exitCode = 1;
