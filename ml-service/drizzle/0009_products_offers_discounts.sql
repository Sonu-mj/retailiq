CREATE TABLE offers (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  offer_type text NOT NULL CHECK (offer_type IN ('percentage','flat')),
  target_type text NOT NULL CHECK (target_type IN ('product','category')),
  product_id text REFERENCES products(id),
  category_id text REFERENCES categories(id),
  discount_value real NOT NULL CHECK (discount_value > 0),
  start_date text NOT NULL,
  end_date text NOT NULL,
  is_active integer NOT NULL DEFAULT 1,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CHECK (start_date <= end_date),
  CHECK ((target_type = 'product' AND product_id IS NOT NULL AND category_id IS NULL) OR (target_type = 'category' AND category_id IS NOT NULL AND product_id IS NULL)),
  CHECK (offer_type != 'percentage' OR discount_value <= 100)
);
--> statement-breakpoint
CREATE INDEX offers_active_dates_idx ON offers(is_active, start_date, end_date);
--> statement-breakpoint
CREATE INDEX offers_product_idx ON offers(product_id);
--> statement-breakpoint
CREATE INDEX offers_category_idx ON offers(category_id);