import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createPublicKey, randomBytes, verify } from 'node:crypto';
import type { Socket } from 'node:net';
import { Readable } from 'node:stream';
import { z } from 'zod';

const descriptor = z.object({
  port: z.number().int().min(1).max(65535),
  publicKey: z.string().min(1),
  defaultsFile: z.string().min(1),
});
const markers = z.object({ image: z.string().uuid().optional(), video: z.string().uuid().optional() }).strict();
export function desktopMediaContext() {
  const value = process.env.OPENH3_DESKTOP_MEDIA_CONTEXT;
  if (!value) return undefined;
  const { port, publicKey, defaultsFile } = descriptor.parse(JSON.parse(value));
  return { port, publicKey, defaultsFile };
}
export function hasAccountDefault(kind: 'image' | 'video') {
  const context = desktopMediaContext();
  if (!context) return false;
  try {
    return !!markers.parse(JSON.parse(readFileSync(context.defaultsFile, 'utf8')))[kind];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new Error('CLOUD_MEDIA_DEFAULT_INVALID');
  }
}

/** Authenticate the owning desktop process on the same TCP connection before
 * writing conversation credentials, a paid request, or reference bytes. */
export async function accountMediaFetch(
  route: string,
  headers: Record<string, string>,
  body?: string,
  signal?: AbortSignal,
  ctx: { port: number; publicKey: string } | undefined = desktopMediaContext()
) {
  if (!ctx) throw new Error('CLOUD_MEDIA_DESKTOP_REQUIRED');
  const publicKey = createPublicKey({ key: Buffer.from(ctx.publicKey, 'base64'), format: 'der', type: 'spki' });
  return verifiedLoopbackFetch(
    ctx.port,
    '/api/cloud-video/account-challenge?nonce=',
    (nonce, signature, socket) =>
      verify(null, desktopChallenge(nonce, socket.remotePort, socket.localPort), publicKey, signature),
    route,
    headers,
    body,
    signal
  );
}

export function desktopChallenge(nonce: string, serverPort?: number, clientPort?: number) {
  if (!serverPort || !clientPort) throw new Error('CLOUD_MEDIA_ENDPOINT_UNVERIFIED');
  return Buffer.from(['openh3:media:desktop:v1', nonce, serverPort, clientPort].join('\0'));
}

/** Challenge and request must use the same live socket. Credentials are written
 * only after the specific listener and connection have been authenticated. */
export async function verifiedLoopbackFetch(
  port: number,
  challengePath: string,
  verifyProof: (nonce: string, signature: Buffer, socket: Socket) => boolean,
  route: string,
  headers: Record<string, string>,
  body?: string,
  signal?: AbortSignal
) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1, maxFreeSockets: 1 });
  const options = { agent, host: '127.0.0.1', port };
  try {
    const nonce = randomBytes(32).toString('hex');
    const proof = await new Promise<{ socket: Socket; signature: Buffer }>((resolve, reject) => {
      const req = http.get({ ...options, path: challengePath + nonce, signal: AbortSignal.timeout(5000) }, (res) => {
        const socket = res.socket;
        let text = '';
        res.on('error', reject);
        res.on('data', (chunk: Buffer) => {
          text += chunk.toString();
          if (text.length > 512) req.destroy(new Error('CLOUD_MEDIA_ENDPOINT_UNVERIFIED'));
        });
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) throw new Error('CLOUD_MEDIA_ENDPOINT_UNVERIFIED');
            resolve({ socket, signature: Buffer.from(JSON.parse(text).signature, 'base64') });
          } catch {
            reject(new Error('CLOUD_MEDIA_ENDPOINT_UNVERIFIED'));
          }
        });
      });
      req.on('error', reject);
    });
    if (!verifyProof(nonce, proof.signature, proof.socket)) throw new Error('CLOUD_MEDIA_ENDPOINT_UNVERIFIED');
    return await new Promise<Response>((resolve, reject) => {
      const req = http.request(
        { ...options, path: route, method: body === undefined ? 'GET' : 'POST', signal },
        (res) => {
          res.once('close', () => agent.destroy());
          const status = res.statusCode ?? 500;
          if (status === 204) {
            res.resume();
            resolve(new Response(null, { status }));
            return;
          }
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(res.headers))
            if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(key, item));
            else if (typeof value === 'string') responseHeaders.set(key, value);
          resolve(
            new Response(Readable.toWeb(res) as ReadableStream<Uint8Array<ArrayBuffer>>, {
              status,
              headers: responseHeaders,
            })
          );
        }
      );
      req.on('error', reject);
      // An agent can open a replacement socket if the peer closes between
      // requests. In that case neither headers nor payload are authorized.
      req.once('socket', (socket) => {
        if (socket !== proof.socket || socket.destroyed) {
          req.destroy(new Error('CLOUD_MEDIA_ENDPOINT_UNVERIFIED'));
          return;
        }
        for (const [name, value] of Object.entries(headers)) req.setHeader(name, value);
        req.end(body);
      });
    });
  } catch (error) {
    agent.destroy();
    throw error;
  }
}
