import { renderApp } from './ui';
import { renderDeviceDashboard } from './device-ui';

interface Env {
  DB: D1Database;
  APP_NAME: string;
  SESSION_HOURS: string;
  REMEMBER_DAYS: string;
  SESSION_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

type User = { id: string; email: string; display_name: string; avatar_url: string | null };
type SessionUser = User & { session_hash: string };
type JsonObject = Record<string, unknown>;

const SESSION_COOKIE = '__Host-edusense_session';
const OAUTH_COOKIE = '__Host-edusense_oauth';
const encoder = new TextEncoder();

const securityHeaders: Record<string, string> = {
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...securityHeaders, ...headers },
  });
}

function fail(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomToken(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

function constantTimeEqual(a: string, b: string): boolean {
  const size = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < size; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function parseCookies(request: Request): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}

function cookie(name: string, value: string, maxAge?: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax${maxAge ? `; Max-Age=${maxAge}` : ''}`;
}

async function readBody(request: Request): Promise<JsonObject> {
  if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) throw new Error('Expected JSON request body');
  const body = await request.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid request body');
  return body as JsonObject;
}

function text(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function finite(value: unknown, min: number, max: number, nullable = false): number | null {
  if (value === null || value === undefined || value === '') return nullable ? null : NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : NaN;
}

function requireSecret(env: Env): string {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET is not configured');
  return env.SESSION_SECRET;
}

async function currentUser(request: Request, env: Env): Promise<SessionUser | null> {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const hash = await sha256(token);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(`SELECT u.id, u.email, u.display_name, u.avatar_url, s.token_hash AS session_hash
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).bind(hash, now).first<SessionUser>();
  if (row) await env.DB.prepare('UPDATE sessions SET last_seen_at=? WHERE token_hash=?').bind(now, hash).run();
  return row || null;
}

async function requireUser(request: Request, env: Env): Promise<SessionUser | Response> {
  return (await currentUser(request, env)) || fail('Authentication required', 401);
}

async function signedPayload(payload: JsonObject, env: Env): Promise<string> {
  const encoded = base64Url(encoder.encode(JSON.stringify(payload)));
  return `${encoded}.${await hmac(encoded, requireSecret(env))}`;
}

async function verifySignedPayload(value: string, env: Env): Promise<JsonObject | null> {
  const [payload, signature] = value.split('.');
  if (!payload || !signature || !constantTimeEqual(signature, await hmac(payload, requireSecret(env)))) return null;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = decodeURIComponent(Array.from(atob(normalized), c => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''));
    return JSON.parse(decoded) as JsonObject;
  } catch { return null; }
}

function providerConfig(provider: string, env: Env, origin: string) {
  if (provider === 'google' && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) return {
    clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET,
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
    userinfo: 'https://openidconnect.googleapis.com/v1/userinfo', redirect: `${origin}/auth/google/callback`,
  };
  return null;
}

async function oauthStart(request: Request, env: Env, provider: string): Promise<Response> {
  const url = new URL(request.url);
  const config = providerConfig(provider, env, url.origin);
  if (!config) return fail(`${provider} login is not configured`, 503);
  const verifier = randomToken(48);
  const challenge = await sha256(verifier);
  const nonce = randomToken(20);
  const remember = url.searchParams.get('remember') === '1';
  const requestedReturn = url.searchParams.get('returnTo') || '/';
  const returnTo = requestedReturn.startsWith('/') && !requestedReturn.startsWith('//') ? requestedReturn.slice(0, 500) : '/';
  const expires = Math.floor(Date.now() / 1000) + 600;
  const state = await signedPayload({ provider, nonce, expires }, env);
  const oauthCookie = await signedPayload({ provider, nonce, verifier, remember, returnTo, expires }, env);
  const auth = new URL(config.authorize);
  auth.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirect, response_type: 'code', scope: 'openid profile email', state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' }).toString();
  return new Response(null, { status: 302, headers: { Location: auth.toString(), 'Set-Cookie': cookie(OAUTH_COOKIE, oauthCookie, 600), ...securityHeaders } });
}

