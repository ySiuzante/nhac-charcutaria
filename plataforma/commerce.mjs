import { randomUUID } from 'node:crypto';
import { db } from './database.mjs';

db.exec(`
  BEGIN IMMEDIATE;
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
    description TEXT NOT NULL, image TEXT NOT NULL, package TEXT NOT NULL,
    retail_cents INTEGER NOT NULL CHECK(retail_cents > 0),
    wholesale_cents INTEGER NOT NULL CHECK(wholesale_cents > 0),
    wholesale_minimum INTEGER NOT NULL CHECK(wholesale_minimum BETWEEN 1 AND 999),
    stock INTEGER NOT NULL CHECK(stock >= 0)
  );
  CREATE TABLE IF NOT EXISTS wholesale_accounts (
    user_id TEXT PRIMARY KEY REFERENCES users(id), company TEXT NOT NULL,
    approved INTEGER NOT NULL DEFAULT 0 CHECK(approved IN (0,1))
  );
  CREATE TABLE IF NOT EXISTS cart_items (
    user_id TEXT NOT NULL REFERENCES users(id), channel TEXT NOT NULL CHECK(channel IN ('retail','wholesale')),
    product_id TEXT NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 999),
    PRIMARY KEY(user_id, channel, product_id)
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
    channel TEXT NOT NULL CHECK(channel IN ('retail','wholesale')),
    total_cents INTEGER NOT NULL CHECK(total_cents > 0),
    status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','preparing','ready','cancelled')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, request_id)
  );
  CREATE TABLE IF NOT EXISTS order_items (
    order_id TEXT NOT NULL REFERENCES orders(id), product_id TEXT NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0),
    unit_cents INTEGER NOT NULL CHECK(unit_cents > 0), PRIMARY KEY(order_id, product_id)
  );
  CREATE INDEX IF NOT EXISTS orders_customer_date ON orders(user_id, created_at DESC);
  INSERT OR IGNORE INTO schema_migrations(version) VALUES(2);
  COMMIT;
`);

export const demoProducts = [
  ['LING-TOSC', 'Linguiça Toscana', 'Linguiças', 'Alho, vinho branco e pimenta-do-reino.', '/assets/linguicas.webp', '400 g', 2490, 1890, 6, 42],
  ['LING-COAL', 'Linguiça de Coalho e Melaço', 'Linguiças', 'Queijo coalho com toque agridoce de melaço.', '/assets/linguicas.webp', '400 g', 2890, 2190, 6, 30],
  ['SALA-ITAL', 'Salame Italiano', 'Salames', 'Vinho e pimenta em uma receita para a tábua.', '/assets/salames.webp', '200 g', 2990, 2290, 6, 36],
  ['SALA-PEPP', 'Pepperoni', 'Salames', 'Temperos marcantes para pizzas e sanduíches.', '/assets/salames.webp', '200 g', 2790, 2090, 6, 25],
  ['BACN-FATI', 'Bacon Fatiado', 'Bacon', 'Fatias de bacon preparadas para receitas e sanduíches.', '/assets/defumados.webp', '250 g', 2390, 1790, 6, 48],
  ['BACN-CUBO', 'Bacon em Cubos', 'Bacon', 'Cubos para dar sabor a molhos e acompanhamentos.', '/assets/defumados.webp', '250 g', 2190, 1690, 6, 44],
];

