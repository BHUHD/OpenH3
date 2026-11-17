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
    throw new Error(
      'OPENH3_CLOUD_ACCOUNT_ENDPOINT must be an HTTPS root origin without credentials, query or fragment.'
    );
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    endpoint.includes('?') ||
    endpoint.includes('#')
  ) {
    throw new Error(
      'OPENH3_CLOUD_ACCOUNT_ENDPOINT must be an HTTPS root origin without credentials, query or fragment.'
    );
  }
  return { enabled, endpoint: url.origin + '/' };
}

module.exports = { resolveCloudAccountDefaults };
