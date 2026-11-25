CREATE SCHEMA IF NOT EXISTS nhac;
REVOKE ALL ON SCHEMA nhac FROM PUBLIC, anon, authenticated;
CREATE TABLE nhac.administrators (email text PRIMARY KEY CHECK(email=lower(email)));
CREATE TABLE nhac.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, full_name text NOT NULL, email text NOT NULL);
CREATE TABLE nhac.products (
  id text PRIMARY KEY, name text NOT NULL, category text NOT NULL, description text NOT NULL,
  image text NOT NULL, package text NOT NULL, retail_cents integer NOT NULL CHECK (retail_cents BETWEEN 1 AND 99999999),
  wholesale_cents integer NOT NULL CHECK (wholesale_cents BETWEEN 1 AND 99999999),
  wholesale_minimum integer NOT NULL CHECK (wholesale_minimum BETWEEN 1 AND 999),
  stock integer NOT NULL CHECK (stock >= 0)
);
CREATE TABLE nhac.wholesale (user_id uuid PRIMARY KEY REFERENCES nhac.profiles(id), company text NOT NULL, approved boolean NOT NULL DEFAULT false);
CREATE TABLE nhac.cart (
  user_id uuid REFERENCES nhac.profiles(id), channel text CHECK(channel IN ('retail','wholesale')),
  product_id text REFERENCES nhac.products(id), quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 999),
  PRIMARY KEY(user_id,channel,product_id)
);
CREATE TABLE nhac.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES nhac.profiles(id),
  request_id uuid NOT NULL, channel text NOT NULL CHECK(channel IN ('retail','wholesale')),
  total_cents bigint NOT NULL CHECK(total_cents>0),
  status text NOT NULL DEFAULT 'received' CHECK(status IN ('received','preparing','ready','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,request_id)
);
CREATE INDEX ON nhac.orders(user_id,created_at DESC);
CREATE TABLE nhac.order_items (
  order_id uuid REFERENCES nhac.orders(id), product_id text REFERENCES nhac.products(id),
  product_name text NOT NULL, quantity integer NOT NULL CHECK(quantity>0),
  unit_cents integer NOT NULL CHECK(unit_cents>0), PRIMARY KEY(order_id,product_id)
);
CREATE TABLE nhac.audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor uuid NOT NULL, action text NOT NULL,
  target text NOT NULL, data jsonb, created_at timestamptz DEFAULT now()
);
DO $$
DECLARE table_name text;
BEGIN
  FOR table_name IN SELECT tablename FROM pg_tables WHERE schemaname='nhac' LOOP
    EXECUTE format('ALTER TABLE nhac.%I ENABLE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;

CREATE FUNCTION nhac.cart_rows(viewer uuid, sales_channel text)
RETURNS TABLE(id text, name text, stock integer, quantity integer, unit_cents integer, minimum integer)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT p.id,p.name,p.stock,c.quantity,
    CASE WHEN sales_channel='wholesale' THEN p.wholesale_cents ELSE p.retail_cents END,
    CASE WHEN sales_channel='wholesale' THEN p.wholesale_minimum ELSE 1 END
  FROM nhac.cart c JOIN nhac.products p ON c.product_id=p.id
  WHERE c.user_id=viewer AND c.channel=sales_channel
$$;

CREATE FUNCTION nhac.dispatch(operation text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  viewer uuid := auth.uid();
  account_email text;
  display_name text;
  admin boolean;
  wholesale_access boolean;
  sales_channel text := coalesce(payload->>'channel','retail');
  item_id text := payload->>'productId';
  quantity_value integer;
  retail_value integer;
  wholesale_value integer;
  row_product nhac.products%ROWTYPE;
  order_row nhac.orders%ROWTYPE;
  request_key uuid;
  next_status text := payload->>'status';
  company_name text := trim(payload->>'company');
  total bigint;
  response jsonb;
BEGIN
  SELECT lower(u.email), left(coalesce(nullif(trim(u.raw_user_meta_data->>'name'),''),split_part(u.email,'@',1)),120)
    INTO account_email,display_name
    FROM auth.users u WHERE u.id=viewer AND u.email_confirmed_at IS NOT NULL;
  IF account_email IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Entre com um e-mail confirmado.'; END IF;
  SELECT EXISTS(SELECT 1 FROM nhac.administrators a WHERE a.email=account_email) INTO admin;
  IF operation='profile' THEN
    INSERT INTO nhac.profiles VALUES (viewer,display_name,account_email) ON CONFLICT(id) DO UPDATE
      SET full_name=excluded.full_name,email=excluded.email
      WHERE (profiles.full_name,profiles.email) IS DISTINCT FROM (excluded.full_name,excluded.email);
    RETURN jsonb_build_object('user',jsonb_build_object('id',viewer,'name',display_name,'email',account_email,
      'role',CASE WHEN admin THEN 'MAIN' ELSE 'CUSTOMER' END));
  END IF;
  IF admin AND coalesce(auth.jwt()->>'aal','') <> 'aal2' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Confirme o código do autenticador.';
  END IF;
  IF operation LIKE 'admin_%' AND NOT admin THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Acesso restrito à administração.';
  END IF;
  IF operation LIKE 'shop_%' AND admin AND operation <> 'shop_products' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Entre como cliente para usar a loja.';
  END IF;
  INSERT INTO nhac.profiles VALUES (viewer,display_name,account_email) ON CONFLICT(id) DO NOTHING;
  SELECT EXISTS(SELECT 1 FROM nhac.wholesale w WHERE w.user_id=viewer AND w.approved) INTO wholesale_access;

  IF operation='shop_products' THEN
    SELECT coalesce(jsonb_agg(
      CASE WHEN admin OR wholesale_access THEN to_jsonb(p)
      ELSE to_jsonb(p)-'wholesale_cents'-'wholesale_minimum' END ORDER BY p.category,p.name),'[]'::jsonb)
      INTO response FROM nhac.products p;
    RETURN jsonb_build_object('products',response,'wholesale',wholesale_access,'demo',true,'signedIn',true);
  END IF;
  IF operation='admin_users' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.full_name,'email',p.email,
      'role',CASE WHEN a.email IS NULL THEN 'CUSTOMER' ELSE 'MAIN' END,'active',true) ORDER BY p.full_name),'[]'::jsonb)
      INTO response FROM nhac.profiles p LEFT JOIN nhac.administrators a ON p.email=a.email;
    RETURN jsonb_build_object('users',response);
  END IF;
  IF operation='admin_prices' THEN
    retail_value := (payload->>'retail_cents')::integer;
    wholesale_value := (payload->>'wholesale_cents')::integer;
    IF retail_value IS NULL OR wholesale_value IS NULL OR retail_value NOT BETWEEN 1 AND 99999999
      OR wholesale_value NOT BETWEEN 1 AND 99999999 THEN RAISE EXCEPTION 'Informe preços válidos.'; END IF;
    SELECT * INTO row_product FROM nhac.products WHERE id=item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF;
    UPDATE nhac.products SET retail_cents=retail_value,wholesale_cents=wholesale_value WHERE id=item_id;
    INSERT INTO nhac.audit(actor,action,target,data) VALUES(viewer,'prices',item_id,jsonb_build_object(
      'retail_before',row_product.retail_cents,'retail_after',retail_value,
      'wholesale_before',row_product.wholesale_cents,'wholesale_after',wholesale_value));
    RETURN jsonb_build_object('ok',true);
  END IF;
  IF operation='shop_wholesale_request' THEN
    IF company_name IS NULL OR char_length(company_name) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'Informe o nome da empresa.'; END IF;
    INSERT INTO nhac.wholesale(user_id,company) VALUES(viewer,company_name)
    ON CONFLICT(user_id) DO UPDATE SET company=excluded.company WHERE NOT wholesale.approved;
  END IF;
  IF operation IN ('shop_wholesale','shop_wholesale_request') THEN
    SELECT to_jsonb(w)-'user_id' INTO response FROM nhac.wholesale w WHERE w.user_id=viewer;
    RETURN jsonb_build_object('account',response);
  END IF;
  IF operation='admin_wholesale' THEN
    UPDATE nhac.wholesale SET approved=(payload->>'approved')::boolean WHERE user_id=(payload->>'userId')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada.'; END IF;
    INSERT INTO nhac.audit(actor,action,target,data) VALUES(viewer,'wholesale',payload->>'userId',payload);
    RETURN jsonb_build_object('ok',true);
  END IF;
  IF operation IN ('shop_orders','admin_orders') THEN
    SELECT coalesce(jsonb_agg(to_jsonb(o) - 'user_id' - 'request_id' ORDER BY o.created_at DESC),'[]'::jsonb)
      INTO response FROM (
        SELECT o.*,p.full_name AS customer,
          (SELECT jsonb_agg(to_jsonb(i)-'order_id' ORDER BY product_name) FROM nhac.order_items i WHERE i.order_id=o.id) AS items
        FROM nhac.orders o JOIN nhac.profiles p ON p.id=o.user_id
        WHERE admin OR o.user_id=viewer ORDER BY o.created_at DESC LIMIT 100
      ) o;
    IF operation='admin_orders' THEN
      RETURN jsonb_build_object('orders',response,
        'products',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.name),'[]'::jsonb) FROM nhac.products p),
        'wholesale',(SELECT coalesce(jsonb_agg(to_jsonb(w)||jsonb_build_object('name',p.full_name)),'[]'::jsonb)
          FROM nhac.wholesale w JOIN nhac.profiles p ON p.id=w.user_id));
    END IF;
    RETURN jsonb_build_object('orders',response);
  END IF;
  IF operation='admin_order_status' THEN
    SELECT * INTO order_row FROM nhac.orders WHERE id=(payload->>'id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
    IF next_status=order_row.status THEN RETURN jsonb_build_object('ok',true); END IF;
    IF next_status IS NULL OR NOT (
      (order_row.status='received' AND next_status IN ('preparing','cancelled'))
      OR (order_row.status='preparing' AND next_status IN ('ready','cancelled'))
    ) THEN RAISE EXCEPTION 'Alteração de status indisponível.'; END IF;
    IF next_status='cancelled' THEN
      PERFORM p.id FROM nhac.products p JOIN nhac.order_items i ON i.product_id=p.id
        WHERE i.order_id=order_row.id ORDER BY p.id FOR UPDATE OF p;
      UPDATE nhac.products p SET stock=p.stock+i.quantity FROM nhac.order_items i
        WHERE i.order_id=order_row.id AND i.product_id=p.id;
    END IF;
    UPDATE nhac.orders SET status=next_status WHERE id=order_row.id;
    INSERT INTO nhac.audit(actor,action,target,data) VALUES(viewer,'order_status',order_row.id::text,jsonb_build_object('status',next_status));
    RETURN jsonb_build_object('ok',true);
  END IF;
  IF operation NOT IN ('shop_cart','shop_cart_change','shop_checkout') THEN RAISE EXCEPTION 'Operação indisponível.'; END IF;
  IF sales_channel NOT IN ('retail','wholesale') THEN RAISE EXCEPTION 'Modalidade inválida.'; END IF;
  IF sales_channel='wholesale' AND NOT wholesale_access THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Atacado disponível para contas aprovadas.';
  END IF;
  IF operation IN ('shop_cart_change','shop_checkout') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(viewer::text,0));
  END IF;
  IF operation='shop_cart_change' THEN
    quantity_value := (payload->>'quantity')::integer;
    IF quantity_value IS NULL OR quantity_value NOT BETWEEN 0 AND 999 THEN RAISE EXCEPTION 'Informe uma quantidade válida.'; END IF;
    IF quantity_value=0 THEN
      DELETE FROM nhac.cart WHERE user_id=viewer AND channel=sales_channel AND product_id=item_id;
    ELSE
      SELECT * INTO row_product FROM nhac.products WHERE id=item_id;
      IF NOT FOUND OR quantity_value>row_product.stock OR (sales_channel='wholesale' AND quantity_value<row_product.wholesale_minimum) THEN
        RAISE EXCEPTION 'Revise a quantidade ou o mínimo de atacado.';
      END IF;
      INSERT INTO nhac.cart VALUES(viewer,sales_channel,item_id,quantity_value)
      ON CONFLICT(user_id,channel,product_id) DO UPDATE SET quantity=excluded.quantity;
    END IF;
  END IF;
  IF operation='shop_checkout' THEN
    request_key := (payload->>'requestId')::uuid;
    IF request_key IS NULL THEN RAISE EXCEPTION 'Identificador de pedido obrigatório.'; END IF;
    SELECT * INTO order_row FROM nhac.orders WHERE user_id=viewer AND request_id=request_key;
    IF FOUND THEN
      IF order_row.channel<>sales_channel THEN RAISE EXCEPTION 'Identificador utilizado em outra modalidade.'; END IF;
      RETURN jsonb_build_object('id',order_row.id,'channel',order_row.channel,'total_cents',order_row.total_cents);
    END IF;
    PERFORM p.id FROM nhac.products p JOIN nhac.cart c ON c.product_id=p.id
      WHERE c.user_id=viewer AND c.channel=sales_channel ORDER BY p.id FOR UPDATE OF p;
    IF EXISTS(SELECT 1 FROM nhac.cart_rows(viewer,sales_channel) r WHERE r.quantity>r.stock OR r.quantity<r.minimum) THEN
      RAISE EXCEPTION 'Estoque ou quantidade mínima mudou. Revise o carrinho.';
    END IF;
    SELECT sum(r.quantity*r.unit_cents::bigint) INTO total FROM nhac.cart_rows(viewer,sales_channel) r;
    IF total IS NULL THEN RAISE EXCEPTION 'Adicione produtos ao carrinho.'; END IF;
    INSERT INTO nhac.orders(user_id,request_id,channel,total_cents)
      VALUES(viewer,request_key,sales_channel,total) RETURNING * INTO order_row;
    INSERT INTO nhac.order_items SELECT order_row.id,r.id,r.name,r.quantity,r.unit_cents FROM nhac.cart_rows(viewer,sales_channel) r;
    UPDATE nhac.products p SET stock=p.stock-c.quantity FROM nhac.cart c
      WHERE c.user_id=viewer AND c.channel=sales_channel AND c.product_id=p.id;
    DELETE FROM nhac.cart WHERE user_id=viewer AND channel=sales_channel;
    RETURN jsonb_build_object('id',order_row.id,'channel',sales_channel,'total_cents',total);
  END IF;
  SELECT jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.name),'[]'::jsonb),
    'total_cents',coalesce(sum(r.quantity*r.unit_cents::bigint),0)) INTO response
    FROM nhac.cart_rows(viewer,sales_channel) r;
  RETURN response;
