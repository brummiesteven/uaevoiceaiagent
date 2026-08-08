/**
 * Every integration is optional at boot. A missing key degrades one feature
 * with a readable message instead of failing the whole deployment — during a
 * build window half the keys land late.
 */

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export function requireEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const supabaseConfigured = () =>
  Boolean(optionalEnv("NEXT_PUBLIC_SUPABASE_URL") && optionalEnv("SUPABASE_SERVICE_ROLE_KEY"));

export const linearConfigured = () =>
  Boolean(optionalEnv("LINEAR_API_KEY") && optionalEnv("LINEAR_TEAM_ID"));

export const webhookSecretConfigured = () => Boolean(optionalEnv("ELEVENLABS_WEBHOOK_SECRET"));
