import { getTableColumns, getTableName, type SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { Ctx } from "@hatch/space-sdk";
import { privileged } from "@space/privileged";

// Compatibility data layer for the existing Drizzle-shaped service code. Queries
// are rendered as SQLite SQL, evaluated server-side against RLS-filtered rows
// fetched from Supabase, and mutations are sent back through PostgREST. Nothing
// is exposed to the browser beyond the existing typed action responses.
const dialect = new SQLiteSyncDialect();
type AnyTable = Record<string, any>;
type Selection = Record<string, any> | undefined;
type ColumnDef = { property: string; name: string; kind: "number" | "boolean" | "date" | "string" };
type TableDef = { name: string; columns: ColumnDef[] };
type RemoteOperation = {
  kind: "select" | "insert" | "update" | "delete";
  table: string;
  tables: TableDef[];
  sql?: string;
  params?: Array<string | number | boolean | null>;
  rows?: Array<Record<string, unknown>>;
  values?: Record<string, unknown>;
  expressions?: Record<string, { sql: string; params: Array<string | number | boolean | null> }>;
  conflict?: string[];
  ignoreConflict?: boolean;
};

function tableDef(table: AnyTable): TableDef {
  const columns = getTableColumns(table as never) as Record<string, any>;
  return {
    name: getTableName(table as never),
    columns: Object.entries(columns).map(([property, column]) => ({
      property,
      name: column.name as string,
      kind: column.columnType === "SQLiteBoolean" ? "boolean" : (column.columnType === "SQLiteTimestamp" || (column as any).mode === "timestamp_ms") ? "date" : column.dataType === "number" ? "number" : "string",
    })),
  };
}
function normalize(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}
function render(fragment: SQL): { sql: string; params: Array<string | number | boolean | null> } {
  const query = dialect.sqlToQuery(fragment);
  return { sql: query.sql, params: query.params.map(normalize) };
}
function columnSql(column: any): string { return `"${getTableName(column.table)}"."${column.name}"`; }
function serializeRow(table: AnyTable, value: Record<string, unknown>): Record<string, unknown> {
  const columns = getTableColumns(table as never) as Record<string, any>;
  const result: Record<string, unknown> = {};
  for (const [property, column] of Object.entries(columns)) {
    let current = value[property];
    if (current === undefined && typeof column.defaultFn === "function") current = column.defaultFn();
    if (current !== undefined) result[column.name as string] = current instanceof Date ? current.toISOString() : current;
  }
  return result;
}
function selectionPlan(selection: Selection, table: AnyTable) {
  const aliases: Array<{ alias: string; path: string[]; kind: ColumnDef["kind"] }> = [];
  const expressions: string[] = [];
  const addColumn = (alias: string, path: string[], column: any) => {
    const def = tableDef(column.table).columns.find(item => item.name === column.name);
    aliases.push({ alias, path, kind: def?.kind ?? "string" });
    expressions.push(`${columnSql(column)} AS "${alias}"`);
  };
  if (!selection) {
    const columns = getTableColumns(table as never) as Record<string, any>;
    for (const [property, column] of Object.entries(columns)) addColumn(property, [property], column);
  } else {
    for (const [key, value] of Object.entries(selection)) {
      if (value && typeof value === "object" && "name" in value && "table" in value) addColumn(key, [key], value);
      else {
        const nested = getTableColumns(value as never) as Record<string, any>;
        for (const [property, column] of Object.entries(nested)) addColumn(`${key}__${property}`, [key, property], column);
      }
    }
  }
  return { aliases, expressions };
}
function hydrate(rows: Array<Record<string, unknown>>, aliases: ReturnType<typeof selectionPlan>["aliases"]) {
  return rows.map(row => {
    const output: Record<string, any> = {};
    for (const item of aliases) {
      let value = row[item.alias];
      if (item.kind === "date" && typeof value === "string") value = new Date(value);
      if (item.kind === "boolean") value = value === true || value === 1;
      if (item.path.length === 1) output[item.path[0] ?? item.alias] = value;
      else {
        const root = item.path[0] ?? "value";
        output[root] ??= {};
        output[root][item.path[1] ?? item.alias] = value;
      }
    }
    return output;
  });
}

class SelectBuilder implements PromiseLike<any[]> {
  private joins: Array<{ type: "inner" | "left"; table: AnyTable; on: SQL }> = [];
  private predicate?: SQL;
  private ordering: SQL[] = [];
  private rowLimit?: number;
  constructor(private ctx: Ctx, private token: string, private selection: Selection, private table: AnyTable) {}
  innerJoin(table: AnyTable, on: SQL) { this.joins.push({ type: "inner", table, on }); return this; }
  leftJoin(table: AnyTable, on: SQL) { this.joins.push({ type: "left", table, on }); return this; }
  where(predicate: SQL | undefined) { this.predicate = predicate; return this; }
  orderBy(...ordering: SQL[]) { this.ordering = ordering; return this; }
  limit(value: number) { this.rowLimit = value; return this; }
  async execute() {
    const plan = selectionPlan(this.selection, this.table);
    let statement = `select ${plan.expressions.join(", ")} from "${getTableName(this.table as never)}"`;
    for (const join of this.joins) statement += ` ${join.type} join "${getTableName(join.table as never)}" on ${render(join.on).sql}`;
    const params: Array<string | number | boolean | null> = [];
    for (const join of this.joins) params.push(...render(join.on).params);
    if (this.predicate) { const rendered = render(this.predicate); statement += ` where ${rendered.sql}`; params.push(...rendered.params); }
    if (this.ordering.length) statement += ` order by ${this.ordering.map(item => render(item).sql).join(", ")}`;
    if (this.rowLimit != null) statement += ` limit ${Math.max(0, Math.floor(this.rowLimit))}`;
    const defs = [this.table, ...this.joins.map(item => item.table)].map(tableDef);
    const response = await this.ctx.executePrivileged(privileged.supabaseData, { access_token: this.token, operations: [{ kind: "select", table: defs[0]?.name ?? "", tables: defs, sql: statement, params }] });
    return hydrate(response.results[0] ?? [], plan.aliases);
  }
  then<TResult1 = any[], TResult2 = never>(onfulfilled?: ((value: any[]) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null) { return this.execute().then(onfulfilled, onrejected); }
}

class MutationBuilder implements PromiseLike<any> {
  operation: RemoteOperation;
  constructor(private ctx: Ctx, private token: string, kind: "insert" | "update" | "delete", private table: AnyTable) { this.operation = { kind, table: getTableName(table as never), tables: [tableDef(table)] }; }
  values(value: Record<string, unknown> | Array<Record<string, unknown>>) { this.operation.rows = (Array.isArray(value) ? value : [value]).map(row => serializeRow(this.table, row)); return this; }
  set(value: Record<string, unknown>) {
    const columns = getTableColumns(this.table as never) as Record<string, any>;
    const plain: Record<string, unknown> = {}; const expressions: NonNullable<RemoteOperation["expressions"]> = {};
    for (const [property, current] of Object.entries(value)) {
      const name = columns[property]?.name as string | undefined; if (!name) continue;
      if (current && typeof current === "object" && "queryChunks" in current) expressions[name] = render(current as SQL);
      else plain[name] = current instanceof Date ? current.toISOString() : current;
    }
    this.operation.values = plain; this.operation.expressions = expressions; return this;
  }
  where(predicate: SQL | undefined) { if (predicate) { const rendered = render(predicate); this.operation.sql = rendered.sql; this.operation.params = rendered.params; } return this; }
  onConflictDoNothing() { this.operation.ignoreConflict = true; return this; }
  onConflictDoUpdate(config: { target: any | any[]; set: Record<string, unknown> }) {
    const targets = Array.isArray(config.target) ? config.target : [config.target];
    this.operation.conflict = targets.map(column => column.name as string); this.set(config.set); return this;
  }
  async execute() { const response = await this.ctx.executePrivileged(privileged.supabaseData, { access_token: this.token, operations: [this.operation] }); return response.results[0] ?? []; }
  then<TResult1 = any, TResult2 = never>(onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null) { return this.execute().then(onfulfilled, onrejected); }
}

export function supabaseDb(ctx: Ctx, accessToken: string) {
  return {
    select: (selection?: Selection) => ({ from: (table: AnyTable) => new SelectBuilder(ctx, accessToken, selection, table) }),
    insert: (table: AnyTable) => new MutationBuilder(ctx, accessToken, "insert", table),
    update: (table: AnyTable) => new MutationBuilder(ctx, accessToken, "update", table),
    delete: (table: AnyTable) => new MutationBuilder(ctx, accessToken, "delete", table),
    batch: async (builders: MutationBuilder[]) => {
      const operations = builders.map(builder => builder.operation);
      const response = await ctx.executePrivileged(privileged.supabaseData, { access_token: accessToken, operations });
      return response.results;
    },
  };
}