async function oauthCallback(request: Request, env: Env, provider: string): Promise<Response> {
  const url = new URL(request.url);
  const config = providerConfig(provider, env, url.origin);
  if (!config) return fail('Login provider is not configured', 503);
  const state = await verifySignedPayload(url.searchParams.get('state') || '', env);
  const stored = await verifySignedPayload(parseCookies(request)[OAUTH_COOKIE] || '', env);
  const now = Math.floor(Date.now() / 1000);
  if (!state || !stored || state.provider !== provider || stored.provider !== provider || state.nonce !== stored.nonce || Number(stored.expires) < now) return fail('Login session expired or was invalid', 400);
  const code = url.searchParams.get('code');
  if (!code) return fail('Login was cancelled', 400);
  const tokenResponse = await fetch(config.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, grant_type: 'authorization_code', redirect_uri: config.redirect, code_verifier: String(stored.verifier) }) });
  const tokens = await tokenResponse.json() as { access_token?: string; error_description?: string };
  if (!tokenResponse.ok || !tokens.access_token) return fail(tokens.error_description || 'Identity provider rejected the login', 401);
  const profileResponse = await fetch(config.userinfo, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  const profile = await profileResponse.json() as { sub?: string; email?: string; preferred_username?: string; name?: string; picture?: string };
  const subject = text(profile.sub, 255);
  const email = text(profile.email || profile.preferred_username, 320).toLowerCase();
  if (!profileResponse.ok || !subject || !email || !email.includes('@')) return fail('The identity provider did not return a verified account email', 401);
  let user = await env.DB.prepare('SELECT id, email, display_name, avatar_url FROM users WHERE email=? COLLATE NOCASE').bind(email).first<User>();
  const userId = user?.id || crypto.randomUUID();
  const displayName = text(profile.name, 120) || email.split('@')[0];
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO users(id,email,display_name,avatar_url,created_at,last_login_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(email) DO UPDATE SET display_name=excluded.display_name, avatar_url=excluded.avatar_url, last_login_at=excluded.last_login_at`).bind(userId, email, displayName, text(profile.picture, 500) || null, now, now),
    env.DB.prepare(`INSERT INTO oauth_accounts(provider,provider_subject,user_id,created_at) VALUES(?,?,?,?)
      ON CONFLICT(provider,provider_subject) DO UPDATE SET user_id=excluded.user_id`).bind(provider, subject, userId, now),
  ]);
  user = await env.DB.prepare('SELECT id, email, display_name, avatar_url FROM users WHERE email=? COLLATE NOCASE').bind(email).first<User>();
  if (!user) return fail('Unable to create the account', 500);
  const sessionToken = randomToken(32);
  const remember = Boolean(stored.remember);
  const lifetime = remember ? Number(env.REMEMBER_DAYS || 30) * 86400 : Number(env.SESSION_HOURS || 12) * 3600;
  await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at,last_seen_at,user_agent) VALUES(?,?,?,?,?,?)')
    .bind(await sha256(sessionToken), user.id, now, now + lifetime, now, text(request.headers.get('User-Agent'), 500) || null).run();
  const returnTo = typeof stored.returnTo === 'string' && stored.returnTo.startsWith('/') ? stored.returnTo : '/';
  const headers = new Headers({ Location: returnTo, ...securityHeaders });
  headers.append('Set-Cookie', cookie(SESSION_COOKIE, sessionToken, remember ? lifetime : undefined));
  headers.append('Set-Cookie', cookie(OAUTH_COOKIE, '', 1));
  return new Response(null, { status: 302, headers });
}

async function schoolsForUser(env: Env, userId: string) {
  const result = await env.DB.prepare(`SELECT s.id,s.name,s.timezone,m.role FROM memberships m JOIN schools s ON s.id=m.school_id WHERE m.user_id=? ORDER BY s.name`).bind(userId).all();
  return result.results;
}

async function hasSchoolRole(env: Env, userId: string, schoolId: string, roles: string[]): Promise<boolean> {
  const row = await env.DB.prepare('SELECT role FROM memberships WHERE user_id=? AND school_id=?').bind(userId, schoolId).first<{ role: string }>();
  return Boolean(row && roles.includes(row.role));
}

async function canAccessDevice(env: Env, userId: string, deviceId: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT 1 AS allowed FROM devices d WHERE d.id=? AND (
    EXISTS (SELECT 1 FROM memberships m WHERE m.school_id=d.school_id AND m.user_id=? AND m.role IN ('owner','admin','staff'))
    OR EXISTS (SELECT 1 FROM device_access a WHERE a.device_id=d.id AND a.user_id=?)) LIMIT 1`)
    .bind(deviceId, userId, userId).first();
  return Boolean(row);
}

