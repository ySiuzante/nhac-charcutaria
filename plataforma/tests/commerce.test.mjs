import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

process.env.NHAC_DB_PATH = ':memory:';
const { db } = await import('../database.mjs');
const {
  changeCart, checkout, demoProducts, getCart, orders, products, requestWholesale,
  setWholesaleApproval, updateOrder, updatePrices,
} = await import('../commerce.mjs');

test('pedidos preservam preço, estoque e isolamento entre clientes', () => {
  const addUser = db.prepare("INSERT INTO users(id,email,name,password_hash,role) VALUES(?,?,?,'test','CUSTOMER')");
  addUser.run('buyer', 'comprador@example.test', 'Comprador');
  addUser.run('other', 'outro@example.test', 'Outro');
  db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?)').run(...demoProducts[0]);
  const productId = demoProducts[0][0];

  assert.equal(products(false)[0].wholesale_cents, undefined);
  assert.throws(() => getCart('buyer', 'wholesale'), { status: 403 });
  assert.equal(requestWholesale('buyer', 'Empório Exemplo').approved, 0);
  setWholesaleApproval('admin', 'buyer', true);
  assert.throws(() => changeCart('buyer', { channel: 'wholesale', productId, quantity: 5 }), { status: 409 });
  const cart = changeCart('buyer', { channel: 'wholesale', productId, quantity: 6, unit_cents: 1 });
  assert.equal(cart.total_cents, 6 * 1890);
  assert.equal(getCart('other', 'retail').items.length, 0);

  const request = { channel: 'wholesale', requestId: randomUUID() };
  const order = checkout('buyer', request);
  assert.equal(checkout('buyer', request).id, order.id);
  assert.equal(orders('buyer')[0].total_cents, 6 * 1890);
  assert.equal(orders('other').length, 0);
  assert.equal(products(false)[0].stock, 36);
  assert.equal(getCart('buyer', 'wholesale').items.length, 0);

  changeCart('other', { channel: 'retail', productId, quantity: 36 });
  changeCart('buyer', { channel: 'retail', productId, quantity: 36 });
  checkout('other', { channel: 'retail', requestId: randomUUID() });
  assert.throws(() => checkout('buyer', { channel: 'retail', requestId: randomUUID() }), { status: 409 });
  assert.equal(orders('buyer').length, 1);
  assert.equal(getCart('buyer', 'retail').items.length, 1);

  updateOrder('admin', order.id, 'preparing');
  updateOrder('admin', order.id, 'cancelled');
  updateOrder('admin', order.id, 'cancelled');
  assert.equal(products(false)[0].stock, 6);
  updatePrices('admin', { productId, retail_cents: 2990, wholesale_cents: 2190 });
  assert.equal(getCart('buyer', 'retail').total_cents, 36 * 2990);
  assert.equal(orders('buyer')[0].total_cents, 6 * 1890);
  assert.throws(() => updateOrder('admin', order.id, 'ready'), { status: 409 });
  setWholesaleApproval('admin', 'buyer', false);
  assert.throws(() => getCart('buyer', 'wholesale'), { status: 403 });
});
