// Adapted from the supplied api2img runtime (MIT); see ../LICENSE.
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, saveConfig, saveSecret, runtimeState, publicState, clearAll } = require('./store');

function parseArgs(argv) {
  const args = { _: [], images: [] };
  const flags = new Set(['dry-run', 'force', 'stdin-json', 'clear', 'progress']);
  const values = new Set([
    'prompt',
    'prompt-file',
    'model',
    'size',
    'quality',
    'n',
    'out',
    'out-dir',
    'image',
    'mask',
    'output-format',
    'timeout-ms',
    'base-url',
    'background',
    'input-fidelity',
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      args._.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (flags.has(name)) {
      args[name] = true;
      continue;
    }
    if (!values.has(name) || !argv[i + 1] || argv[i + 1].startsWith('--'))
      throw new Error(`Unknown option or missing value: --${name}`);
    const value = argv[++i];
    if (name === 'image') args.images.push(path.resolve(value));
    else args[name] = value;
  }
  return args;
}

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid API base URL.');
  }
  if (url.username || url.password || url.search || url.hash)
    throw new Error('API base URL must not contain credentials, query, or fragment.');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error('Use HTTPS for a remote API.');
  const base = url.href.replace(/\/+$/, '');
  return base.endsWith('/v1') ? base : `${base}/v1`;
}

async function configure(args) {
  if (args.clear) {
    if (args['stdin-json'] || args['base-url'] || args.model)
      throw new Error('--clear cannot be combined with configuration fields.');
    clearAll();
    console.log('APIYi configuration cleared.');
    return 0;
  }
  let input = {};
  if (args['stdin-json']) {
    let text = '';
    for await (const chunk of process.stdin) text += chunk;
    try {
      input = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch {
      throw new Error('Invalid configuration JSON on stdin.');
    }
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Configuration must be an object.');
    if (Object.keys(input).some((key) => !['baseUrl', 'apiKey', 'model'].includes(key)))
      throw new Error('Supported configuration fields: baseUrl, apiKey, model.');
  }
  const previous = loadConfig();
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? args['base-url'] ?? previous.baseUrl ?? 'https://api.apiyi.com/v1');
  const model = input.model ?? args.model ?? previous.model ?? 'gpt-image-2.5-all';
  if (typeof model !== 'string' || !model.trim()) throw new Error('Model must be a nonempty string.');
  if (input.apiKey !== undefined) {
    if (typeof input.apiKey !== 'string' || !input.apiKey.trim() || /\s/.test(input.apiKey))
      throw new Error('API key must be a nonempty string without whitespace.');
    saveSecret(input.apiKey);
  }
  saveConfig({ baseUrl, model });
  console.log(JSON.stringify(publicState(), null, 2));
  return 0;
}

