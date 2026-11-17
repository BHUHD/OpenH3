/** Resolve nonsecret desktop account defaults for the main-process bundle. */
function resolveCloudAccountDefaults(env) {
  const enabled = env.OPENH3_CLOUD_ACCOUNT_ENABLED === '1' ? '1' : '0';
  const endpoint = env.OPENH3_CLOUD_ACCOUNT_ENDPOINT?.trim() || '';
  if (!endpoint) {
    if (enabled === '1') throw new Error('OPENH3_CLOUD_ACCOUNT_ENDPOINT is required when embedding account access.');
    return { enabled, endpoint: '' };
  }
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('OPENH3_CLOUD_ACCOUNT_ENDPOINT must be an HTTPS base URL without credentials, query or fragment.');
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    endpoint.includes('?') ||
    endpoint.includes('#')
  ) {
    throw new Error('OPENH3_CLOUD_ACCOUNT_ENDPOINT must be an HTTPS base URL without credentials, query or fragment.');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return { enabled, endpoint: url.href };
}

module.exports = { resolveCloudAccountDefaults };
