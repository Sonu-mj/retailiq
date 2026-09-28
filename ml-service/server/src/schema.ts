import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const outlets = sqliteTable("outlets", {
  id: text("id").primaryKey(), name: text("name").notNull(), code: text("code").notNull(), city: text("city").notNull(), address: text("address").notNull(), phone: text("phone").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [uniqueIndex("outlets_code_unique").on(table.code)]);

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(), name: text("name").notNull(), isActive: integer("is_active", { mode: "boolean" }).notNull().default(true), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [uniqueIndex("categories_name_unique").on(table.name)]);

export const products = sqliteTable("products", {
  id: text("id").primaryKey(), name: text("name").notNull(), categoryId: text("category_id").notNull().references(() => categories.id), sellingPrice: real("selling_price").notNull(), costPrice: real("cost_price").notNull(), imageUrl: text("image_url"), sku: text("sku").notNull(), isActive: integer("is_active", { mode: "boolean" }).notNull().default(true), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [uniqueIndex("products_sku_unique").on(table.sku), index("products_category_idx").on(table.categoryId)]);

export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(), name: text("name").notNull(), phone: text("phone"), email: text("email"), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [uniqueIndex("customers_phone_unique").on(table.phone)]);

export const bills = sqliteTable("bills", {
  id: text("id").primaryKey(), billNumber: text("bill_number"), idempotencyKey: text("idempotency_key"), outletId: text("outlet_id").notNull().references(() => outlets.id), customerId: text("customer_id").references(() => customers.id), billTimestamp: integer("bill_timestamp", { mode: "timestamp_ms" }).notNull(), subtotal: real("subtotal").notNull(), discount: real("discount").notNull(), tax: real("tax").notNull(), total: real("total").notNull(), paymentMethod: text("payment_method", { enum: ["cash", "upi", "card"] }).notNull(), status: text("status", { enum: ["completed", "cancelled", "held"] }).notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [uniqueIndex("bills_bill_number_unique").on(table.billNumber), uniqueIndex("bills_idempotency_unique").on(table.idempotencyKey), index("bills_timestamp_idx").on(table.billTimestamp), index("bills_outlet_idx").on(table.outletId)]);

export const billItems = sqliteTable("bill_items", {
  id: text("id").primaryKey(), billId: text("bill_id").notNull().references(() => bills.id, { onDelete: "cascade" }), productId: text("product_id").notNull().references(() => products.id), productNameSnapshot: text("product_name_snapshot").notNull(), categoryNameSnapshot: text("category_name_snapshot").notNull(), quantity: integer("quantity").notNull(), sellingPrice: real("selling_price").notNull(), costPrice: real("cost_price").notNull(), lineTotal: real("line_total").notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [index("bill_items_bill_idx").on(table.billId), index("bill_items_product_idx").on(table.productId)]);

export const invoiceSequences = sqliteTable("invoice_sequences", { dayKey: text("day_key").primaryKey(), lastValue: integer("last_value").notNull() });

export const returnRecords = sqliteTable("returns", {
  id: text("id").primaryKey(), returnNumber: text("return_number").notNull(), billId: text("bill_id").notNull().references(() => bills.id), billItemId: text("bill_item_id").notNull().references(() => billItems.id), outletId: text("outlet_id").notNull().references(() => outlets.id), productId: text("product_id").notNull().references(() => products.id), quantity: integer("quantity").notNull(), unitPrice: real("unit_price").notNull(), returnAmount: real("return_amount").notNull(), reason: text("reason", { enum: ["Customer return","Wrong item","Damaged item","Quality issue","Duplicate order","Other"] }).notNull(), restockable: integer("restockable", { mode: "boolean" }).notNull().default(false), returnTimestamp: integer("return_timestamp", { mode: "timestamp_ms" }).notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [uniqueIndex("returns_number_unique").on(table.returnNumber), index("returns_outlet_timestamp_idx").on(table.outletId, table.returnTimestamp), index("returns_bill_idx").on(table.billId), index("returns_bill_item_idx").on(table.billItemId), index("returns_product_idx").on(table.productId)]);

export const wastage = sqliteTable("wastage", {
  id: text("id").primaryKey(), outletId: text("outlet_id").notNull().references(() => outlets.id), productId: text("product_id").notNull().references(() => products.id), quantity: real("quantity").notNull(), unitCost: real("unit_cost").notNull(), wastageCost: real("wastage_cost").notNull(), reason: text("reason", { enum: ["Expired","Damaged","Spoiled","Preparation loss","Spillage","Missing stock","Other"] }).notNull(), wastageTimestamp: integer("wastage_timestamp", { mode: "timestamp_ms" }).notNull(), notes: text("notes"), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [index("wastage_outlet_timestamp_idx").on(table.outletId, table.wastageTimestamp), index("wastage_product_idx").on(table.productId)]);

export const outletCosts = sqliteTable("outlet_costs", {
  id: text("id").primaryKey(), outletId: text("outlet_id").notNull().references(() => outlets.id), periodMonth: integer("period_month").notNull(), periodYear: integer("period_year").notNull(), rent: real("rent").notNull().default(0), staffCost: real("staff_cost").notNull().default(0), utilities: real("utilities").notNull().default(0), otherCosts: real("other_costs").notNull().default(0), notes: text("notes"), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [uniqueIndex("outlet_costs_period_unique").on(table.outletId, table.periodMonth, table.periodYear), index("outlet_costs_period_idx").on(table.periodYear, table.periodMonth), index("outlet_costs_outlet_idx").on(table.outletId)]);

export const returnSequences = sqliteTable("return_sequences", { dayKey: text("day_key").primaryKey(), lastValue: integer("last_value").notNull() });

export const anomalyEvents = sqliteTable("anomaly_events", {
  id: text("id").primaryKey(),
  outletId: text("outlet_id").notNull().references(() => outlets.id),
  eventTimestamp: integer("event_timestamp", { mode: "timestamp_ms" }).notNull(),
  anomalyType: text("anomaly_type", { enum: ["high_returns","high_wastage","revenue_drop","revenue_spike","discount_spike","margin_drop","order_volume_anomaly","average_order_value_anomaly","profitability_anomaly","multi_factor_anomaly"] }).notNull(),
  severity: text("severity", { enum: ["watch","elevated","high_attention"] }).notNull(),
  anomalyScore: real("anomaly_score").notNull(),
  rawModelScore: real("raw_model_score").notNull(),
  featureSnapshot: text("feature_snapshot").notNull(),
  summary: text("summary").notNull(),
  recommendation: text("recommendation").notNull(),
  relatedBillIds: text("related_bill_ids").notNull().default("[]"),
  investigationStatus: text("investigation_status", { enum: ["new","reviewing","resolved","dismissed"] }).notNull().default("new"),
  modelVersion: text("model_version").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index("anomaly_events_outlet_timestamp_idx").on(table.outletId, table.eventTimestamp),
  index("anomaly_events_severity_idx").on(table.severity),
  index("anomaly_events_status_idx").on(table.investigationStatus),
]);

export const intelligenceRuns = sqliteTable("intelligence_runs", {
  id: text("id").primaryKey(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  status: text("status", { enum: ["completed","insufficient_data","failed"] }).notNull(),
  observationCount: integer("observation_count").notNull().default(0),
  outletCount: integer("outlet_count").notNull().default(0),
  signalCount: integer("signal_count").notNull().default(0),
  highAttentionCount: integer("high_attention_count").notNull().default(0),
  modelVersion: text("model_version").notNull(),
  notes: text("notes"),
}, (table) => [index("intelligence_runs_started_idx").on(table.startedAt)]);

export const demandForecasts = sqliteTable("demand_forecasts", {
  id: text("id").primaryKey(),
  outletId: text("outlet_id").notNull().references(() => outlets.id),
  forecastTimestamp: integer("forecast_timestamp", { mode: "timestamp_ms" }).notNull(),
  predictedOrders: real("predicted_orders").notNull(),
  lowerBound: real("lower_bound"),
  upperBound: real("upper_bound"),
  modelVersion: text("model_version").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [uniqueIndex("demand_forecasts_outlet_time_version_unique").on(table.outletId, table.forecastTimestamp, table.modelVersion), index("demand_forecasts_time_idx").on(table.forecastTimestamp), index("demand_forecasts_outlet_idx").on(table.outletId)]);

export const forecastRuns = sqliteTable("forecast_runs", {
  id: text("id").primaryKey(),
  trainedAt: integer("trained_at", { mode: "timestamp_ms" }).notNull(),
  generatedAt: integer("generated_at", { mode: "timestamp_ms" }),
  status: text("status", { enum: ["completed","insufficient_data","failed"] }).notNull(),
  trainingRecords: integer("training_records").notNull().default(0),
  outletCount: integer("outlet_count").notNull().default(0),
  horizonHours: integer("horizon_hours").notNull().default(168),
  mae: real("mae"),
  rmse: real("rmse"),
  mape: real("mape"),
  modelVersion: text("model_version").notNull(),
  notes: text("notes"),
}, (table) => [index("forecast_runs_trained_idx").on(table.trainedAt)]);

export const workforceSettings = sqliteTable("workforce_settings", {
  id: text("id").primaryKey(),
  outletId: text("outlet_id").references(() => outlets.id),
  ordersPerStaffHour: real("orders_per_staff_hour").notNull().default(10),
  staffingBufferPercent: real("staffing_buffer_percent").notNull().default(10),
  minimumStaff: integer("minimum_staff").notNull().default(1),
  maximumStaff: integer("maximum_staff").notNull().default(8),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [uniqueIndex("workforce_settings_outlet_unique").on(table.outletId)]);

export const staffPlans = sqliteTable("staff_plans", {
  id: text("id").primaryKey(),
  outletId: text("outlet_id").notNull().references(() => outlets.id),
  forecastTimestamp: integer("forecast_timestamp", { mode: "timestamp_ms" }).notNull(),
  forecastOrders: real("forecast_orders").notNull(),
  baseStaff: integer("base_staff").notNull(),
  recommendedStaff: integer("recommended_staff").notNull(),
  scheduledStaff: integer("scheduled_staff"),
  modelVersion: text("model_version").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [uniqueIndex("staff_plans_outlet_time_version_unique").on(table.outletId, table.forecastTimestamp, table.modelVersion), index("staff_plans_time_idx").on(table.forecastTimestamp)]);

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  employeeId: text("employee_id"),
  role: text("role", { enum: ["owner", "manager", "cashier"] }).notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [uniqueIndex("profiles_email_unique").on(table.email)]);

export const userOutlets = sqliteTable("user_outlets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  outletId: text("outlet_id").notNull().references(() => outlets.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [uniqueIndex("user_outlets_user_outlet_unique").on(table.userId, table.outletId), index("user_outlets_user_idx").on(table.userId), index("user_outlets_outlet_idx").on(table.outletId)]);

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  outletId: text("outlet_id").references(() => outlets.id),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [index("audit_logs_created_idx").on(table.createdAt), index("audit_logs_user_idx").on(table.userId), index("audit_logs_outlet_idx").on(table.outletId), index("audit_logs_action_idx").on(table.action)]);

export const inventory = sqliteTable("inventory", {
  id: text("id").primaryKey(),
  outletId: text("outlet_id").notNull().references(() => outlets.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  currentQuantity: real("current_quantity").notNull().default(0),
  minimumQuantity: real("minimum_quantity").notNull().default(0),
  maximumQuantity: real("maximum_quantity").notNull().default(0),
  reorderPoint: real("reorder_point").notNull().default(0),
  reorderQuantity: real("reorder_quantity").notNull().default(0),
  leadTimeDays: integer("lead_time_days").notNull().default(7),
  safetyStock: real("safety_stock").notNull().default(0),
  minimumOrderQuantity: real("minimum_order_quantity").notNull().default(0),
  openingQuantity: real("opening_quantity").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [uniqueIndex("inventory_outlet_product_unique").on(table.outletId, table.productId), index("inventory_outlet_idx").on(table.outletId), index("inventory_product_idx").on(table.productId)]);

export const inventoryMovements = sqliteTable("inventory_movements", {
  id: text("id").primaryKey(), outletId: text("outlet_id").notNull().references(() => outlets.id), productId: text("product_id").notNull().references(() => products.id),
  movementType: text("movement_type", { enum: ["sale","return","wastage","purchase","adjustment","transfer_in","transfer_out"] }).notNull(), quantity: real("quantity").notNull(), referenceType: text("reference_type").notNull(), referenceId: text("reference_id").notNull(), unitCost: real("unit_cost"), notes: text("notes"), createdBy: text("created_by").notNull().references(() => profiles.id), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [index("inventory_movements_outlet_product_created_idx").on(table.outletId, table.productId, table.createdAt), index("inventory_movements_reference_idx").on(table.referenceType, table.referenceId)]);

export const inventoryReceipts = sqliteTable("inventory_receipts", {
  id: text("id").primaryKey(), outletId: text("outlet_id").notNull().references(() => outlets.id), supplier: text("supplier").notNull(), purchaseReference: text("purchase_reference").notNull(), receiptDate: integer("receipt_date", { mode: "timestamp_ms" }).notNull(), status: text("status", { enum: ["draft","confirmed","cancelled"] }).notNull().default("confirmed"), createdBy: text("created_by").notNull().references(() => profiles.id), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const inventoryReceiptItems = sqliteTable("inventory_receipt_items", {
  id: text("id").primaryKey(), receiptId: text("receipt_id").notNull().references(() => inventoryReceipts.id, { onDelete: "cascade" }), productId: text("product_id").notNull().references(() => products.id), quantity: real("quantity").notNull(), unitCost: real("unit_cost").notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [index("inventory_receipt_items_receipt_idx").on(table.receiptId)]);

export const inventoryTransfers = sqliteTable("inventory_transfers", {
  id: text("id").primaryKey(), fromOutletId: text("from_outlet_id").notNull().references(() => outlets.id), toOutletId: text("to_outlet_id").notNull().references(() => outlets.id), status: text("status", { enum: ["pending","approved","completed","cancelled"] }).notNull().default("pending"), notes: text("notes"), createdBy: text("created_by").notNull().references(() => profiles.id), approvedBy: text("approved_by").references(() => profiles.id), completedAt: integer("completed_at", { mode: "timestamp_ms" }), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const inventoryTransferItems = sqliteTable("inventory_transfer_items", {
  id: text("id").primaryKey(), transferId: text("transfer_id").notNull().references(() => inventoryTransfers.id, { onDelete: "cascade" }), productId: text("product_id").notNull().references(() => products.id), quantity: real("quantity").notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [index("inventory_transfer_items_transfer_idx").on(table.transferId)]);

export const inventorySettings = sqliteTable("inventory_settings", {
  id: text("id").primaryKey(), allowNegativeStock: integer("allow_negative_stock", { mode: "boolean" }).notNull().default(false), updatedBy: text("updated_by").references(() => profiles.id), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const offers = sqliteTable("offers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  offerType: text("offer_type", { enum: ["percentage", "flat"] }).notNull(),
  targetType: text("target_type", { enum: ["product", "category"] }).notNull(),
  productId: text("product_id").references(() => products.id),
  categoryId: text("category_id").references(() => categories.id),
  discountValue: real("discount_value").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [index("offers_active_dates_idx").on(table.isActive, table.startDate, table.endDate), index("offers_product_idx").on(table.productId), index("offers_category_idx").on(table.categoryId)]);

export const businessInsights = sqliteTable("business_insights", {
  id: text("id").primaryKey(),
  outletId: text("outlet_id").references(() => outlets.id),
  generatedAt: integer("generated_at", { mode: "timestamp_ms" }).notNull(),
  insightType: text("insight_type", { enum: ["negative_profit","operating_cost_pressure","high_returns","high_wastage","staffing_gap","cross_signal","anomaly"] }).notNull(),
  severity: text("severity", { enum: ["informational","watch","elevated","high_attention"] }).notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  relatedEntityType: text("related_entity_type").notNull(),
  relatedEntityId: text("related_entity_id").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  status: text("status", { enum: ["new","reviewing","resolved","dismissed"] }).notNull().default("new"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex("business_insights_dedupe_unique").on(table.dedupeKey),
  index("business_insights_outlet_idx").on(table.outletId),
  index("business_insights_status_idx").on(table.status),
  index("business_insights_generated_idx").on(table.generatedAt),
]);
