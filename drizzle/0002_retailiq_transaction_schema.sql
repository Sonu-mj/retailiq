DROP TABLE IF EXISTS entries;
--> statement-breakpoint
CREATE TABLE outlets (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE categories (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE products (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  selling_price REAL NOT NULL CHECK(selling_price >= 0),
  cost_price REAL NOT NULL CHECK(cost_price >= 0),
  image_url TEXT,
  sku TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE customers (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  phone TEXT UNIQUE,
  email TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE invoice_sequences (
  day_key TEXT PRIMARY KEY NOT NULL,
  last_value INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE bills (
  id TEXT PRIMARY KEY NOT NULL,
  bill_number TEXT UNIQUE,
  outlet_id TEXT NOT NULL REFERENCES outlets(id),
  customer_id TEXT REFERENCES customers(id),
  bill_timestamp INTEGER NOT NULL,
  subtotal REAL NOT NULL CHECK(subtotal >= 0),
  discount REAL NOT NULL CHECK(discount >= 0),
  tax REAL NOT NULL CHECK(tax >= 0),
  total REAL NOT NULL CHECK(total >= 0),
  payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','upi','card')),
  status TEXT NOT NULL CHECK(status IN ('completed','cancelled','held')),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE bill_items (
  id TEXT PRIMARY KEY NOT NULL,
  bill_id TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name_snapshot TEXT NOT NULL,
  category_name_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  selling_price REAL NOT NULL CHECK(selling_price >= 0),
  cost_price REAL NOT NULL CHECK(cost_price >= 0),
  line_total REAL NOT NULL CHECK(line_total >= 0),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX bills_timestamp_idx ON bills(bill_timestamp DESC);
--> statement-breakpoint
CREATE INDEX bills_outlet_idx ON bills(outlet_id);
--> statement-breakpoint
CREATE INDEX bill_items_bill_idx ON bill_items(bill_id);
--> statement-breakpoint
CREATE INDEX products_category_idx ON products(category_id);
--> statement-breakpoint
CREATE TRIGGER bills_assign_number AFTER INSERT ON bills
WHEN NEW.bill_number IS NULL
BEGIN
  INSERT INTO invoice_sequences(day_key, last_value)
  VALUES(strftime('%Y%m%d', NEW.bill_timestamp / 1000, 'unixepoch'), 1)
  ON CONFLICT(day_key) DO UPDATE SET last_value = last_value + 1;
  UPDATE bills
  SET bill_number = 'INV-' || strftime('%Y%m%d', NEW.bill_timestamp / 1000, 'unixepoch') || '-' || printf('%05d', (SELECT last_value FROM invoice_sequences WHERE day_key = strftime('%Y%m%d', NEW.bill_timestamp / 1000, 'unixepoch')))
  WHERE id = NEW.id;
END;
