export interface UserPayload {
  id: string;
  email: string;
  name: string;
}

const TOKEN_KEY = 'medcity_jwt_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

interface TokenClaims {
  sub: string;
  email: string;
  name: string;
  exp?: number;
}

function readClaims(): TokenClaims | null {
  const token = getToken();
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1])) as TokenClaims;
  } catch {
    return null;
  }
}

export function getUser(): UserPayload | null {
  const claims = readClaims();
  if (!claims) return null;
  return { id: claims.sub, email: claims.email, name: claims.name };
}

export function isTokenExpired(): boolean {
  const claims = readClaims();
  if (!claims) return true;
  if (typeof claims.exp !== 'number') return false;
  return claims.exp * 1000 <= Date.now();
}

export function isAuthenticated(): boolean {
  return !!getToken() && !isTokenExpired();
}
