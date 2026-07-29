export function buildConnectionString(
  databaseUrl: string,
  sslMode?: string,
): string {
  if (!sslMode || databaseUrl.includes('sslmode')) return databaseUrl;
  return `${databaseUrl}?sslmode=${sslMode}`;
}
