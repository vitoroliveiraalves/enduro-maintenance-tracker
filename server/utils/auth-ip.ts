/**
 * Where the rate limiter reads the client IP from.
 *
 * Never trust a header the client can set. By default only `x-real-ip` is read, so the
 * reverse proxy MUST overwrite it (nginx: `proxy_set_header X-Real-IP $remote_addr;`).
 * Override the header with AUTH_IP_HEADER, or set AUTH_TRUSTED_PROXIES (comma-separated
 * IPs/CIDRs of your proxies) so better-auth walks X-Forwarded-For past them.
 */
export function ipAddressOptions(env: Record<string, string | undefined> = process.env) {
  const trustedProxies = (env.AUTH_TRUSTED_PROXIES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const header = (env.AUTH_IP_HEADER || 'x-real-ip').toLowerCase()
  const configured = trustedProxies.length > 0 || !!env.AUTH_IP_HEADER

  if (env.NODE_ENV === 'production' && !configured) {
    console.warn(
      '[auth] WARNING: neither AUTH_IP_HEADER nor AUTH_TRUSTED_PROXIES is set. Using x-real-ip; ' +
        'if your reverse proxy does not overwrite it, rate limiting is spoofable or collapses into one shared bucket.',
    )
  }

  return {
    ipAddressHeaders: trustedProxies.length > 0 ? ['x-forwarded-for', header] : [header],
    ...(trustedProxies.length > 0 ? { trustedProxies } : {}),
  }
}
