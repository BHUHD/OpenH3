import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceSvg = path.join(
  projectRoot,
  'packages',
  'desktop',
  'src',
  'renderer',
  'assets',
  'logos',
  'brand',
  'openh3-mark.svg'
);
const rendererPng = path.join(
  projectRoot,
  'packages',
  'desktop',
  'src',
  'renderer',
  'assets',
  'logos',
  'brand',
  'app.png'
);
const resourcesDir = path.join(projectRoot, 'resources');
const resourcePng = path.join(resourcesDir, 'app.png');
const resourceIco = path.join(resourcesDir, 'app.ico');

function writeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(images.length * 16);
  let offset = header.length + directory.length;
  const payload = [];

  images.forEach(({ size, data }, index) => {
    const base = index * 16;
    directory.writeUInt8(size === 256 ? 0 : size, base);
    directory.writeUInt8(size === 256 ? 0 : size, base + 1);
    directory.writeUInt8(0, base + 2);
    directory.writeUInt8(0, base + 3);
    directory.writeUInt16LE(1, base + 4);
    directory.writeUInt16LE(32, base + 6);
    directory.writeUInt32LE(data.length, base + 8);
    directory.writeUInt32LE(offset, base + 12);
    payload.push(data);
    offset += data.length;
  });

  return Buffer.concat([header, directory, ...payload]);
}

async function main() {
  if (!fs.existsSync(sourceSvg)) {
    throw new Error(`OpenH3 source SVG not found: ${sourceSvg}`);
  }

  fs.mkdirSync(resourcesDir, { recursive: true });
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = await Promise.all(
    sizes.map(async (size) => ({
      size,
      data: await sharp(sourceSvg).resize(size, size).png().toBuffer(),
    }))
  );

  await sharp(sourceSvg).resize(1024, 1024).png().toFile(rendererPng);
  await sharp(sourceSvg).resize(1024, 1024).png().toFile(resourcePng);
  fs.writeFileSync(resourceIco, writeIco(images));

  console.log(`Generated OpenH3 PNG: ${rendererPng}`);
  console.log(`Generated OpenH3 PNG: ${resourcePng}`);
  console.log(`Generated OpenH3 ICO: ${resourceIco}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
