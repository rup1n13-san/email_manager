export async function revokeGoogleToken(token: string): Promise<boolean> {
  if (!token) return false;

  try {
    const res = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${encodeURIComponent(token)}`,
    });
    return res.ok;
  } catch {
    return false;
  }
}
