const MIN_SECRET_LENGTH = 32;

export function validateEnv(config: Record<string, unknown>) {
  const secret = config.JWT_SECRET;

  if (typeof secret !== 'string' || secret.trim().length === 0) {
    throw new Error(
      'JWT_SECRET is not set. Copy .env.example to .env and generate one with:\n' +
        "  node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
    );
  }

  if (secret.trim().length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET is too short (${secret.trim().length} chars, minimum ${MIN_SECRET_LENGTH}). ` +
        'Generate a stronger one with:\n' +
        "  node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
    );
  }

  return config;
}
