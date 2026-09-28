CREATE TABLE returns (
  id TEXT PRIMARY KEY NOT NULL,
  return_number TEXT NOT NULL UNIQUE,
  bill_id TEXT NOT NULL REFERENCES bills(id),
  bill_item_id TEXT NOT NULL REFERENCES bill_items(id),
  outlet_id TEXT NOT NULL REFERENCES outlets(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  unit_price REAL NOT NULL CHECK(unit_price >= 0),
  return_amount REAL NOT NULL CHECK(return_amount >= 0),
  reason TEXT NOT NULL CHECK(reason IN ('Customer return','Wrong item','Damaged item','Quality issue','Duplicate order','Other')),
  return_timestamp INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE wastage (
  id TEXT PRIMARY KEY NOT NULL,
  outlet_id TEXT NOT NULL REFERENCES outlets(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL CHECK(quantity > 0),
  unit_cost REAL NOT NULL CHECK(unit_cost >= 0),
  wastage_cost REAL NOT NULL CHECK(wastage_cost >= 0),
  reason TEXT NOT NULL CHECK(reason IN ('Expired','Damaged','Spoiled','Preparation loss','Spillage','Missing stock','Other')),
  wastage_timestamp INTEGER NOT NULL,
  notes TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE outlet_costs (
  id TEXT PRIMARY KEY NOT NULL,
  outlet_id TEXT NOT NULL REFERENCES outlets(id),
  period_month INTEGER NOT NULL CHECK(period_month BETWEEN 1 AND 12),
  period_year INTEGER NOT NULL CHECK(period_year BETWEEN 2000 AND 2200),
  rent REAL NOT NULL DEFAULT 0 CHECK(rent >= 0),
  staff_cost REAL NOT NULL DEFAULT 0 CHECK(staff_cost >= 0),
  utilities REAL NOT NULL DEFAULT 0 CHECK(utilities >= 0),
  other_costs REAL NOT NULL DEFAULT 0 CHECK(other_costs >= 0),
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(outlet_id, period_month, period_year)
);
--> statement-breakpoint
CREATE TABLE return_sequences (
  day_key TEXT PRIMARY KEY NOT NULL,
  last_value INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX returns_outlet_timestamp_idx ON returns(outlet_id, return_timestamp DESC);
--> statement-breakpoint
CREATE INDEX returns_bill_idx ON returns(bill_id);
--> statement-breakpoint
CREATE INDEX returns_bill_item_idx ON returns(bill_item_id);
--> statement-breakpoint
CREATE INDEX returns_product_idx ON returns(product_id);
--> statement-breakpoint
CREATE INDEX wastage_outlet_timestamp_idx ON wastage(outlet_id, wastage_timestamp DESC);
--> statement-breakpoint
CREATE INDEX wastage_product_idx ON wastage(product_id);
--> statement-breakpoint
CREATE INDEX outlet_costs_period_idx ON outlet_costs(period_year, period_month);
--> statement-breakpoint
CREATE INDEX outlet_costs_outlet_idx ON outlet_costs(outlet_id);
