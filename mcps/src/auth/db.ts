import { Database } from "bun:sqlite";
import { nanoid } from "nanoid";
import path from "node:path";

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "ara.db");

const db = new Database(DB_PATH, { create: true });

db.exec("PRAGMA journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    team_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id TEXT PRIMARY KEY,
    client_secret TEXT,
    redirect_uris TEXT NOT NULL,
    client_name TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS auth_codes (
    code TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT,
    code_challenge_method TEXT,
    expires_at INTEGER NOT NULL,
    used INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    scope TEXT,
    expires_at INTEGER NOT NULL
  );
`);

export interface OAuthClient {
  client_id: string;
  client_secret: string | null;
  redirect_uris: string;
  client_name: string | null;
}

export interface AuthCode {
  code: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string | null;
  code_challenge_method: string | null;
  expires_at: number;
  used: number;
}

export function registerClient(redirectUris: string[], clientName?: string): OAuthClient {
  const clientId = `ara_${nanoid(24)}`;
  const clientSecret = `secret_${nanoid(32)}`;
  db.prepare(
    `INSERT INTO oauth_clients (client_id, client_secret, redirect_uris, client_name) VALUES (?, ?, ?, ?)`
  ).run(clientId, clientSecret, JSON.stringify(redirectUris), clientName ?? null);
  return { client_id: clientId, client_secret: clientSecret, redirect_uris: JSON.stringify(redirectUris), client_name: clientName ?? null };
}

export function getClient(clientId: string): OAuthClient | undefined {
  return db.prepare(`SELECT * FROM oauth_clients WHERE client_id = ?`).get(clientId) as OAuthClient | undefined;
}

export function createAuthCode(params: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
}): string {
  const code = nanoid(48);
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 min
  db.prepare(
    `INSERT INTO auth_codes (code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(code, params.clientId, params.userId, params.redirectUri, params.codeChallenge ?? null, params.codeChallengeMethod ?? null, expiresAt);
  return code;
}

export function consumeAuthCode(code: string): AuthCode | undefined {
  const row = db.prepare(`SELECT * FROM auth_codes WHERE code = ? AND used = 0 AND expires_at > ?`).get(code, Date.now()) as AuthCode | undefined;
  if (row) {
    db.prepare(`UPDATE auth_codes SET used = 1 WHERE code = ?`).run(code);
  }
  return row;
}

export function storeToken(token: string, userId: string, clientId: string, scope: string, expiresAt: number) {
  db.prepare(
    `INSERT INTO tokens (token, user_id, client_id, scope, expires_at) VALUES (?, ?, ?, ?, ?)`
  ).run(token, userId, clientId, scope, expiresAt);
}

export function getToken(token: string) {
  return db.prepare(`SELECT * FROM tokens WHERE token = ? AND expires_at > ?`).get(token, Date.now()) as { token: string; user_id: string; client_id: string; scope: string; expires_at: number } | undefined;
}

export function findUserByEmail(email: string) {
  return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as { id: string; email: string; password_hash: string; team_id: string | null } | undefined;
}

export function createUser(email: string, passwordHash: string, teamId?: string): string {
  const id = nanoid(16);
  db.prepare(`INSERT INTO users (id, email, password_hash, team_id) VALUES (?, ?, ?, ?)`).run(id, email, passwordHash, teamId ?? null);
  return id;
}

export default db;