async function createSchool(request: Request, env: Env, user: SessionUser): Promise<Response> {
  const body = await readBody(request);
  const name = text(body.name, 120);
  const timezone = text(body.timezone, 80) || 'Asia/Kolkata';
  if (name.length < 2) return fail('School name is required');
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO schools(id,name,timezone,created_at,created_by) VALUES(?,?,?,?,?)').bind(id, name, timezone, now, user.id),
    env.DB.prepare("INSERT INTO memberships(school_id,user_id,role,created_at) VALUES(?,?,'owner',?)").bind(id, user.id, now),
  ]);
  return json({ id, name, timezone, role: 'owner' }, 201);
}

async function createEnrollmentToken(request: Request, env: Env, user: SessionUser): Promise<Response> {
  const body = await readBody(request);
  const schoolId = text(body.schoolId, 80);
  if (!(await hasSchoolRole(env, user.id, schoolId, ['owner', 'admin']))) return fail('Administrator access required', 403);
  const token = `edu_${randomToken(24)}`;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('INSERT INTO enrollment_tokens(token_hash,school_id,created_by,created_at,expires_at) VALUES(?,?,?,?,?)').bind(await sha256(token), schoolId, user.id, now, now + 900).run();
  return json({ token, expiresAt: now + 900 }, 201);
}

