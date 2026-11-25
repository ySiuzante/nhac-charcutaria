import { createInterface } from 'node:readline/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { db } from './database.mjs';
import { base32, encryptSecret, getEncryptionKey, hashPassword, normalizeEmail, totpCounter, validEmail, validPassword } from './security.mjs';

if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Execute a configuração em um terminal interativo.');
const key = getEncryptionKey();
if (db.prepare("SELECT 1 FROM users WHERE role='MAIN' LIMIT 1").get()) throw new Error('A configuração inicial já foi concluída.');
let muted = false;
const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
output.isTTY = true;
output.columns = process.stdout.columns;
const readline = createInterface({ input: process.stdin, output, terminal: true });
let closing = false;
readline.on('error', error => { if (!closing || error.code !== 'EPERM') throw error; });
async function secretQuestion(prompt) {
  process.stdout.write(prompt);
  muted = true;
  try {
    return await readline.question('');
  } finally { muted = false; process.stdout.write('\n'); }
}
try {
  const name = (await readline.question('Nome do administrador: ')).trim();
  const email = normalizeEmail(await readline.question('E-mail do administrador: '));
  if (!name || name.length > 120 || !validEmail(email)) throw new Error('Nome ou e-mail inválido.');
  const password = await secretQuestion('Senha (mínimo de 12 caracteres): ');
  const repeat = await secretQuestion('Repita a senha: ');
  if (!validPassword(password) || password !== repeat) throw new Error('Senhas inválidas ou diferentes.');
  const secret = base32(randomBytes(20));
  process.stdout.write(`Adicione esta chave ao seu aplicativo autenticador: ${secret}\n`);
  const code = await secretQuestion('Código de seis dígitos: ');
  const counter = totpCounter(secret, code);
  if (counter === null) throw new Error('Código inválido. Nenhuma conta foi criada.');
  const hash = await hashPassword(password);
  const id = randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare("SELECT 1 FROM users WHERE role='MAIN' LIMIT 1").get()) throw new Error('A configuração inicial já foi concluída.');
    db.prepare('INSERT INTO users(id,email,name,password_hash,role,totp_encrypted,last_totp_counter) VALUES(?,?,?,?,?,?,?)')
      .run(id, email, name, hash, 'MAIN', encryptSecret(secret, key), counter);
    db.prepare('INSERT INTO audit_log(actor_id,action,target_id) VALUES(?,?,?)').run(id, 'bootstrap_main', id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  process.stdout.write('Administrador principal criado. Guarde a chave criptográfica em local seguro.\n');
} finally { closing = true; readline.close(); process.stdin.pause(); process.stdin.unref?.(); db.close(); }
