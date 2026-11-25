import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { base32, encryptSecret, hashPassword, totp } from './security.mjs';

if (process.env.NODE_ENV === 'production') throw new Error('Use o ambiente de testes em desenvolvimento.');

const key = randomBytes(32);
const secret = base32(randomBytes(20));
const accounts = [
  { id: randomUUID(), name: 'Administrador de teste', email: 'admin@nhac.example', role: 'MAIN', password: randomBytes(15).toString('base64url') },
  { id: randomUUID(), name: 'Cliente de teste', email: 'cliente@nhac.example', role: 'CUSTOMER', password: randomBytes(15).toString('base64url') },
];
const directory = mkdtempSync(join(tmpdir(), 'nhac-demo-'));
process.env.NHAC_DB_PATH = join(directory, 'demo.sqlite');
const { db } = await import('./database.mjs');
const { demoProducts } = await import('./commerce.mjs');
const addUser = db.prepare('INSERT INTO users(id,email,name,password_hash,role,totp_encrypted) VALUES(?,?,?,?,?,?)');
for (const account of accounts) {
  addUser.run(account.id, account.email, account.name, await hashPassword(account.password), account.role,
    account.role === 'MAIN' ? encryptSecret(secret, key) : null);
}
db.prepare('INSERT INTO wholesale_accounts(user_id,company,approved) VALUES(?,?,1)').run(accounts[1].id, 'Comércio demonstrativo');
const addProduct = db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?)');
for (const product of demoProducts) addProduct.run(...product);
db.close();

const server = spawn(process.execPath, ['server.mjs'], {
  cwd: import.meta.dirname,
  env: { ...process.env, NHAC_TOTP_KEY: key.toString('hex'), NHAC_DEMO: '1' },
  stdio: ['ignore', 'inherit', 'inherit'],
});

console.log('\nContas geradas para esta sessão de testes');
for (const account of accounts) console.log(`${account.name}: ${account.email} / ${account.password}`);
console.log(`Chave para cadastrar o MAIN no autenticador: ${secret}`);
console.log(`Código atual: ${totp(secret)}. Consulte o autenticador após a troca do código.\n`);

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill());
server.once('exit', (code) => {
  rmSync(directory, { recursive: true, force: true });
  process.exitCode = code || 0;
});