async function enrollDevice(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request);
  const enrollmentToken = text(body.enrollmentToken, 200);
  const serial = text(body.hardwareSerial, 120);
  const name = text(body.name, 120) || 'EDUSENSE Classroom';
  if (!enrollmentToken || !serial) return fail('Enrollment token and hardware serial are required');
  const now = Math.floor(Date.now() / 1000);
  const enrollment = await env.DB.prepare('SELECT token_hash,school_id FROM enrollment_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>?').bind(await sha256(enrollmentToken), now).first<{ token_hash: string; school_id: string }>();
  if (!enrollment) return fail('Setup code is invalid, expired, or already used', 401);
  const existing = await env.DB.prepare('SELECT id,claimed_at FROM devices WHERE hardware_serial=?').bind(serial).first<{ id: string; claimed_at: number | null }>();
  if (existing?.claimed_at) return fail('This device is already claimed. An administrator must release it first.', 409);
  const id = existing?.id || crypto.randomUUID();
  const secret = randomToken(40);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO devices(id,hardware_serial,name,school_id,secret_hash,claimed_at,firmware_version,created_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(hardware_serial) DO UPDATE SET name=excluded.name,school_id=excluded.school_id,secret_hash=excluded.secret_hash,claimed_at=excluded.claimed_at,firmware_version=excluded.firmware_version`)
      .bind(id, serial, name, enrollment.school_id, await sha256(secret), now, text(body.firmwareVersion, 80) || null, now),
    env.DB.prepare('UPDATE enrollment_tokens SET used_at=? WHERE token_hash=?').bind(now, enrollment.token_hash),
  ]);
  return json({ deviceId: id, deviceSecret: secret, cloudUrl: new URL(request.url).origin }, 201);
}

async function authenticatedDevice(request: Request, env: Env): Promise<{ id: string } | null> {
  const value = request.headers.get('Authorization') || '';
  if (!value.startsWith('Bearer ')) return null;
  const [id, secret] = value.slice(7).split('.', 2);
  if (!id || !secret) return null;
  const row = await env.DB.prepare('SELECT id,secret_hash FROM devices WHERE id=?').bind(id).first<{ id: string; secret_hash: string }>();
  if (!row) return null;
  return constantTimeEqual(row.secret_hash, await sha256(secret)) ? { id: row.id } : null;
}

function validateReading(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Each reading must be an object');
  const source = value as JsonObject;
  const now = Math.floor(Date.now() / 1000);
  const captured = finite(source.captured_at, now - 7776000, now + 300);
  const status = text(source.ai_status, 20).toUpperCase();
  if (!Number.isFinite(captured) || !['CALIBRATING','SAFE','ELEVATED','WARNING','DANGER','OFFLINE'].includes(status)) throw new Error('Reading timestamp or status is invalid');
  const result: Record<string, unknown> = { captured_at: captured, ai_status: status };
  for (const key of ['mq2','mq3','mq4','mq5','mq7','mq8']) {
    const n = finite(source[key], 0, 65535);
    if (!Number.isFinite(n)) throw new Error(`${key} is invalid`);
    result[key] = n;
    const adc = finite(source[`${key}_adc`], 0, 1023, true);
    result[`${key}_adc`] = Number.isFinite(adc) ? adc : null;
  }
  for (const [key,min,max] of [['temperature',-50,100],['humidity',0,100],['overall_aqi',0,10000],['confidence',0,100],['pi_cpu_temp',-20,120],['cpu_usage',0,100],['ram_usage',0,100],['disk_usage',0,100]] as const) {
    const n = finite(source[key], min, max, true);
    result[key] = Number.isFinite(n) ? n : null;
  }
  result.reason = text(source.reason, 500) || null;
  result.arduino_connected = source.arduino_connected ? 1 : 0;
  result.serial_status = text(source.serial_status, 80) || null;
  return result;
}

async function ingestTelemetry(request: Request, env: Env): Promise<Response> {
  const device = await authenticatedDevice(request, env);
  if (!device) return fail('Device authentication failed', 401);
  const body = await readBody(request);
  const measurementUnit = text(body.measurementUnit, 24).toUpperCase();
  if (!['ADC', 'ESTIMATED_PPM'].includes(measurementUnit)) return fail('measurementUnit must be ADC or ESTIMATED_PPM', 409);
  const input = Array.isArray(body.readings) ? body.readings : [];
  if (!input.length || input.length > 60) return fail('A telemetry batch must contain 1 to 60 readings');
  let readings: Record<string, unknown>[];
  try {
    readings = input.map(validateReading).map(reading => ({ ...reading, measurement_unit: measurementUnit }));
    if (measurementUnit === 'ESTIMATED_PPM' && readings.some(reading => ['mq2','mq3','mq4','mq5','mq7','mq8'].some(key => reading[`${key}_adc`] === null))) {
      return fail('Estimated PPM telemetry must include every raw *_adc value', 409);
    }
  } catch (error) { return fail(error instanceof Error ? error.message : 'Invalid reading'); }
  const received = Math.floor(Date.now() / 1000);
  const statements = readings.map(r => env.DB.prepare(`INSERT OR IGNORE INTO readings(device_id,captured_at,received_at,temperature,humidity,mq2,mq3,mq4,mq5,mq7,mq8,mq2_adc,mq3_adc,mq4_adc,mq5_adc,mq7_adc,mq8_adc,measurement_unit,overall_aqi,ai_status,confidence,reason,pi_cpu_temp,cpu_usage,ram_usage,disk_usage,arduino_connected,serial_status)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(device.id,r.captured_at,received,r.temperature,r.humidity,r.mq2,r.mq3,r.mq4,r.mq5,r.mq7,r.mq8,r.mq2_adc,r.mq3_adc,r.mq4_adc,r.mq5_adc,r.mq7_adc,r.mq8_adc,r.measurement_unit,r.overall_aqi,r.ai_status,r.confidence,r.reason,r.pi_cpu_temp,r.cpu_usage,r.ram_usage,r.disk_usage,r.arduino_connected,r.serial_status));
  const latest = readings.reduce((a, b) => Number(a.captured_at) > Number(b.captured_at) ? a : b);
  statements.push(env.DB.prepare(`INSERT INTO latest_readings(device_id,captured_at,payload_json,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(device_id) DO UPDATE SET captured_at=excluded.captured_at,payload_json=excluded.payload_json,updated_at=excluded.updated_at WHERE excluded.captured_at>=latest_readings.captured_at`).bind(device.id, latest.captured_at, JSON.stringify(latest), received));
  statements.push(env.DB.prepare('UPDATE devices SET last_seen_at=?,firmware_version=COALESCE(?,firmware_version) WHERE id=?').bind(received, text(body.firmwareVersion, 80) || null, device.id));
  await env.DB.batch(statements);
  return json({ accepted: readings.length, serverTime: received });
}

