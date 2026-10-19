import path from 'node:path';
import type { OpenAIRotatingClient } from '@/common/api/OpenAIRotatingClient';

type Reference = { uri: string; url: string };

export type DecodedImage = { bytes: Uint8Array; mime: string };

const IMAGE_SIGNATURES: Array<{ mime: string; matches: (bytes: Uint8Array) => boolean }> = [
  {
    mime: 'image/png',
    matches: (bytes) =>
      bytes.length >= 8 && bytes.slice(0, 8).every((value, i) => value === [137, 80, 78, 71, 13, 10, 26, 10][i]),
  },
  {
    mime: 'image/jpeg',
    matches: (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  {
    mime: 'image/gif',
    matches: (bytes) =>
      new TextDecoder().decode(bytes.slice(0, 6)) === 'GIF87a' ||
      new TextDecoder().decode(bytes.slice(0, 6)) === 'GIF89a',
  },
  {
    mime: 'image/webp',
    matches: (bytes) =>
      bytes.length >= 12 &&
      new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
      new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP',
  },
  { mime: 'image/bmp', matches: (bytes) => bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d },
  {
    mime: 'image/tiff',
    matches: (bytes) =>
      bytes.length >= 4 &&
      ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0) ||
        (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a)),
  },
];

const normalizeMime = (mime: string): string => mime.trim().toLowerCase().split(';', 1)[0] || 'image/png';

const detectImageMime = (bytes: Uint8Array, declaredMime?: string): string => {
  const detected = IMAGE_SIGNATURES.find((signature) => signature.matches(bytes))?.mime;
  const declared = declaredMime ? normalizeMime(declaredMime) : undefined;
  if (declared === 'image/svg+xml') {
    const text = new TextDecoder().decode(bytes.slice(0, 512)).trimStart().toLowerCase();
    if (text.startsWith('<svg') || text.startsWith('<?xml')) return declared;
  }
  if (!detected) throw new Error('Image data is not a recognized image format');
  if (declared?.startsWith('image/') && declared !== detected) {
    throw new Error(`Image data does not match declared MIME type ${declared}`);
  }
  return detected;
};

const decodeBase64Payload = (payload: string): Uint8Array => {
  const normalized = payload.replace(/\s+/g, '');
  if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error('Image data contains invalid base64');
  }
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const bytes = Uint8Array.from(Buffer.from(padded, 'base64'));
  if (Buffer.from(bytes).toString('base64') !== padded) throw new Error('Image data contains invalid base64');
  return bytes;
};

/** Decode a data URL and verify both base64 syntax and the image signature. */
export const decodeImageDataUrl = (dataUrl: string, fallbackMime = 'image/png'): DecodedImage => {
  const match = dataUrl.match(/^data:([^;,]+);base64,([\s\S]*)$/i);
  if (!match) throw new Error('Image data must be a base64 data URL');
  const bytes = decodeBase64Payload(match[2]);
  return { bytes, mime: detectImageMime(bytes, normalizeMime(match[1]) || fallbackMime) };
};

export const imageBytesToDataUrl = (bytes: Uint8Array, declaredMime?: string): string => {
  const mime = detectImageMime(bytes, declaredMime);
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
};

const requestSignalFor = (signal?: AbortSignal): AbortSignal =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000);

/** Resolve a remote image URL or data URL into a verified data URL. */
export async function imageUrlToDataUrl(url: string, signal?: AbortSignal): Promise<string> {
  if (url.startsWith('data:')) {
    const decoded = decodeImageDataUrl(url);
    return imageBytesToDataUrl(decoded.bytes, decoded.mime);
  }
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported image URL');
  if (parsed.username || parsed.password) throw new Error('Image URL must not contain credentials');
  const requestSignal = requestSignalFor(signal);
  let response: Response;
  try {
    response = await fetch(parsed.href, { signal: requestSignal, redirect: 'error' });
  } catch (error) {
    throw new Error(`Image download failed: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  if (!response.ok) throw new Error(`Image download failed (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return imageBytesToDataUrl(bytes, response.headers.get('content-type') ?? undefined);
}

/** Call a synchronous images API, preserving every reference and the selected model. */
export async function imagesApiDataUrl(
  client: OpenAIRotatingClient,
  prompt: string,
  model: string,
  references: Reference[],
  signal?: AbortSignal
): Promise<string> {
  const requestSignal = requestSignalFor(signal);
  const options = { signal: requestSignal, timeout: 300_000 };
  const response = references.length
    ? await (async () => {
        const form = new FormData();
        form.append('model', model);
        form.append('prompt', prompt);
        // APIYi expects repeated image fields, without the SDK's [] suffix.
        for (const reference of references) {
          const match = reference.url.match(/^data:(image\/[^;]+);base64,([\s\S]+)$/);
          const { bytes, mime } = match
            ? decodeImageDataUrl(reference.url)
            : decodeImageDataUrl(await imageUrlToDataUrl(reference.url, requestSignal));
          const name = path.basename(reference.uri.replace(/^@/, '').split('?')[0]) || 'reference.png';
          const blobBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
          form.append('image', new Blob([blobBytes], { type: mime }), name);
        }
        return client.editImage(form, options);
      })()
    : await client.createImage({ model, prompt, n: 1 }, options);
  const image = response.data?.[0];
  if (image?.b64_json) {
    const decoded = image.b64_json.startsWith('data:')
      ? decodeImageDataUrl(image.b64_json)
      : { bytes: decodeBase64Payload(image.b64_json), mime: undefined };
    return imageBytesToDataUrl(decoded.bytes, decoded.mime);
  }
  if (image?.url) {
    return imageUrlToDataUrl(image.url, requestSignal);
  }
  throw new Error('Image generation returned no image.');
}
