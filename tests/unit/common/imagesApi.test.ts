import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeImageGeneration } from '@/common/chat/imageGenCore';
import { imageUrlToDataUrl } from '@/common/chat/document/creation/imagesApi';
import type { TProviderWithModel } from '@/common/config/storage';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
let server: Server;
let workspace: string;
let provider: TProviderWithModel;
let reply: unknown;
let requests: Array<{ url?: string; body: string; authorization?: string }>;

beforeEach(async () => {
  requests = [];
  workspace = mkdtempSync(join(tmpdir(), 'openh3-images-api-'));
  reply = { data: [{ b64_json: png }] };
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push({ url: req.url, body: Buffer.concat(chunks).toString(), authorization: req.headers.authorization });
    if (req.url === '/output.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.from(png, 'base64'));
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server port');
  provider = {
    id: 'test',
    name: 'Custom images API',
    platform: 'openai',
    base_url: `http://127.0.0.1:${address.port}/v1`,
    api_key: 'test-key',
    use_model: 'gpt-image-2.5-all',
  };
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  rmSync(workspace, { recursive: true, force: true });
});

describe('creation images API', () => {
  it('uses the images endpoint and saves pure base64 output', async () => {
    const result = await executeImageGeneration({ prompt: 'An orange cat, portrait 3:4' }, provider, workspace);
    expect(requests[0]?.url).toBe('/v1/images/generations');
    expect(JSON.parse(requests[0].body)).toMatchObject({
      model: provider.use_model,
      prompt: 'An orange cat, portrait 3:4',
    });
    expect(requests[0].authorization).toBe('Bearer test-key');
    expect(result.success).toBe(true);
    expect(readFileSync(result.imagePath!)).toEqual(Buffer.from(png, 'base64'));
  });

  it('uploads every reference as repeated image fields and accepts data URLs', async () => {
    writeFileSync(join(workspace, 'first.png'), Buffer.from(png, 'base64'));
    writeFileSync(join(workspace, 'second.png'), Buffer.from(png, 'base64'));
    reply = { data: [{ b64_json: `data:image/png;base64,${png}` }] };
    const result = await executeImageGeneration(
      { prompt: 'Keep both people', image_uris: ['first.png', 'second.png'] },
      provider,
      workspace
    );
    expect(requests[0]?.url).toBe('/v1/images/edits');
    expect(requests[0].body.match(/name="image";/g)).toHaveLength(2);
    expect(requests[0].body).toContain('filename="first.png"');
    expect(requests[0].body).toContain('filename="second.png"');
    expect(result.success).toBe(true);
    expect(readFileSync(result.imagePath!)).toEqual(Buffer.from(png, 'base64'));
  });

  it('downloads URL output without forwarding the API credential', async () => {
    reply = { data: [{ url: `${provider.base_url.replace('/v1', '')}/output.png` }] };
    const result = await executeImageGeneration({ prompt: 'a cat' }, provider, workspace);
    expect(result.success).toBe(true);
    expect(readFileSync(result.imagePath!)).toEqual(Buffer.from(png, 'base64'));
    expect(requests.find((request) => request.url === '/output.png')?.authorization).toBeUndefined();
  });

  it('fails before calling the API if any reference is missing', async () => {
    writeFileSync(join(workspace, 'first.png'), Buffer.from(png, 'base64'));
    const result = await executeImageGeneration(
      { prompt: 'Keep both people', image_uris: ['first.png', 'missing.png'] },
      provider,
      workspace
    );
    expect(result.success).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it('does not report success when the provider returns no image', async () => {
    reply = { data: [] };
    const result = await executeImageGeneration({ prompt: 'a cat' }, provider, workspace);
    expect(result.success).toBe(false);
  });

  it('rejects malformed base64 instead of writing a fake image file', async () => {
    reply = { data: [{ b64_json: 'not-an-image' }] };
    const result = await executeImageGeneration({ prompt: 'a cat' }, provider, workspace);
    expect(result.success).toBe(false);
    expect(result.error).toContain('base64');
  });

  it('rejects image URLs that embed credentials before downloading', async () => {
    await expect(imageUrlToDataUrl('http://user:secret@127.0.0.1/image.png')).rejects.toThrow(
      'Image URL must not contain credentials'
    );
    expect(requests).toHaveLength(0);
  });

  it('does not follow redirects while downloading image results', async () => {
    server.close();
    server = createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { location: '/output.png' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.from(png, 'base64'));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server port');

    await expect(imageUrlToDataUrl(`http://127.0.0.1:${address.port}/redirect`)).rejects.toThrow(
      'Image download failed'
    );
  });
});
