import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(process.env.APIYI_SKILL_ROOT ?? 'resources/skills/apiyi-image-generation');
const key = 'test-only-apiyi-secret-never-log';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN9sAAAAASUVORK5CYII=',
  'base64'
);
let temp: string;
let server: Server;
let baseUrl: string;
let mode = 'base64';
const requests: Array<{ url: string; body: string; auth?: string }> = [];

async function run(args: string[], input?: object) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = execFile(
      process.execPath,
      [path.join(root, 'bin/install.js'), ...args],
      {
        cwd: temp,
        env: { ...process.env, APIYI_IMAGE_CONFIG_DIR: path.join(temp, 'state'), USERPROFILE: temp, HOME: temp },
        timeout: 20000,
      },
      (error, stdout, stderr) => resolve({ code: error ? Number(error.code) || 1 : 0, stdout, stderr })
    );
    child.stdin?.end(input ? JSON.stringify(input) : '');
  });
}

beforeAll(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'apiyi-skill-'));
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({ url: req.url ?? '', body: Buffer.concat(chunks).toString(), auth: req.headers.authorization });
      if (req.url === '/asset.png') {
        res.setHeader('Content-Type', 'image/png');
        res.end(png);
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      if (mode === 'unauthorized') {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: `bad key ${key}` }));
        return;
      }
      if (mode === 'empty') {
        res.end(JSON.stringify({ data: [] }));
        return;
      }
      if (mode === 'invalid') {
        res.end(JSON.stringify({ data: [{ b64_json: 'not-an-image' }] }));
        return;
      }
      res.end(
        JSON.stringify({
          data: [
            mode === 'url' ? { url: `${baseUrl.replace('/v1', '')}/asset.png` } : { b64_json: png.toString('base64') },
          ],
        })
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Missing test port');
  baseUrl = `http://127.0.0.1:${addr.port}/v1`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(temp, { recursive: true, force: true });
});

describe.sequential('OpenH3 APIYi Skill runtime', () => {
  it('accepts stdin credentials and persists a model without echoing the key', async () => {
    const r = await run(['configure', '--stdin-json'], { baseUrl, apiKey: key, model: 'gpt-image-2.5-all' });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).not.toContain(key);
    const state = JSON.parse((await run(['doctor'])).stdout);
    expect(state.configured).toBe(true);
    expect(state.model).toBe('gpt-image-2.5-all');
  });
  it('never prints secrets in doctor or env and isolates legacy api2img state', async () => {
    for (const command of ['doctor', 'env']) {
      const r = await run([command]);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout + r.stderr).not.toContain(key);
    }
    await expect(fs.access(path.join(temp, '.api2img'))).rejects.toThrow();
    if (process.platform === 'win32') {
      const secret = await fs.readFile(path.join(temp, 'state/secret.json'), 'utf8');
      expect(secret).not.toContain(key);
      expect(JSON.parse(secret).backend).toBe('windows-dpapi');
    }
  });
  it('dry-runs the saved model without network calls', async () => {
    const count = requests.length;
    const r = await run(['generate', '--prompt', 'orange cat', '--size', '768x1024', '--dry-run']);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).model).toBe('gpt-image-2.5-all');
    expect(requests).toHaveLength(count);
  });
  it('generates base64 output through Images API and refuses overwrite before billing', async () => {
    mode = 'base64';
    const args = ['generate', '--prompt', 'orange cat', '--out', 'cat.png'];
    const r = await run(args);
    expect(r.code, r.stderr).toBe(0);
    expect(await fs.readFile(path.join(temp, 'cat.png'))).toEqual(png);
    expect(requests.at(-1)?.url).toBe('/v1/images/generations');
    expect(requests.at(-1)?.auth).toBe(`Bearer ${key}`);
    const count = requests.length;
    expect((await run(args)).code).not.toBe(0);
    expect(requests).toHaveLength(count);
  });
  it('downloads URL outputs without forwarding provider credentials', async () => {
    mode = 'url';
    const r = await run(['generate', '--prompt', 'cat', '--out', 'url.png']);
    expect(r.code, r.stderr).toBe(0);
    expect(await fs.readFile(path.join(temp, 'url.png'))).toEqual(png);
    expect(requests.at(-1)?.auth).toBeUndefined();
  });
  it('sends multipart image edits', async () => {
    mode = 'base64';
    await fs.writeFile(path.join(temp, 'input.png'), png);
    const r = await run(['edit', '--image', 'input.png', '--prompt', 'blue background', '--out', 'edit.png']);
    expect(r.code, r.stderr).toBe(0);
    expect(requests.at(-1)?.url).toBe('/v1/images/edits');
    expect(requests.at(-1)?.body).toContain('filename="input.png"');
  });
  it('fails on empty or invalid images instead of reporting success', async () => {
    for (const value of ['empty', 'invalid']) {
      mode = value;
      const r = await run(['generate', '--prompt', 'cat', '--out', `${value}.png`]);
      expect(r.code).not.toBe(0);
      await expect(fs.access(path.join(temp, `${value}.png`))).rejects.toThrow();
    }
  });
  it('reports HTTP failure without key disclosure or automatic retries', async () => {
    mode = 'unauthorized';
    const count = requests.length;
    const r = await run(['generate', '--prompt', 'cat', '--out', 'failure.png']);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('401');
    expect(r.stdout + r.stderr).not.toContain(key);
    expect(requests).toHaveLength(count + 1);
  });
});
