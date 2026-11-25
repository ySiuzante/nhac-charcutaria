import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './database.mjs';
import {
  approvedWholesale, changeCart, checkout, CommerceError, getCart, orders, products, requestWholesale,
  setWholesaleApproval, updateOrder, wholesaleAccount, wholesaleRequests,
} from './commerce.mjs';
import { decryptSecret, getEncryptionKey, hashToken, normalizeEmail, token, totpCounter, validEmail, verifyPassword } from './security.mjs';

// Development server only. Internet deployment requires HTTPS, managed identity,
// centralized rate limits, recovery, monitoring and a production database.
if (process.env.NODE_ENV === 'production') throw new Error('Servidor local não é configurado para produção.');
const key = getEncryptionKey();
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT inválida.');
const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), 'public');
const assets = resolve(publicDir, '..', '..', 'assets');
const demo = process.env.NHAC_DEMO === '1';
const codespace = process.env.CODESPACE_NAME;
const forwardedOrigin = codespace && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN === 'app.github.dev'
  ? `https://${codespace}-${port}.app.github.dev`
  : null;
const attempts = new Map();
const sessionLifetime = 8 * 60 * 60 * 1000;
const cookieName = 'nhac_session';
const allowedTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function cookie(req) {
  return (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
}
function session(req) {
  const raw = cookie(req);
  if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  return db.prepare(`SELECT s.token_hash,s.csrf_hash,s.expires_at,u.id,u.name,u.email,u.role
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).get(hashToken(raw), Date.now());
}
function safeOrigin(req) {
  const origin = req.headers.origin;
  return origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}` || origin === forwardedOrigin;
}
async function jsonBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new Error('content_type');
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 8192) throw new Error('too_large');
  }
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_body');
  return value;
}
function tooManyAttempts(ip) {
  const now = Date.now();
  for (const [address, record] of attempts) if (record.until <= now) attempts.delete(address);
  const record = attempts.get(ip) || { count: 0, until: now + 15 * 60 * 1000 };
  record.count += 1;
  attempts.set(ip, record);
  return record.count > 10;
}
function csrfValid(req, current) {
  const value = req.headers['x-csrf-token'];
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) && hashToken(value) === current.csrf_hash;
}
async function route(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && !safeOrigin(req)) return send(res, 403, { error: 'Origem não autorizada.' });
    if (req.method === 'GET' && url.pathname === '/api/shop/products') {
      const current = session(req);
      const wholesale = current?.role === 'CUSTOMER' && approvedWholesale(current.id);
      return send(res, 200, { products: products(wholesale), wholesale, demo, signedIn: !!current });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/register') return send(res, 501, { error: 'Cadastro indisponível até a configuração do serviço de e-mail.' });
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      if (tooManyAttempts(req.socket.remoteAddress)) return send(res, 429, { error: 'Muitas tentativas. Aguarde antes de tentar novamente.' });
      let body;
      try { body = await jsonBody(req); } catch { return send(res, 400, { error: 'Dados inválidos.' }); }
      const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
      const user = validEmail(email) ? db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email) : null;
      if (!user || !await verifyPassword(body.password, user.password_hash)) return send(res, 401, { error: 'Credenciais inválidas.' });
      let counter = null;
      if (user.role === 'MAIN') {
        try { counter = totpCounter(decryptSecret(user.totp_encrypted, key), body.code, user.last_totp_counter); } catch { return send(res, 500, { error: 'Não foi possível validar o autenticador.' }); }
        if (counter === null) return send(res, 401, { error: 'Credenciais inválidas.' });
      }
      const raw = token(), csrf = token(), now = Date.now();
      db.exec('BEGIN IMMEDIATE');
      try {
        if (counter !== null) {
          const updated = db.prepare('UPDATE users SET last_totp_counter=? WHERE id=? AND last_totp_counter<? AND active=1').run(counter, user.id, counter);
          if (!updated.changes) { db.exec('ROLLBACK'); return send(res, 401, { error: 'Credenciais inválidas.' }); }
        }
        db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
        db.prepare('INSERT INTO sessions(token_hash,user_id,csrf_hash,expires_at,created_at) VALUES(?,?,?,?,?)').run(hashToken(raw), user.id, hashToken(csrf), now + sessionLifetime, now);
        db.prepare('INSERT INTO audit_log(actor_id,action,target_id) VALUES(?,?,?)').run(user.id, 'login', user.id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      const secure = req.headers.origin === forwardedOrigin ? '; Secure' : '';
      res.setHeader('Set-Cookie', `${cookieName}=${raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionLifetime / 1000}${secure}`);
      return send(res, 200, { user: { id: user.id, name: user.name, email: user.email, role: user.role }, csrfToken: csrf });
    }
    const current = session(req);
    if (!current) return send(res, 401, { error: 'Faça login para continuar.' });
    if (req.method === 'GET' && url.pathname === '/api/auth/me') {
      const csrf = token();
      db.prepare('UPDATE sessions SET csrf_hash=? WHERE token_hash=?').run(hashToken(csrf), current.token_hash);
      return send(res, 200, { user: { id: current.id, name: current.name, email: current.email, role: current.role }, csrfToken: csrf });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      if (!csrfValid(req, current)) return send(res, 403, { error: 'Sessão inválida. Atualize a página.' });
      db.prepare('DELETE FROM sessions WHERE token_hash=?').run(current.token_hash);
      res.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
      return send(res, 200, { ok: true });
    }
    const pathname = url.pathname;
    if (pathname.startsWith('/api/shop/')) {
      if (current.role !== 'CUSTOMER') return send(res, 403, { error: 'Entre com uma conta de cliente para fazer pedidos.' });
      if (req.method === 'GET' && pathname === '/api/shop/orders') return send(res, 200, { orders: orders(current.id) });
      if (req.method === 'GET' && pathname === '/api/shop/wholesale') return send(res, 200, { account: wholesaleAccount(current.id) });
      if (req.method === 'GET' && pathname === '/api/shop/cart') {
        return send(res, 200, getCart(current.id, url.searchParams.get('channel') || 'retail'));
      }
      if (req.method === 'POST' && ['/api/shop/cart', '/api/shop/checkout', '/api/shop/wholesale'].includes(pathname)) {
        if (!csrfValid(req, current)) return send(res, 403, { error: 'Sessão inválida. Atualize a página.' });
        let body;
        try { body = await jsonBody(req); } catch { return send(res, 400, { error: 'Dados inválidos.' }); }
        if (pathname.endsWith('/cart')) return send(res, 200, changeCart(current.id, body));
        if (pathname.endsWith('/wholesale')) return send(res, 200, { account: requestWholesale(current.id, body.company) });
        if (!demo) return send(res, 503, { error: 'O checkout está disponível no ambiente de testes.' });
        return send(res, 200, checkout(current.id, body));
      }
    }
    if (url.pathname.startsWith('/api/admin/')) {
      if (current.role !== 'MAIN') return send(res, 403, { error: 'Acesso não autorizado.' });
      if (req.method === 'GET' && url.pathname === '/api/admin/users') {
        return send(res, 200, { users: db.prepare('SELECT id,name,email,role,active,created_at FROM users ORDER BY name').all() });
      }
      if (req.method === 'GET' && pathname === '/api/admin/orders') {
        return send(res, 200, { orders: orders(null), products: products(true), wholesale: wholesaleRequests() });
      }
      if (req.method === 'POST' && ['/api/admin/orders', '/api/admin/wholesale'].includes(pathname)) {
        if (!csrfValid(req, current)) return send(res, 403, { error: 'Sessão inválida. Atualize a página.' });
        let body;
        try { body = await jsonBody(req); } catch { return send(res, 400, { error: 'Dados inválidos.' }); }
        if (pathname.endsWith('/wholesale')) setWholesaleApproval(current.id, body.userId, body.approved);
        else {
          if (typeof body.id !== 'string') return send(res, 400, { error: 'Pedido inválido.' });
          updateOrder(current.id, body.id, body.status);
        }
        return send(res, 200, { ok: true });
      }
    }
    return send(res, 404, { error: 'Recurso não encontrado.' });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Método não permitido.' });
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return send(res, 400, { error: 'Endereço inválido.' }); }
  const isAsset = /^\/assets\/[a-z0-9-]+\.(webp|png|ttf)$/i.test(pathname);
  const directory = isAsset ? assets : publicDir;
  const file = resolve(directory, isAsset ? pathname.slice(8) : '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(directory + sep)) return send(res, 404, { error: 'Recurso não encontrado.' });
  const type = allowedTypes[extname(file).toLowerCase()];
  if (!type) return send(res, 404, { error: 'Recurso não encontrado.' });
  try {
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { return send(res, 404, { error: 'Recurso não encontrado.' }); }
}
const server = http.createServer((req, res) => {
  route(req, res).catch(error => {
    if (error instanceof CommerceError && !res.headersSent) return send(res, error.status, { error: error.message });
    console.error('Falha interna:', error.message);
    if (!res.headersSent) send(res, 500, { error: 'Não foi possível concluir a operação.' }); else res.end();
  });
});
server.listen(port, '127.0.0.1', () => console.log(`Nhac disponível em http://127.0.0.1:${port}`));
