import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { encryptSecret, hashPassword, totp, totpCounter, verifyPassword } from '../security.mjs';

const root = resolve(import.meta.dirname, '..');
const temp = mkdtempSync(join(tmpdir(), 'nhac-test-'));
const dbPath = join(temp, 'test.sqlite');
const key = Buffer.alloc(32, 42);
const secret = 'JBSWY3DPEHPK3PXP';
const port = 39183;
let child;

test('segurança, sessões, acesso administrativo e integridade MAIN', async t => {
  process.env.NHAC_DB_PATH = dbPath;
  const { db } = await import('../database.mjs');
  const passwordHash = await hashPassword('uma senha longa para teste');
  assert.equal(await verifyPassword('uma senha longa para teste', passwordHash), true);
  assert.equal(await verifyPassword('senha incorreta', passwordHash), false);
  assert.equal(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1), '287082');
  const code = totp(secret);
  const count = totpCounter(secret, code);
  assert.ok(count !== null);
  assert.equal(totpCounter(secret, code, count), null);
  db.prepare("INSERT INTO users(id,email,name,password_hash,role,totp_encrypted) VALUES(?,?,?,?,?,?)")
    .run('main1', 'main@example.test', 'Main', passwordHash, 'MAIN', encryptSecret(secret, key));
  db.prepare("INSERT INTO users(id,email,name,password_hash,role) VALUES(?,?,?,?,?)")
    .run('customer1', 'customer@example.test', 'Cliente', passwordHash, 'CUSTOMER');
  assert.throws(() => db.prepare('UPDATE users SET active=0 WHERE id=?').run('main1'), /last active MAIN/);
  assert.throws(() => db.prepare('DELETE FROM users WHERE id=?').run('main1'), /last active MAIN/);
  db.close();

  child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, NHAC_DB_PATH: dbPath, NHAC_TOTP_KEY: key.toString('hex'), PORT: String(port) }, stdio: 'pipe' });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await exited;
    }
    rmSync(temp, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i=0; i<50; i++) { try { await fetch(base + '/api/auth/me'); break; } catch { await delay(100); } }
  const api = (path, options={}) => fetch(base + path, { ...options, headers: { Origin: base, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  assert.equal((await api('/api/admin/users')).status, 401);
  assert.equal((await api('/api/auth/register', { method:'POST', body:'{}' })).status, 501);
  assert.equal((await api('/api/auth/login', { method:'POST', headers:{Origin:'https://evil.test'}, body:'{}' })).status, 403);
  const customer = await api('/api/auth/login', {method:'POST', body:JSON.stringify({email:'customer@example.test',password:'uma senha longa para teste'})});
  assert.equal(customer.status, 200);
  const customerCookie = customer.headers.get('set-cookie').split(';')[0];
  assert.equal((await api('/api/admin/users', {headers:{Cookie:customerCookie}})).status, 403);
  const main = await api('/api/auth/login', {method:'POST',body:JSON.stringify({email:'main@example.test',password:'uma senha longa para teste',code:totp(secret)})});
  assert.equal(main.status, 200);
  assert.match(main.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const mainCookie = main.headers.get('set-cookie').split(';')[0];
  const mainData = await main.json();
  assert.equal(mainData.user.role, 'MAIN');
  assert.equal((await api('/api/admin/users',{headers:{Cookie:mainCookie}})).status, 200);
  assert.equal((await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:'main@example.test',password:'uma senha longa para teste',code:totp(secret)})})).status, 401);
  assert.equal((await api('/api/auth/logout',{method:'POST',headers:{Cookie:mainCookie}})).status,403);
  assert.equal((await api('/api/auth/logout',{method:'POST',headers:{Cookie:mainCookie,'X-CSRF-Token':mainData.csrfToken}})).status,200);
  assert.equal((await api('/api/auth/me',{headers:{Cookie:mainCookie}})).status,401);
});