END $$;

CREATE FUNCTION public.nhac_api(operation text, payload jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT nhac.dispatch(operation,payload) $$;
REVOKE ALL ON FUNCTION public.nhac_api(text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nhac.dispatch(text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nhac.cart_rows(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA nhac TO authenticated;
GRANT EXECUTE ON FUNCTION nhac.dispatch(text,jsonb),public.nhac_api(text,jsonb) TO authenticated;

INSERT INTO nhac.products VALUES
('LING-TOSC','Linguiça Toscana','Linguiças','Alho, vinho branco e pimenta-do-reino.','/assets/linguicas.webp','400 g',2490,1890,6,42),
('LING-COAL','Linguiça de Coalho e Melaço','Linguiças','Queijo coalho com toque agridoce de melaço.','/assets/linguicas.webp','400 g',2890,2190,6,30),
('SALA-ITAL','Salame Italiano','Salames','Vinho e pimenta em uma receita para a tábua.','/assets/salames.webp','200 g',2990,2290,6,36),
('SALA-PEPP','Pepperoni','Salames','Temperos marcantes para pizzas e sanduíches.','/assets/salames.webp','200 g',2790,2090,6,25),
('BACN-FATI','Bacon Fatiado','Bacon','Fatias para receitas e sanduíches.','/assets/defumados.webp','250 g',2390,1790,6,48),
('BACN-CUBO','Bacon em Cubos','Bacon','Cubos para molhos e acompanhamentos.','/assets/defumados.webp','250 g',2190,1690,6,44);
