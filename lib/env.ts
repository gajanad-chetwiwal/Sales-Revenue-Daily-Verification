import 'server-only';

/**
 * Server-side environment access. Every getter throws loudly rather than
 * silently falling back, so a misconfigured deploy fails fast at request time
 * instead of writing bad data.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const getDatabaseUrl = (): string => required('DATABASE_URL');
export const getDashboardPassword = (): string => required('DASHBOARD_PASSWORD');
export const getCronSecret = (): string => required('CRON_SECRET');
export const getTokenEncryptionKey = (): string => required('TOKEN_ENCRYPTION_KEY');
