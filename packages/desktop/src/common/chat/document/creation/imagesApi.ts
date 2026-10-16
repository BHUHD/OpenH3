import path from 'node:path';
import type { OpenAIRotatingClient } from '@/common/api/OpenAIRotatingClient';

type Reference = { uri: string; url: string };

/** Call a synchronous images API, preserving every reference and the selected model. */
export async function imagesApiDataUrl(
  client: OpenAIRotatingClient,
  prompt: string,
  model: string,
  references: Reference[],
  signal?: AbortSignal
): Promise<string> {
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000);
  const download = async (url: string) => {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported image URL');
    const response = await fetch(parsed.href, {
      signal: requestSignal,
    });
    if (!response.ok) throw new Error(`Image download failed (${response.status})`);
    const mime = response.headers.get('content-type')?.split(';')[0] || 'image/png';
    if (!mime.startsWith('image/')) throw new Error('Image download returned non-image content');
    return { bytes: await response.arrayBuffer(), mime };
  };
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
            ? { bytes: Uint8Array.from(Buffer.from(match[2], 'base64')).buffer, mime: match[1] }
            : await download(reference.url);
          const name = path.basename(reference.uri.replace(/^@/, '').split('?')[0]) || 'reference.png';
          form.append('image', new Blob([bytes], { type: mime }), name);
        }
        return client.editImage(form, options);
      })()
    : await client.createImage({ model, prompt, n: 1 }, options);
  const image = response.data?.[0];
  if (image?.b64_json) {
    return image.b64_json.startsWith('data:') ? image.b64_json : `data:image/png;base64,${image.b64_json}`;
  }
  if (image?.url) {
    const { bytes, mime } = await download(image.url);
    return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
  }
  throw new Error('Image generation returned no image.');
}
