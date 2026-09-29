import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceLogo = path.join(
  projectRoot,
  'packages',
  'desktop',
  'src',
  'renderer',
  'assets',
  'logos',
  'brand',
  'openh3-logo-source.png'
);
const transparentLogo = path.join(
  projectRoot,
  'packages',
  'desktop',
  'src',
  'renderer',
  'assets',
  'logos',
  'brand',
  'openh3-logo.png'
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
  if (!fs.existsSync(sourceLogo)) {
    throw new Error(`OpenH3 source logo not found: ${sourceLogo}`);
  }

  fs.mkdirSync(resourcesDir, { recursive: true });
  const source = sharp(sourceLogo).removeAlpha().raw();
  const { data, info } = await source.toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let index = 0; index < info.width * info.height; index += 1) {
    const offset = index * info.channels;
    const luminance = Math.max(data[offset], data[offset + 1], data[offset + 2]);
    const rgbaOffset = index * 4;
    rgba[rgbaOffset] = 0;
    rgba[rgbaOffset + 1] = 0;
    rgba[rgbaOffset + 2] = 0;
    rgba[rgbaOffset + 3] = 255 - luminance;
  }
  const logo = sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } });
  await logo.png().toFile(transparentLogo);
  const logoMetadata = await sharp(transparentLogo).metadata();
  const logoWidth = Math.round((logoMetadata.width ?? 1024) * 0.82);
  const resizedLogo = await sharp(transparentLogo).resize({ width: logoWidth, fit: 'inside' }).png().toBuffer();
  const rendererIcon = await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: resizedLogo, gravity: 'center' }])
    .png()
    .toBuffer();
  const appLogo = await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: '#ffffff' },
  })
    .composite([{ input: resizedLogo, gravity: 'center' }])
    .png()
    .toBuffer();
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = await Promise.all(
    sizes.map(async (size) => ({
      size,
      data: await sharp(appLogo).resize(size, size).png().toBuffer(),
    }))
  );

  await fs.promises.writeFile(rendererPng, rendererIcon);
  await fs.promises.writeFile(resourcePng, appLogo);
  fs.writeFileSync(resourceIco, writeIco(images));

  console.log(`Generated OpenH3 PNG: ${rendererPng}`);
  console.log(`Generated OpenH3 PNG: ${resourcePng}`);
  console.log(`Generated OpenH3 ICO: ${resourceIco}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
