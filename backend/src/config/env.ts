const REQUIRED_VARS = [
  'DATABASE_URL',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'ENCRYPTION_KEY',
] as const;

export function validateEnv(config: Record<string, unknown>) {
  for (const key of REQUIRED_VARS) {
    if (!config[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  const encKey = config.ENCRYPTION_KEY as string;
  if (!/^[0-9a-f]{64}$/i.test(encKey)) {
    throw new Error(
      'ENCRYPTION_KEY must be a 64-character hex string (32 bytes).\n' +
        'Generate one with: openssl rand -hex 32',
    );
  }

  return config;
}
