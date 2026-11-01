export function redactSecretUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
  const trimmed = rawUrl.trim();
  if (!trimmed.includes('://')) {
    if (trimmed.includes('@')) {
      return trimmed.replace(/^[^@]+@/, '<redacted>@');
    }
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    const hasAuth = Boolean(parsed.username || parsed.password);
    const hasPathSecret = parsed.pathname.length > 1;
    const hasQuerySecret = parsed.search.length > 1;
    if (hasAuth || hasPathSecret || hasQuerySecret) {
      const portPart = parsed.port ? `:${parsed.port}` : '';
      return `${parsed.protocol}//${parsed.hostname}${portPart}/<redacted>`;
    }
    return trimmed;
  } catch {
    return trimmed
      .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^@]+@([^\s/]+)/, '$1<redacted>@$2')
      .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s/?]+)\/[^\s]+/, '$1/<redacted>')
      .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s/?]+)\?[^\s]+/, '$1/<redacted>');
  }
}
