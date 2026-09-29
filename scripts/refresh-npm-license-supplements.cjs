#!/usr/bin/env node
'use strict';

// Fetch missing license documents only from the package's declared GitHub
// repository at its npm-published gitHead. Existing evidence is never guessed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const directory = path.resolve(__dirname, '../resources/third-party-licenses');
const target = path.join(directory, 'npm-license-supplements.json');
const inventory = JSON.parse(fs.readFileSync(path.join(directory, 'npm-license-inventory.json'), 'utf8'));
const supplements = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};
const standardTexts = new Map();

async function standardEvidence(item, metadata) {
  const declared = metadata.license || item.declaredLicense;
  const license =
    typeof declared === 'string'
      ? declared
      : Array.isArray(declared) && declared.length === 1
        ? declared[0].type
        : null;
  if (!['MIT', 'Apache-2.0', 'BSD-2-Clause', 'CC0-1.0', 'CC-BY-3.0', 'ISC', 'WTFPL'].includes(license)) return;
  const source = `https://cdn.jsdelivr.net/gh/spdx/license-list-data@v3.27.0/text/${license}.txt`;
  if (!standardTexts.has(license)) standardTexts.set(license, get(source));
  const content = await standardTexts.get(license);
  if (!content || content.length < 200) return;
  const author = typeof metadata.author === 'string' ? metadata.author : metadata.author?.name;
  const attribution = author ? author.replace(/\s*<[^>]*>/g, '') : 'Not specified in the published package metadata';
  const registry = `https://registry.npmjs.org/${encodeURIComponent(item.name)}/${item.version}`;
  const text = [
    `Package license declaration: ${license}`,
    `Published author attribution (not a reconstructed copyright notice): ${attribution}`,
    `Declaration source: ${registry}`,
    '',
    'The published package does not include a separate license text.',
    'The SPDX standard license form follows verbatim; template placeholders are not invented copyright claims.',
    'This standard form supplements, and does not replace, any upstream copyright notices.',
    '',
    content.replace(/\r\n/g, '\n').trim(),
    '',
  ].join('\n');
  supplements[`${item.name}@${item.version}`] = [
    {
      file: `standard-license/${license}.txt`,
      source,
      declarationSource: registry,
      evidenceKind: 'declared-license-with-standard-text',
      sha256: crypto.createHash('sha256').update(text).digest('hex'),
      text,
    },
  ];
  console.log(`Standard license supplement: ${item.name}@${item.version} (${license})`);
}

async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  return response.ok ? response.text() : null;
}

async function fetchEvidence(item) {
  const id = `${item.name}@${item.version}`;
  try {
    const metadata = JSON.parse(
      await get(`https://registry.npmjs.org/${encodeURIComponent(item.name)}/${item.version}`)
    );
    if (process.argv.includes('--standard-only')) {
      await standardEvidence(item, metadata);
      return;
    }
    const repository = typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url;
    const match = repository?.replace(/#.*$/, '').match(/github\.com[:/]([^/]+\/[^/#]+?)(?:\.git)?$/);
    if (!match || !/^[a-f0-9]{40}$/i.test(metadata.gitHead || '')) {
      console.log(`No immutable GitHub source: ${id}`);
      await standardEvidence(item, metadata);
      return;
    }
    const prefix = `https://raw.githubusercontent.com/${match[1]}/${metadata.gitHead}/`;
    const directories = [...new Set([metadata.repository?.directory, ''].filter((value) => typeof value === 'string'))];
    const filenames = [
      'LICENSE',
      'LICENSE.md',
      'LICENSE.txt',
      'license',
      'license.md',
      'COPYING',
      'LICENCE',
      'License',
      'LICENSE-MIT',
      'MIT-LICENSE',
      'LICENSE.MIT',
      'MIT-LICENSE.txt',
      'LICENSE-MIT.txt',
      'License.txt',
      'LICENSE.BSD',
      'license-mit',
    ];
    const candidates = directories.flatMap((dir) => filenames.map((name) => (dir ? dir + '/' : '') + name));
    const found = await Promise.all(
      candidates.map(async (file) => {
        const source = prefix + file;
        const content = await get(source);
        if (!content || content.length < 200 || /<html/i.test(content)) return null;
        const text = content.replace(/\r\n/g, '\n').trim() + '\n';
        return {
          file: 'upstream/' + file,
          source,
          sha256: crypto.createHash('sha256').update(text).digest('hex'),
          text,
        };
      })
    );
    const documents = found.filter(Boolean);
    if (documents.length) {
      supplements[id] = documents;
      console.log(`Retrieved ${id}: ${documents.length} license document(s)`);
    } else {
      console.log(`No license file found: ${id}`);
      await standardEvidence(item, metadata);
    }
  } catch (error) {
    console.log(`Could not retrieve ${id}: ${error.message}`);
  }
}

(async () => {
  const queue = [...inventory.evidenceGaps];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (queue.length) await fetchEvidence(queue.shift());
    })
  );
  const ordered = Object.fromEntries(Object.entries(supplements).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(target, JSON.stringify(ordered, null, 2) + '\n');
  console.log('Regenerate the notices and review remaining evidence gaps.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
