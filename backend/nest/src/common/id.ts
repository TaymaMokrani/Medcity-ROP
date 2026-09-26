import { randomBytes } from 'crypto';
export function generateId(prefix: string): string {
  const time = Date.now().toString(36).toUpperCase();
  const random = randomBytes(5).toString('hex').toUpperCase();
  return `${prefix}-${time}${random}`;
}
