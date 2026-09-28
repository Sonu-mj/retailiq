DELETE FROM inventory_movements
WHERE reference_id LIKE 'BILL_DEMO_%'
   OR reference_id LIKE 'RET_DEMO_%'
   OR reference_id LIKE 'WST_DEMO_%';
--> statement-breakpoint
DELETE FROM returns WHERE id LIKE 'RET_DEMO_%';
--> statement-breakpoint
DELETE FROM bills WHERE id LIKE 'BILL_DEMO_%';
--> statement-breakpoint
DELETE FROM wastage WHERE id LIKE 'WST_DEMO_%';
--> statement-breakpoint
DELETE FROM outlet_costs WHERE id LIKE 'COST_DEMO_%';
--> statement-breakpoint
DELETE FROM customers WHERE id IN ('CUS001','CUS002','CUS003','CUS004','CUS005','CUS006','CUS007','CUS008','CUS009','CUS010')
AND NOT EXISTS (SELECT 1 FROM bills WHERE bills.customer_id = customers.id);