function mimeType(file) {
  const ext = path.extname(file).toLowerCase();
  return (
    { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[ext] ||
    'application/octet-stream'
  );
}

function imageFormat(bytes) {
  if (
    bytes.length > 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString('ascii', 12, 16) === 'IHDR'
  )
    return 'png';
  if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
  if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
    return 'webp';
  throw new Error('Response does not contain PNG, JPEG, or WebP image bytes.');
}

function outputPaths(args, count, format) {
  const output = path.resolve(args.out || `output/imagegen/image-${Date.now()}.${format}`);
  const parsed = path.parse(output);
  return Array.from({ length: count }, (_, i) => {
    if (args['out-dir']) return path.resolve(args['out-dir'], `image_${i + 1}.${format}`);
    return path.join(parsed.dir, `${parsed.name}${count > 1 ? `-${i + 1}` : ''}${parsed.ext || `.${format}`}`);
  });
}

async function generate(command, args) {
  const state = runtimeState();
  const prompt = args['prompt-file'] ? fs.readFileSync(path.resolve(args['prompt-file']), 'utf8').trim() : args.prompt;
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Use --prompt or --prompt-file.');
  const n = Number(args.n ?? 1);
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error('--n must be an integer from 1 to 10.');
  const format = (args['output-format'] || 'png').replace(/^jpg$/, 'jpeg');
  if (!['png', 'jpeg', 'webp'].includes(format)) throw new Error('Invalid --output-format.');
  const timeout = Number(args['timeout-ms'] ?? 300000);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 1800000)
    throw new Error('--timeout-ms must be between 1 and 1800000.');
  const payload = { model: args.model || state.model, prompt, n, size: args.size || 'auto' };
  // Forward optional fields only when requested; model capabilities vary by relay.
  if (args.quality) payload.quality = args.quality;
  if (args['output-format']) payload.output_format = format;
  if (args.background) payload.background = args.background;
  if (args['input-fidelity']) payload.input_fidelity = args['input-fidelity'];
  const endpoint = `${normalizeBaseUrl(state.baseUrl)}/images/${command === 'edit' ? 'edits' : 'generations'}`;
  if (command === 'edit' && !args.images.length) throw new Error('edit requires --image.');
  if (command !== 'edit' && (args.images.length || args.mask)) throw new Error('Use edit for input images or masks.');
  for (const file of [...args.images, ...(args.mask ? [path.resolve(args.mask)] : [])]) fs.accessSync(file);
  const outputs = outputPaths(args, n, format);
  for (const output of outputs) {
    if (fs.existsSync(output) && !args.force)
      throw new Error('Output already exists. Choose another path or explicitly use --force.');
  }
  if (args['dry-run']) {
    console.log(
      JSON.stringify({ endpoint, outputs, ...payload, ...(command === 'edit' ? { images: args.images } : {}) }, null, 2)
    );
    return 0;
  }
  if (!state.configured) throw new Error('APIYi key is missing or unreadable. Run configure --stdin-json first.');
  const signal = AbortSignal.timeout(timeout);
  let body;
  const headers = { Authorization: `Bearer ${state.apiKey}` };
  if (command === 'edit') {
    body = new FormData();
    for (const [key, value] of Object.entries(payload)) body.append(key, String(value));
    for (const file of args.images)
      body.append('image', new Blob([fs.readFileSync(file)], { type: mimeType(file) }), path.basename(file));
    if (args.mask)
      body.append(
        'mask',
        new Blob([fs.readFileSync(args.mask)], { type: mimeType(args.mask) }),
        path.basename(args.mask)
      );
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(payload);
  }
  try {
    const response = await fetch(endpoint, { method: 'POST', headers, body, signal, redirect: 'error' });
    if (!response.ok) throw new Error(`Image API returned HTTP ${response.status}. No retry was submitted.`);
    const result = await response.json();
    if (!Array.isArray(result.data) || result.data.length !== n)
      throw new Error('Unexpected image count in API response. No retry was submitted.');
    // Validate all returned bytes before writing any output.
    const images = [];
    for (const item of result.data) {
      let bytes;
      if (typeof item?.b64_json === 'string' && item.b64_json) {
        if (!/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(item.b64_json)) throw new Error('Invalid base64 image.');
        bytes = Buffer.from(item.b64_json, 'base64');
      } else if (typeof item?.url === 'string') {
        const url = new URL(item.url);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
          throw new Error('Invalid image download URL.');
        // Signed asset URLs must never receive the provider's Authorization header.
        const download = await fetch(url, { signal, redirect: 'error' });
        if (!download.ok) throw new Error(`Image download returned HTTP ${download.status}.`);
        bytes = Buffer.from(await download.arrayBuffer());
      } else throw new Error('Missing b64_json or url in image response.');
      images.push({ bytes, format: imageFormat(bytes) });
    }
    const actualOutputs = images.map((item, i) => {
      const parsed = path.parse(outputs[i]);
      const expected = parsed.ext.toLowerCase().replace('.', '').replace(/^jpg$/, 'jpeg');
      return expected === item.format ? outputs[i] : path.join(parsed.dir, `${parsed.name}.${item.format}`);
    });
    for (const output of actualOutputs)
      if (fs.existsSync(output) && !args.force) throw new Error('Image-format-adjusted output already exists.');
    images.forEach((item, i) => {
      fs.mkdirSync(path.dirname(actualOutputs[i]), { recursive: true });
      fs.writeFileSync(actualOutputs[i], item.bytes, { flag: args.force ? 'w' : 'wx' });
    });
    console.log(JSON.stringify({ success: true, model: payload.model, files: actualOutputs }, null, 2));
    return 0;
  } catch (error) {
    if (signal.aborted)
      throw new Error('Image request timed out; server outcome is unknown. No automatic retry was submitted.');
    // Do not propagate raw responses, signed URLs, credentials, or fetch internals.
    const message = String(error.message || 'Image request failed.')
      .split(state.apiKey)
      .join('[redacted]');
    if (error instanceof SyntaxError || message === 'fetch failed')
      throw new Error('Image request failed: network error or invalid API response. No automatic retry was submitted.');
    throw new Error(message);
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  const command = args._[0];
  if (!command || command === 'help') {
    console.log(
      'apiyi-image-generation: configure --stdin-json | doctor | generate --prompt TEXT | edit --image PATH --prompt TEXT'
    );
    return 0;
  }
  if (command === 'configure') return configure(args);
  if (command === 'doctor' || command === 'env') {
    const state = publicState();
    console.log(JSON.stringify(state, null, 2));
    return state.configured ? 0 : 1;
  }
  if (command === 'generate' || command === 'edit') return generate(command, args);
  throw new Error('Unknown command. Run help for supported commands.');
}

module.exports = { main };