async function listDevices(env: Env, user: SessionUser): Promise<Response> {
  const rows = await env.DB.prepare(`SELECT DISTINCT d.id,d.hardware_serial,d.name,d.school_id,d.last_seen_at,d.firmware_version,l.payload_json
    FROM devices d LEFT JOIN memberships m ON m.school_id=d.school_id AND m.user_id=?
    LEFT JOIN device_access a ON a.device_id=d.id AND a.user_id=? LEFT JOIN latest_readings l ON l.device_id=d.id
    WHERE m.role IN ('owner','admin','staff') OR a.user_id IS NOT NULL ORDER BY d.name`).bind(user.id, user.id).all<Record<string, unknown>>();
  const now = Math.floor(Date.now() / 1000);
  const devices = rows.results.map(row => {
    const latest = row.payload_json ? JSON.parse(String(row.payload_json)) : null;
    if (latest && (!row.last_seen_at || now - Number(row.last_seen_at) > 20)) latest.ai_status = 'OFFLINE';
    return { id: row.id, hardwareSerial: row.hardware_serial, name: row.name, schoolId: row.school_id, lastSeenAt: row.last_seen_at, firmwareVersion: row.firmware_version, latest };
  });
  return json({ devices });
}

async function deviceHistory(request: Request, env: Env, user: SessionUser, deviceId: string): Promise<Response> {
  if (!(await canAccessDevice(env, user.id, deviceId))) return fail('Device access denied', 403);
  const url = new URL(request.url);
  const range = url.searchParams.get('range') || '2h';
  const options: Record<string, [number, number]> = { live:[1800,1], '2h':[7200,10], '5h':[18000,60], '1d':[86400,300], '20d':[1728000,3600], '2m':[5356800,86400] };
  const [seconds, bucket] = options[range] || options['2h'];
  const since = Math.floor(Date.now() / 1000) - seconds;
  const latest = await env.DB.prepare(`SELECT measurement_unit,mq2,mq3,mq4,mq5,mq7,mq8,mq2_adc,mq3_adc,mq4_adc,mq5_adc,mq7_adc,mq8_adc FROM readings
    WHERE device_id=? ORDER BY captured_at DESC LIMIT 1`).bind(deviceId).first<Record<string, unknown>>();
  const measurementUnit = String(latest?.measurement_unit || 'ADC');
  const [rows, calibration] = await Promise.all([
    env.DB.prepare(`SELECT CAST(captured_at / ? AS INTEGER) * ? AS captured_at,AVG(temperature) temperature,AVG(humidity) humidity,AVG(mq2) mq2,AVG(mq3) mq3,AVG(mq4) mq4,AVG(mq5) mq5,AVG(mq7) mq7,AVG(mq8) mq8,AVG(mq2_adc) mq2_adc,AVG(mq3_adc) mq3_adc,AVG(mq4_adc) mq4_adc,AVG(mq5_adc) mq5_adc,AVG(mq7_adc) mq7_adc,AVG(mq8_adc) mq8_adc,MAX(measurement_unit) measurement_unit,AVG(overall_aqi) overall_aqi
      FROM readings WHERE device_id=? AND captured_at>=? AND measurement_unit=? AND (? <> 'ESTIMATED_PPM' OR ai_status <> 'CALIBRATING') GROUP BY CAST(captured_at / ? AS INTEGER) ORDER BY captured_at`)
      .bind(bucket,bucket,deviceId,since,measurementUnit,measurementUnit,bucket).all(),
    env.DB.prepare(`SELECT COUNT(*) samples,AVG(mq2_adc) mq2,AVG(mq3_adc) mq3,AVG(mq4_adc) mq4,AVG(mq5_adc) mq5,AVG(mq7_adc) mq7,AVG(mq8_adc) mq8 FROM (
      SELECT mq2_adc,mq3_adc,mq4_adc,mq5_adc,mq7_adc,mq8_adc FROM readings WHERE device_id=? AND ai_status='CALIBRATING' AND mq2_adc IS NOT NULL ORDER BY captured_at DESC LIMIT 200
    )`).bind(deviceId).first<Record<string, unknown>>(),
  ]);
  const baseline = Object.fromEntries(['mq2','mq3','mq4','mq5','mq7','mq8'].map(key => [key, Number(calibration?.[key]) || null]));
  const sensitivity: Record<string, [number, number, number]> = {
    mq2:[12,30,70], mq3:[20,50,120], mq4:[18,45,100], mq5:[15,35,80], mq7:[10,25,60], mq8:[18,45,100],
  };
  const sensorStates = Object.fromEntries(Object.entries(sensitivity).map(([key,[elevated,warning,danger]]) => {
    const current = Number(latest?.[`${key}_adc`]);
    const base = Number(baseline[key]);
    if (!Number.isFinite(current) || !Number.isFinite(base) || base <= 0) return [key, 'BASELINING'];
    const increase = ((current - base) / Math.max(base, 1)) * 100;
    return [key, increase >= danger ? 'DANGER' : increase >= warning ? 'WARNING' : increase >= elevated ? 'ELEVATED' : 'SAFE'];
  }));
  return json({ range, durationSeconds: seconds, bucketSeconds: bucket, measurementUnit, baseline, baselineUnit: 'ADC', baselineSamples: Number(calibration?.samples || 0), sensorStates, readings: rows.results });
}

