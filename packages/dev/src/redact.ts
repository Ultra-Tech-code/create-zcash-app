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

export function sanitizeError(err: unknown, mnemonic?: string): Error {
  let message = err instanceof Error ? err.message : String(err);
  if (mnemonic && mnemonic.trim()) {
    message = message.split(mnemonic.trim()).join('<redacted>');
    const words = mnemonic.trim().split(/\s+/);
    if (words.length >= 12) {
      const joinedWords = words.join(' ');
      message = message.split(joinedWords).join('<redacted>');
    }
  }

  // Redact URLs with secrets/paths
  message = message.replace(/https?:\/\/[^\s"'<>]+/g, (url) => redactSecretUrl(url));

  const clean = new Error(message);
  clean.name = err instanceof Error ? err.name : 'Error';
  return clean;
}
