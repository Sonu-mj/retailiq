CREATE TABLE inventory (
  id text PRIMARY KEY NOT NULL,
  outlet_id text NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  current_quantity real NOT NULL DEFAULT 0 CHECK (current_quantity >= 0),
  minimum_quantity real NOT NULL DEFAULT 0 CHECK (minimum_quantity >= 0),
  maximum_quantity real NOT NULL DEFAULT 0 CHECK (maximum_quantity >= 0),
  reorder_point real NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
  reorder_quantity real NOT NULL DEFAULT 0 CHECK (reorder_quantity >= 0),
  lead_time_days integer NOT NULL DEFAULT 7 CHECK (lead_time_days >= 0),
  safety_stock real NOT NULL DEFAULT 0 CHECK (safety_stock >= 0),
  minimum_order_quantity real NOT NULL DEFAULT 0 CHECK (minimum_order_quantity >= 0),
  opening_quantity real NOT NULL DEFAULT 0 CHECK (opening_quantity >= 0),
  updated_at integer NOT NULL,
  created_at integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX inventory_outlet_product_unique ON inventory(outlet_id, product_id);
--> statement-breakpoint
CREATE INDEX inventory_outlet_idx ON inventory(outlet_id);
--> statement-breakpoint
CREATE INDEX inventory_product_idx ON inventory(product_id);
--> statement-breakpoint
CREATE TABLE inventory_movements (
  id text PRIMARY KEY NOT NULL,
  outlet_id text NOT NULL REFERENCES outlets(id),
  product_id text NOT NULL REFERENCES products(id),
  movement_type text NOT NULL CHECK (movement_type IN ('sale','return','wastage','purchase','adjustment','transfer_in','transfer_out')),
  quantity real NOT NULL CHECK (quantity != 0),
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  unit_cost real,
  notes text,
  created_by text NOT NULL REFERENCES profiles(id),
  created_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX inventory_movements_outlet_product_created_idx ON inventory_movements(outlet_id, product_id, created_at);
--> statement-breakpoint
CREATE INDEX inventory_movements_reference_idx ON inventory_movements(reference_type, reference_id);
--> statement-breakpoint
CREATE TABLE inventory_receipts (
  id text PRIMARY KEY NOT NULL,
  outlet_id text NOT NULL REFERENCES outlets(id),
  supplier text NOT NULL,
  purchase_reference text NOT NULL,
  receipt_date integer NOT NULL,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('draft','confirmed','cancelled')),
  created_by text NOT NULL REFERENCES profiles(id),
  created_at integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE inventory_receipt_items (
  id text PRIMARY KEY NOT NULL,
  receipt_id text NOT NULL REFERENCES inventory_receipts(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(id),
  quantity real NOT NULL CHECK (quantity > 0),
  unit_cost real NOT NULL CHECK (unit_cost >= 0),
  created_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX inventory_receipt_items_receipt_idx ON inventory_receipt_items(receipt_id);
--> statement-breakpoint
CREATE TABLE inventory_transfers (
  id text PRIMARY KEY NOT NULL,
  from_outlet_id text NOT NULL REFERENCES outlets(id),
  to_outlet_id text NOT NULL REFERENCES outlets(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','completed','cancelled')),
  notes text,
  created_by text NOT NULL REFERENCES profiles(id),
  approved_by text REFERENCES profiles(id),
  completed_at integer,
  created_at integer NOT NULL,
  CHECK (from_outlet_id != to_outlet_id)
);
--> statement-breakpoint
CREATE TABLE inventory_transfer_items (
  id text PRIMARY KEY NOT NULL,
  transfer_id text NOT NULL REFERENCES inventory_transfers(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES products(id),
  quantity real NOT NULL CHECK (quantity > 0),
  created_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX inventory_transfer_items_transfer_idx ON inventory_transfer_items(transfer_id);
--> statement-breakpoint
ALTER TABLE returns ADD COLUMN restockable integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE inventory_settings (
  id text PRIMARY KEY NOT NULL,
  allow_negative_stock integer NOT NULL DEFAULT 0,
  updated_by text REFERENCES profiles(id),
  updated_at integer NOT NULL
);
--> statement-breakpoint
INSERT INTO inventory_settings(id, allow_negative_stock, updated_at) VALUES ('GLOBAL', 0, unixepoch('subsec') * 1000);
--> statement-breakpoint
CREATE TRIGGER inventory_prevent_negative_insert BEFORE INSERT ON inventory
WHEN NEW.current_quantity < 0
BEGIN SELECT RAISE(ABORT, 'INSUFFICIENT_STOCK'); END;
--> statement-breakpoint
CREATE TRIGGER inventory_prevent_negative_update BEFORE UPDATE OF current_quantity ON inventory
WHEN NEW.current_quantity < 0 AND COALESCE((SELECT allow_negative_stock FROM inventory_settings WHERE id='GLOBAL'),0)=0
BEGIN SELECT RAISE(ABORT, 'INSUFFICIENT_STOCK'); END;