async function createInvitation(request: Request, env: Env, user: SessionUser): Promise<Response> {
  const body = await readBody(request);
  const schoolId = text(body.schoolId, 80);
  const email = text(body.email, 320).toLowerCase();
  const role = text(body.role, 20);
  const deviceId = text(body.deviceId, 80);
  if (!(await hasSchoolRole(env, user.id, schoolId, ['owner','admin']))) return fail('Administrator access required', 403);
  if (!email.includes('@') || !['admin','staff','parent'].includes(role)) return fail('Email or role is invalid');
  if (role === 'parent') {
    const assigned = deviceId && await env.DB.prepare('SELECT id FROM devices WHERE id=? AND school_id=?').bind(deviceId, schoolId).first();
    if (!assigned) return fail('A parent invitation must be assigned to a classroom device');
  }
  const token = randomToken(32);
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO invitations(id,token_hash,school_id,email,role,device_id,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,await sha256(token),schoolId,email,role,deviceId||null,user.id,now,now+604800).run();
  return json({ url: `${new URL(request.url).origin}/portal?invite=${encodeURIComponent(token)}`, expiresAt: now + 604800 }, 201);
}

async function acceptInvitation(request: Request, env: Env, user: SessionUser): Promise<Response> {
  const body = await readBody(request);
  const tokenHash = await sha256(text(body.token, 200));
  const now = Math.floor(Date.now() / 1000);
  const invite = await env.DB.prepare('SELECT id,school_id,email,role,device_id FROM invitations WHERE token_hash=? AND accepted_at IS NULL AND expires_at>?').bind(tokenHash,now).first<{id:string;school_id:string;email:string;role:string;device_id:string|null}>();
  if (!invite || invite.email.toLowerCase() !== user.email.toLowerCase()) return fail('Invitation is invalid, expired, or belongs to another account', 403);
  const statements = [env.DB.prepare(`INSERT INTO memberships(school_id,user_id,role,created_at) VALUES(?,?,?,?) ON CONFLICT(school_id,user_id) DO UPDATE SET role=excluded.role`).bind(invite.school_id,user.id,invite.role,now),env.DB.prepare('UPDATE invitations SET accepted_at=? WHERE id=?').bind(now,invite.id)];
  if (invite.device_id) statements.push(env.DB.prepare(`INSERT INTO device_access(device_id,user_id,access_level,created_at) VALUES(?,?,'view',?) ON CONFLICT(device_id,user_id) DO UPDATE SET access_level='view'`).bind(invite.device_id,user.id,now));
  await env.DB.batch(statements);
  return json({ accepted: true });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === 'GET' && path === '/') {
    return Response.redirect('https://edusense-ai-schools.ojas-premt2.chatgpt.site/', 302);
  }
  if (request.method === 'GET' && path === '/portal') {
    const nonce = randomToken(18);
    return new Response(renderApp(nonce), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': `default-src 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data: https:; base-uri 'none'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'`, ...securityHeaders } });
  }
  const devicePageMatch = path.match(/^\/device\/([^/]+)$/);
  if (request.method === 'GET' && devicePageMatch) {
    const nonce = randomToken(18);
    const deviceId = decodeURIComponent(devicePageMatch[1]);
    return new Response(renderDeviceDashboard(nonce, deviceId), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': `default-src 'self'; style-src 'nonce-${nonce}' 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'`, ...securityHeaders } });
  }
  if (request.method === 'GET' && path === '/api/config') return json({ name: env.APP_NAME, providers: { google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) } });
  const authMatch = path.match(/^\/auth\/(google)\/(start|callback)$/);
  if (request.method === 'GET' && authMatch) return authMatch[2] === 'start' ? oauthStart(request, env, authMatch[1]) : oauthCallback(request, env, authMatch[1]);
  if (request.method === 'POST' && path === '/api/device/enroll') return enrollDevice(request, env);
  if (request.method === 'POST' && path === '/api/device/telemetry') return ingestTelemetry(request, env);
  const authenticated = await requireUser(request, env);
  if (authenticated instanceof Response) return authenticated;
  if (request.method === 'GET' && path === '/api/me') return json({ user: { id: authenticated.id, email: authenticated.email, displayName: authenticated.display_name, avatarUrl: authenticated.avatar_url }, schools: await schoolsForUser(env, authenticated.id) });
  if (request.method === 'POST' && path === '/api/logout') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(authenticated.session_hash).run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(SESSION_COOKIE, '', 1) });
  }
  if (request.method === 'POST' && path === '/api/schools') return createSchool(request, env, authenticated);
  if (request.method === 'POST' && path === '/api/enrollment-tokens') return createEnrollmentToken(request, env, authenticated);
  if (request.method === 'GET' && path === '/api/devices') return listDevices(env, authenticated);
  const historyMatch = path.match(/^\/api\/devices\/([^/]+)\/history$/);
  if (request.method === 'GET' && historyMatch) return deviceHistory(request, env, authenticated, decodeURIComponent(historyMatch[1]));
  if (request.method === 'POST' && path === '/api/invitations') return createInvitation(request, env, authenticated);
  if (request.method === 'POST' && path === '/api/invitations/accept') return acceptInvitation(request, env, authenticated);
  return fail('Not found', 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await route(request, env); }
    catch (error) {
      console.error('request_failed', { path: new URL(request.url).pathname, message: error instanceof Error ? error.message : String(error) });
      return fail('The service could not complete this request', 500);
    }
  },
};