export class CommerceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function transaction(operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function approvedWholesale(userId) {
  return db.prepare('SELECT approved FROM wholesale_accounts WHERE user_id=?').get(userId)?.approved === 1;
}

export function wholesaleAccount(userId) {
  return db.prepare('SELECT company,approved FROM wholesale_accounts WHERE user_id=?').get(userId) || null;
}

export function requestWholesale(userId, company) {
  const name = typeof company === 'string' ? company.trim() : '';
  if (name.length < 2 || name.length > 120) throw new CommerceError(400, 'Informe o nome da empresa.');
  db.prepare(`INSERT INTO wholesale_accounts(user_id,company) VALUES(?,?)
    ON CONFLICT(user_id) DO UPDATE SET company=excluded.company WHERE approved=0`).run(userId, name);
  return wholesaleAccount(userId);
}

export function wholesaleRequests() {
  return db.prepare(`SELECT w.user_id,w.company,w.approved,u.name
    FROM wholesale_accounts w JOIN users u ON u.id=w.user_id ORDER BY w.approved,w.company`).all();
}

export function setWholesaleApproval(actorId, userId, approved) {
  if (typeof userId !== 'string' || typeof approved !== 'boolean') throw new CommerceError(400, 'Informe a decisão de aprovação.');
  return transaction(() => {
    const account = wholesaleAccount(userId);
    if (!account) throw new CommerceError(404, 'Solicitação não encontrada.');
    if (Boolean(account.approved) === approved) return;
    db.prepare('UPDATE wholesale_accounts SET approved=? WHERE user_id=?').run(Number(approved), userId);
    db.prepare('INSERT INTO audit_log(actor_id,action,target_id) VALUES(?,?,?)')
      .run(actorId, approved ? 'wholesale_approve' : 'wholesale_revoke', userId);
  });
}

function validateChannel(userId, channel) {
  if (channel === 'retail') return;
  if (channel !== 'wholesale') throw new CommerceError(400, 'Modalidade inválida.');
  if (!approvedWholesale(userId)) throw new CommerceError(403, 'Atacado disponível para contas aprovadas.');
}

export function products(includeWholesale) {
  const items = db.prepare('SELECT * FROM products ORDER BY category, name').all();
  if (includeWholesale) return items;
  return items.map(({ wholesale_cents, wholesale_minimum, ...publicFields }) => publicFields);
}

export function getCart(userId, channel) {
  validateChannel(userId, channel);
  const items = db.prepare(`
    SELECT p.id,p.name,p.stock,c.quantity,
      CASE c.channel WHEN 'wholesale' THEN p.wholesale_cents ELSE p.retail_cents END AS unit_cents,
      CASE c.channel WHEN 'wholesale' THEN p.wholesale_minimum ELSE 1 END AS minimum
    FROM cart_items c JOIN products p ON p.id=c.product_id
    WHERE c.user_id=? AND c.channel=? ORDER BY p.name`).all(userId, channel);
  return { items, total_cents: items.reduce((total, item) => total + item.unit_cents * item.quantity, 0) };
}

export function changeCart(userId, { channel, productId, quantity }) {
  validateChannel(userId, channel);
  if (typeof productId !== 'string' || !Number.isInteger(quantity) || quantity < 0 || quantity > 999) {
    throw new CommerceError(400, 'Informe uma quantidade válida.');
  }
  if (quantity === 0) {
    db.prepare('DELETE FROM cart_items WHERE user_id=? AND channel=? AND product_id=?').run(userId, channel, productId);
    return getCart(userId, channel);
  }
  const product = db.prepare('SELECT stock,wholesale_minimum FROM products WHERE id=?').get(productId);
  if (!product) throw new CommerceError(404, 'Produto indisponível.');
  const minimum = channel === 'wholesale' ? product.wholesale_minimum : 1;
  if (quantity < minimum || quantity > product.stock) {
    throw new CommerceError(409, `Quantidade disponível entre ${minimum} e o estoque de ${product.stock} unidades.`);
  }
  db.prepare(`INSERT INTO cart_items VALUES(?,?,?,?)
    ON CONFLICT(user_id,channel,product_id) DO UPDATE SET quantity=excluded.quantity`)
    .run(userId, channel, productId, quantity);
  return getCart(userId, channel);
}

export function checkout(userId, { channel, requestId }) {
  if (typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId)) {
    throw new CommerceError(400, 'Identificador de pedido inválido.');
  }
  return transaction(() => {
    validateChannel(userId, channel);
    const previous = db.prepare('SELECT id,channel,total_cents FROM orders WHERE user_id=? AND request_id=?').get(userId, requestId);
    if (previous) {
      if (previous.channel !== channel) throw new CommerceError(409, 'Identificador já utilizado para outra modalidade.');
      return previous;
    }
    const { items, total_cents } = getCart(userId, channel);
    if (!items.length) throw new CommerceError(409, 'Adicione produtos ao carrinho.');
    const id = randomUUID();
    db.prepare('INSERT INTO orders(id,user_id,request_id,channel,total_cents) VALUES(?,?,?,?,?)')
      .run(id, userId, requestId, channel, total_cents);
    for (const item of items) {
      const movement = db.prepare('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?')
        .run(item.quantity, item.id, item.quantity);
      if (!movement.changes || item.quantity < item.minimum) throw new CommerceError(409, `Revise a quantidade de ${item.name}.`);
      db.prepare('INSERT INTO order_items VALUES(?,?,?,?,?)').run(id, item.id, item.name, item.quantity, item.unit_cents);
    }
    db.prepare('DELETE FROM cart_items WHERE user_id=? AND channel=?').run(userId, channel);
    return { id, channel, total_cents };
  });
}

export function orders(userId) {
  const query = db.prepare(`SELECT o.id,o.status,o.channel,o.total_cents,o.created_at,
    u.name AS customer FROM orders o JOIN users u ON u.id=o.user_id
    WHERE (? IS NULL OR o.user_id=?) ORDER BY o.created_at DESC, o.rowid DESC LIMIT 100`);
  const items = db.prepare('SELECT product_name,quantity,unit_cents FROM order_items WHERE order_id=? ORDER BY product_name');
  return query.all(userId, userId).map(order => ({ ...order, items: items.all(order.id) }));
}

export function updateOrder(actorId, orderId, status) {
  const transitions = { received: ['preparing','cancelled'], preparing: ['ready','cancelled'], ready: [], cancelled: [] };
  return transaction(() => {
    const order = db.prepare('SELECT status FROM orders WHERE id=?').get(orderId);
    if (!order) throw new CommerceError(404, 'Pedido não encontrado.');
    if (order.status === status) return;
    if (!transitions[order.status].includes(status)) throw new CommerceError(409, 'Alteração de status indisponível.');
    db.prepare('UPDATE orders SET status=? WHERE id=?').run(status, orderId);
    if (status === 'cancelled') {
      const items = db.prepare('SELECT product_id,quantity FROM order_items WHERE order_id=?').all(orderId);
      const replenish = db.prepare('UPDATE products SET stock=stock+? WHERE id=?');
      for (const item of items) replenish.run(item.quantity, item.product_id);
    }
    db.prepare('INSERT INTO audit_log(actor_id,action,target_id) VALUES(?,?,?)').run(actorId, `order_${status}`, orderId);
  });
}
