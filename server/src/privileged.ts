import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { Database as SqlJsDatabase, SqlJsStatic } from "sql.js";
import { definePrivilegedContracts, definePrivilegedHandlers, z } from "@hatch/space-sdk";

const require = createRequire(import.meta.url);
let sqlJsRuntime: Promise<SqlJsStatic> | null = null;

// Load sql.js only when a local SQLite adapter is actually needed. Keeping the
// package load and initialization out of module scope prevents an unavailable
// optional runtime from taking down every Vercel action during import.
function getSqlJsRuntime(): Promise<SqlJsStatic> {
  if (sqlJsRuntime) return sqlJsRuntime;
  try {
    const initSqlJs = require("sql.js/dist/sql-asm.js") as () => Promise<SqlJsStatic>;
    sqlJsRuntime = Promise.resolve(initSqlJs()).catch(error => {
      sqlJsRuntime = null;
      throw new Error("The local SQLite runtime is unavailable on this server.", { cause: error });
    });
    return sqlJsRuntime;
  } catch (error) {
    sqlJsRuntime = null;
    return Promise.reject(new Error("The local SQLite runtime is unavailable on this server.", { cause: error }));
  }
}

// Small adapter preserving the query API used by the original Bun-hosted
// implementation while running in a standard Vercel Node.js function. The
// asm.js build avoids native binaries and WebAssembly asset lookup at runtime.
class Database {
  constructor(private readonly db: SqlJsDatabase) {}
  query(sql: string) {
    return {
      all: (...params: Array<string | number | boolean | null>) => {
        const statement = this.db.prepare(sql);
        try {
          statement.bind(params.map(value => typeof value === "boolean" ? (value ? 1 : 0) : value));
          const rows: Array<Record<string, unknown>> = [];
          while (statement.step()) rows.push(statement.getAsObject());
          return rows;
        } finally { statement.free(); }
      },
      get: (...params: Array<string | number | boolean | null>) => {
        const statement = this.db.prepare(sql);
        try {
          statement.bind(params.map(value => typeof value === "boolean" ? (value ? 1 : 0) : value));
          return statement.step() ? statement.getAsObject() : undefined;
        } finally { statement.free(); }
      },
    };
  }
  prepare(sql: string) {
    return { run: (...params: Array<string | number | boolean | null>) => this.db.run(sql, params.map(value => typeof value === "boolean" ? (value ? 1 : 0) : value)) };
  }
  run(sql: string) { this.db.run(sql); }
  close() { this.db.close(); }
}

// Public Supabase client configuration has production-safe defaults so the Muse
// preview works without deployment settings. Vercel environment variables take
// precedence, while the service-role key remains server-only and has no default.
const DEFAULT_SUPABASE_URL="https://desevxiifxfojoebwtix.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlc2V2eGlpZnhmb2pvZWJ3dGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1MjIxOTgsImV4cCI6MjEwNjA5ODE5OH0.vDHZRNXnAffTrkhdgRSIQrojnjua3APIRw2H1ysDRkg";
function supabaseConfig(){
  const url=(process.env.SUPABASE_URL??process.env.NEXT_PUBLIC_SUPABASE_URL??DEFAULT_SUPABASE_URL).trim().replace(/\/$/,"");
  const anonKey=(process.env.SUPABASE_ANON_KEY??process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY??DEFAULT_SUPABASE_ANON_KEY).trim();
  return{url,anonKey};
}

export const privileged = definePrivilegedContracts({
  runIsolationForest: {
    request: z.object({
      outlets: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
      bills: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
      returns: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
      wastage: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
      costs: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
    }),
    response: z.object({
      status: z.enum(["completed", "insufficient_data"]),
      model_version: z.string(),
      observation_count: z.number().int().nonnegative(),
      eligible_outlet_count: z.number().int().nonnegative(),
      message: z.string(),
      anomalies: z.array(z.object({
        outlet_id: z.string(), event_timestamp: z.string(),
        anomaly_type: z.enum(["high_returns","high_wastage","revenue_drop","revenue_spike","discount_spike","margin_drop","order_volume_anomaly","average_order_value_anomaly","profitability_anomaly","multi_factor_anomaly"]),
        severity: z.enum(["watch","elevated","high_attention"]),
        anomaly_score: z.number(), raw_model_score: z.number(),
        feature_snapshot: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
        summary: z.string(), recommendation: z.string(),
      })),
    }),
    timeoutMs: 120000,
  },
  runDemandForecast: {
    request: z.object({
      observations: z.array(z.object({outlet_id:z.string(),timestamp:z.string(),orders:z.number(),units_sold:z.number(),revenue:z.number(),average_order_value:z.number()})),
      horizon_hours: z.number().int().min(24).max(168),
    }),
    response: z.object({
      status:z.enum(["completed","insufficient_data"]), model_version:z.string(), training_records:z.number().int().nonnegative(), eligible_outlet_count:z.number().int().nonnegative(), message:z.string(),
      metrics:z.object({mae:z.number(),rmse:z.number(),mape:z.number().nullable()}).nullable(),
      forecasts:z.array(z.object({outlet_id:z.string(),forecast_timestamp:z.string(),predicted_orders:z.number().nonnegative()})),
    }),
    timeoutMs:120000,
  },
  getSupabaseAuthConfig: {
    request: z.object({}),
    response: z.object({
      configured: z.boolean(),
      supabase_url: z.string(),
      anon_key: z.string(),
      redirect_url: z.string(),
    }),
  },
  signInWithSupabase: {
    request: z.object({email:z.string().email(),password:z.string().min(1)}),
    response: z.object({ok:z.boolean(),access_token:z.string(),refresh_token:z.string(),expires_in:z.number().int().positive(),error:z.string()}),
    timeoutMs:15000,
  },
  refreshSupabaseSession: {
    request: z.object({refresh_token:z.string().min(1)}),
    response: z.object({ok:z.boolean(),access_token:z.string(),refresh_token:z.string(),expires_in:z.number().int().positive(),error:z.string()}),
    timeoutMs:15000,
  },
  recoverSupabasePassword: {
    request: z.object({email:z.string().email(),redirect_url:z.string()}),
    response: z.object({ok:z.boolean(),error:z.string()}),
    timeoutMs:15000,
  },
  updateSupabasePassword: {
    request: z.object({access_token:z.string().min(1),password:z.string().min(8)}),
    response: z.object({ok:z.boolean(),error:z.string()}),
    timeoutMs:15000,
  },
  signOutSupabase: {
    request: z.object({access_token:z.string().min(1)}),
    response: z.object({ok:z.boolean()}),
    timeoutMs:15000,
  },
  verifySupabaseUser: {
    request: z.object({access_token:z.string().min(1)}),
    response: z.object({
      valid:z.boolean(),
      user_id:z.string(),
      email:z.string(),
      full_name:z.string(),
      role:z.enum(["owner","manager","cashier"]).nullable(),
      is_active:z.boolean(),
      outlet_ids:z.array(z.string()),
    }),
    timeoutMs:15000,
  },
  provisionSupabaseEmployee: {
    request: z.object({owner_access_token:z.string().min(1),email:z.string().email(),full_name:z.string().min(2),role:z.enum(["owner","manager","cashier"]),outlet_ids:z.array(z.string()),send_invite:z.boolean(),auth_user_id:z.string().optional().default("")}),
    response: z.object({ok:z.boolean(),configured:z.boolean(),user_id:z.string(),invited:z.boolean(),error:z.string()}),
    timeoutMs:20000,
  },
  uploadSupabaseProductImage: {
    request: z.object({access_token:z.string().min(1),storage_path:z.string().min(1).max(240),mime_type:z.enum(["image/jpeg","image/png","image/webp"]),data_base64:z.string().min(1).max(7_100_000)}),
    response: z.object({ok:z.boolean(),storage_ready:z.boolean(),signed_url:z.string(),error:z.string()}),
    timeoutMs:30000,
  },
  signSupabaseProductImages: {
    request: z.object({access_token:z.string().min(1),storage_paths:z.array(z.string().min(1).max(240)).max(100)}),
    response: z.object({storage_ready:z.boolean(),urls:z.record(z.string(),z.string())}),
    timeoutMs:30000,
  },
  supabaseCheckout: {
    request:z.object({access_token:z.string().min(1),bill:z.record(z.string(),z.unknown()),items:z.array(z.record(z.string(),z.unknown())),movements:z.array(z.record(z.string(),z.unknown()))}),
    response:z.object({ok:z.boolean(),bill_number:z.string(),error:z.string()}),
    timeoutMs:30000,
  },
  migrateManagedData: {
    request:z.object({access_token:z.string().min(1)}),
    response:z.object({
      status:z.enum(["completed","partial","failed"]),
      started_at:z.string(),
      completed_at:z.string(),
      source:z.string(),
      rows_read:z.number().int().nonnegative(),
      inserted:z.number().int().nonnegative(),
      skipped_existing:z.number().int().nonnegative(),
      conflicts_kept_newer:z.number().int().nonnegative(),
      updated_from_managed:z.number().int().nonnegative(),
      excluded:z.number().int().nonnegative(),
      tables:z.array(z.object({
        table:z.string(),
        rows_read:z.number().int().nonnegative(),
        inserted:z.number().int().nonnegative(),
        skipped_existing:z.number().int().nonnegative(),
        conflicts_kept_newer:z.number().int().nonnegative(),
        updated_from_managed:z.number().int().nonnegative(),
        excluded:z.number().int().nonnegative(),
        error:z.string().nullable(),
      })),
      error:z.string(),
    }),
    timeoutMs:300000,
  },
  supabaseData: {
    request: z.object({
      access_token:z.string().min(1),
      operations:z.array(z.object({
        kind:z.enum(["select","insert","update","delete"]), table:z.string(),
        tables:z.array(z.object({name:z.string(),columns:z.array(z.object({property:z.string(),name:z.string(),kind:z.enum(["number","boolean","date","string"])}))})),
        sql:z.string().optional(), params:z.array(z.union([z.string(),z.number(),z.boolean(),z.null()])).optional(),
        rows:z.array(z.record(z.string(),z.unknown())).optional(), values:z.record(z.string(),z.unknown()).optional(),
        expressions:z.record(z.string(),z.object({sql:z.string(),params:z.array(z.union([z.string(),z.number(),z.boolean(),z.null()]))})).optional(),
        conflict:z.array(z.string()).optional(), ignoreConflict:z.boolean().optional(),
      })).min(1).max(100),
    }),
    response:z.object({results:z.array(z.array(z.record(z.string(),z.unknown())))}),
    timeoutMs:120000,
  },
});

type AnalysisRequest = z.infer<typeof privileged.runIsolationForest.request>;
type AnalysisResponse = z.infer<typeof privileged.runIsolationForest.response>;
type ForecastRequest = z.infer<typeof privileged.runDemandForecast.request>;
type ForecastResponse = z.infer<typeof privileged.runDemandForecast.response>;

async function runRemote(args: AnalysisRequest, baseUrl: string): Promise<AnalysisResponse> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/ml/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(process.env.RETAILIQ_ML_SERVICE_TOKEN ? { authorization: `Bearer ${process.env.RETAILIQ_ML_SERVICE_TOKEN}` } : {}) },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(115000),
  });
  if (!response.ok) throw new Error(`ML service returned HTTP ${response.status}`);
  return privileged.runIsolationForest.response.parse(await response.json());
}

async function runLocal(_args: AnalysisRequest): Promise<AnalysisResponse> {
  throw new Error("Set RETAILIQ_ML_SERVICE_URL to run anomaly analysis on Vercel.");
}

async function runDemandRemote(args: ForecastRequest, baseUrl: string): Promise<ForecastResponse> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/forecast/generate`, {method:"POST",headers:{"content-type":"application/json",...(process.env.RETAILIQ_ML_SERVICE_TOKEN?{authorization:`Bearer ${process.env.RETAILIQ_ML_SERVICE_TOKEN}`}:{})},body:JSON.stringify(args),signal:AbortSignal.timeout(115000)});
  if(!response.ok)throw new Error(`Forecast service returned HTTP ${response.status}`);
  return privileged.runDemandForecast.response.parse(await response.json());
}

async function runDemandLocal(_args: ForecastRequest): Promise<ForecastResponse> {
  throw new Error("Set RETAILIQ_ML_SERVICE_URL to run demand forecasting on Vercel.");
}

type SupabaseTokenPayload={access_token?:unknown;refresh_token?:unknown;expires_in?:unknown;error_description?:unknown;msg?:unknown;message?:unknown};
function supabaseError(payload:SupabaseTokenPayload,status:number){
  if(typeof payload.error_description==="string"&&payload.error_description.trim())return payload.error_description;
  if(typeof payload.msg==="string"&&payload.msg.trim())return payload.msg;
  if(typeof payload.message==="string"&&payload.message.trim())return payload.message;
  return `Supabase authentication failed (HTTP ${status}).`;
}
async function readSupabasePayload(response:Response):Promise<SupabaseTokenPayload>{try{return await response.json() as SupabaseTokenPayload}catch{return{}}}

const PRODUCT_IMAGE_BUCKET="product-images";
function storageObjectUrl(path:string){return `${supabaseConfig().url}/storage/v1/object/${PRODUCT_IMAGE_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`}
function signedStorageUrl(value:string){if(value.startsWith("https://")||value.startsWith("http://"))return value;if(value.startsWith("/storage/v1/"))return `${supabaseConfig().url}${value}`;if(value.startsWith("/object/"))return `${supabaseConfig().url}/storage/v1${value}`;return ""}
async function signProductImage(accessToken:string,path:string):Promise<{ready:boolean;url:string}>{
  const response=await fetch(`${supabaseConfig().url}/storage/v1/object/sign/${PRODUCT_IMAGE_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`,{method:"POST",headers:{apikey:supabaseConfig().anonKey,authorization:`Bearer ${accessToken}`,"content-type":"application/json"},body:JSON.stringify({expiresIn:3600}),signal:AbortSignal.timeout(12000)});
  if(response.status===404)return{ready:false,url:""};
  if(!response.ok)return{ready:true,url:""};
  const payload=await response.json() as {signedURL?:unknown;signedUrl?:unknown};
  const signed=typeof payload.signedURL==="string"?payload.signedURL:typeof payload.signedUrl==="string"?payload.signedUrl:"";
  return{ready:true,url:signedStorageUrl(signed)};
}

type ManagedTableSpec={name:string;key:string[];updatedAt?:string};
type MigrationTableReport={table:string;rows_read:number;inserted:number;skipped_existing:number;conflicts_kept_newer:number;updated_from_managed:number;excluded:number;error:string|null};
const MANAGED_TABLES:ManagedTableSpec[]=[
  {name:"outlets",key:["id"]},
  {name:"categories",key:["id"]},
  {name:"profiles",key:["id"],updatedAt:"updated_at"},
  {name:"products",key:["id"]},
  {name:"customers",key:["id"]},
  // Outlet assignments are identified by the relationship itself. The managed
  // store has a surrogate `id`, while older Supabase installs use the
  // (user_id, outlet_id) composite primary key with no `id` column.
  {name:"user_outlets",key:["user_id","outlet_id"]},
  {name:"invoice_sequences",key:["day_key"]},
  {name:"return_sequences",key:["day_key"]},
  {name:"bills",key:["id"]},
  {name:"bill_items",key:["id"]},
  {name:"returns",key:["id"]},
  {name:"wastage",key:["id"]},
  {name:"outlet_costs",key:["id"],updatedAt:"updated_at"},
  {name:"anomaly_events",key:["id"]},
  {name:"intelligence_runs",key:["id"]},
  {name:"forecast_runs",key:["id"]},
  {name:"demand_forecasts",key:["id"]},
  {name:"workforce_settings",key:["id"],updatedAt:"updated_at"},
  {name:"staff_plans",key:["id"]},
  {name:"inventory_settings",key:["id"],updatedAt:"updated_at"},
  {name:"inventory",key:["id"],updatedAt:"updated_at"},
  {name:"inventory_movements",key:["id"]},
  {name:"inventory_receipts",key:["id"]},
  {name:"inventory_receipt_items",key:["id"]},
  {name:"inventory_transfers",key:["id"]},
  {name:"inventory_transfer_items",key:["id"]},
  {name:"offers",key:["id"],updatedAt:"updated_at"},
  {name:"business_insights",key:["id"],updatedAt:"updated_at"},
  {name:"audit_logs",key:["id"]},
];
const DATE_COLUMNS=new Set(["created_at","updated_at","last_login_at","bill_timestamp","return_timestamp","wastage_timestamp","event_timestamp","started_at","completed_at","trained_at","generated_at","forecast_timestamp","receipt_date"]);
const BOOLEAN_COLUMNS=new Set(["is_active","restockable","allow_negative_stock"]);
const RETIRED_CUSTOMER_IDS=new Set(["CUS001","CUS002","CUS003","CUS004","CUS005","CUS006","CUS007","CUS008","CUS009","CUS010"]);
function isRetiredManagedRow(table:string,row:Record<string,unknown>){
  const idValue=typeof row.id==="string"?row.id:"";
  if(/^(BILL|RET|WST|COST)_DEMO_/i.test(idValue))return true;
  if(table==="customers"&&RETIRED_CUSTOMER_IDS.has(idValue))return true;
  if(table==="profiles"&&idValue.startsWith("PENDING_"))return true;
  if(table==="user_outlets"&&typeof row.user_id==="string"&&row.user_id.startsWith("PENDING_"))return true;
  const references=[row.reference_id,row.bill_id];
  return references.some(value=>typeof value==="string"&&/^(BILL|RET|WST|COST)_DEMO_/i.test(value));
}
function normalizeManagedRow(row:Record<string,unknown>){
  const normalized:Record<string,unknown>={};
  for(const [column,value] of Object.entries(row)){
    if(value===undefined)continue;
    if(BOOLEAN_COLUMNS.has(column)&&typeof value==="number"){normalized[column]=value!==0;continue;}
    if(DATE_COLUMNS.has(column)&&typeof value==="number"&&Number.isFinite(value)){normalized[column]=new Date(value).toISOString();continue;}
    normalized[column]=value;
  }
  return normalized;
}
function rowKey(row:Record<string,unknown>,columns:string[]){return columns.map(column=>String(row[column]??"")).join("\u001f")}
function parseInstant(value:unknown){if(typeof value!=="string"&&typeof value!=="number")return null;const parsed=typeof value==="number"?value:Date.parse(value);return Number.isFinite(parsed)?parsed:null}
function chunks<T>(rows:T[],size:number){const result:T[][]=[];for(let index=0;index<rows.length;index+=size)result.push(rows.slice(index,index+size));return result}

export const privilegedHandlers = definePrivilegedHandlers(privileged, {
  async runIsolationForest(args) {
    const remote = process.env.RETAILIQ_ML_SERVICE_URL?.trim();
    return remote ? runRemote(args, remote) : runLocal(args);
  },
  async runDemandForecast(args){
    const remote=process.env.RETAILIQ_ML_SERVICE_URL?.trim();
    return remote?runDemandRemote(args,remote):runDemandLocal(args);
  },
  async getSupabaseAuthConfig(){
    const redirectUrl=process.env.RETAILIQ_AUTH_REDIRECT_URL?.trim()??"";
    const config=supabaseConfig();
    return{configured:Boolean(config.url&&config.anonKey),supabase_url:config.url,anon_key:config.anonKey,redirect_url:redirectUrl};
  },
  async signInWithSupabase(args){
    try{
      const response=await fetch(`${supabaseConfig().url}/auth/v1/token?grant_type=password`,{method:"POST",headers:{"content-type":"application/json",apikey:supabaseConfig().anonKey},body:JSON.stringify({email:args.email,password:args.password}),signal:AbortSignal.timeout(12000)});
      const payload=await readSupabasePayload(response);
      if(!response.ok)return{ok:false,access_token:"",refresh_token:"",expires_in:3600,error:supabaseError(payload,response.status)};
      if(typeof payload.access_token!=="string"||typeof payload.refresh_token!=="string")return{ok:false,access_token:"",refresh_token:"",expires_in:3600,error:"Supabase returned an invalid sign-in session."};
      return{ok:true,access_token:payload.access_token,refresh_token:payload.refresh_token,expires_in:typeof payload.expires_in==="number"&&payload.expires_in>0?Math.floor(payload.expires_in):3600,error:""};
    }catch{return{ok:false,access_token:"",refresh_token:"",expires_in:3600,error:"Supabase could not be reached from the application service. Please try again."}}
  },
  async refreshSupabaseSession(args){
    try{
      const response=await fetch(`${supabaseConfig().url}/auth/v1/token?grant_type=refresh_token`,{method:"POST",headers:{"content-type":"application/json",apikey:supabaseConfig().anonKey},body:JSON.stringify({refresh_token:args.refresh_token}),signal:AbortSignal.timeout(12000)});
      const payload=await readSupabasePayload(response);
      if(!response.ok)return{ok:false,access_token:"",refresh_token:"",expires_in:3600,error:supabaseError(payload,response.status)};
      if(typeof payload.access_token!=="string"||typeof payload.refresh_token!=="string")return{ok:false,access_token:"",refresh_token:"",expires_in:3600,error:"Supabase returned an invalid refreshed session."};
      return{ok:true,access_token:payload.access_token,refresh_token:payload.refresh_token,expires_in:typeof payload.expires_in==="number"&&payload.expires_in>0?Math.floor(payload.expires_in):3600,error:""};
    }catch{return{ok:false,access_token:"",refresh_token:"",expires_in:3600,error:"Supabase could not refresh this session."}}
  },
  async recoverSupabasePassword(args){
    try{
      const response=await fetch(`${supabaseConfig().url}/auth/v1/recover`,{method:"POST",headers:{"content-type":"application/json",apikey:supabaseConfig().anonKey},body:JSON.stringify({email:args.email,redirect_to:args.redirect_url}),signal:AbortSignal.timeout(12000)});
      if(response.ok)return{ok:true,error:""};
      return{ok:false,error:supabaseError(await readSupabasePayload(response),response.status)};
    }catch{return{ok:false,error:"Supabase could not be reached from the application service. Please try again."}}
  },
  async updateSupabasePassword(args){
    try{
      const response=await fetch(`${supabaseConfig().url}/auth/v1/user`,{method:"PUT",headers:{"content-type":"application/json",apikey:supabaseConfig().anonKey,authorization:`Bearer ${args.access_token}`},body:JSON.stringify({password:args.password}),signal:AbortSignal.timeout(12000)});
      if(response.ok)return{ok:true,error:""};
      return{ok:false,error:supabaseError(await readSupabasePayload(response),response.status)};
    }catch{return{ok:false,error:"Supabase could not be reached from the application service. Please try again."}}
  },
  async signOutSupabase(args){
    try{await fetch(`${supabaseConfig().url}/auth/v1/logout`,{method:"POST",headers:{apikey:supabaseConfig().anonKey,authorization:`Bearer ${args.access_token}`},signal:AbortSignal.timeout(12000)})}catch{/* Local sign-out still completes if Supabase is unavailable. */}
    return{ok:true};
  },
  async provisionSupabaseEmployee(args){
    const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()??process.env.RETAILIQ_SUPABASE_SERVICE_ROLE_KEY?.trim()??"";
    const baseUrl=supabaseConfig().url.replace(/\/$/,"");
    const adminHeaders=serviceKey?{apikey:serviceKey,authorization:`Bearer ${serviceKey}`,"content-type":"application/json"}:null;
    const ownerHeaders={apikey:supabaseConfig().anonKey,authorization:`Bearer ${args.owner_access_token}`,"content-type":"application/json"};
    const suppliedUserId=args.auth_user_id.trim();
    try{
      let userId="";
      let invited=false;
      if(suppliedUserId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedUserId))return{ok:false,configured:Boolean(adminHeaders),user_id:"",invited:false,error:"Enter the complete Supabase User UID shown in Authentication > Users."};
      if(adminHeaders){
        if(suppliedUserId){
          const userResponse=await fetch(`${baseUrl}/auth/v1/admin/users/${encodeURIComponent(suppliedUserId)}`,{headers:adminHeaders,signal:AbortSignal.timeout(12000)});
          if(!userResponse.ok)return{ok:false,configured:true,user_id:"",invited:false,error:"That Supabase User UID was not found."};
          const supplied=await userResponse.json() as {id?:unknown;email?:unknown};
          if(typeof supplied.id!=="string"||typeof supplied.email!=="string"||supplied.email.toLowerCase()!==args.email.toLowerCase())return{ok:false,configured:true,user_id:"",invited:false,error:"That Supabase user has a different email. Copy the UID from the matching email row."};
          userId=supplied.id;
        }else{
          const usersResponse=await fetch(`${baseUrl}/auth/v1/admin/users?page=1&per_page=1000`,{headers:adminHeaders,signal:AbortSignal.timeout(12000)});
          if(usersResponse.ok){
            const payload=await usersResponse.json() as {users?:Array<{id?:unknown;email?:unknown}>};
            const existing=payload.users?.find(item=>typeof item.email==="string"&&item.email.toLowerCase()===args.email.toLowerCase());
            if(typeof existing?.id==="string")userId=existing.id;
          }
          if(!userId){
            if(!args.send_invite)return{ok:false,configured:true,user_id:"",invited:false,error:"No Supabase Auth user matches this email. Create the user in Supabase Dashboard, then save again."};
            const inviteResponse=await fetch(`${baseUrl}/auth/v1/invite`,{method:"POST",headers:adminHeaders,body:JSON.stringify({email:args.email,data:{full_name:args.full_name}}),signal:AbortSignal.timeout(12000)});
            const invitePayload=await inviteResponse.json() as {id?:unknown;user?:{id?:unknown};message?:unknown;msg?:unknown};
            if(!inviteResponse.ok)return{ok:false,configured:true,user_id:"",invited:false,error:typeof invitePayload.message==="string"?invitePayload.message:typeof invitePayload.msg==="string"?invitePayload.msg:`Supabase invitation failed (HTTP ${inviteResponse.status}).`};
            userId=typeof invitePayload.id==="string"?invitePayload.id:typeof invitePayload.user?.id==="string"?invitePayload.user.id:"";
            invited=true;
          }
        }
      }else if(suppliedUserId){
        userId=suppliedUserId;
        const profileLookup=await fetch(`${baseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,email&limit=1`,{headers:ownerHeaders,signal:AbortSignal.timeout(12000)});
        if(profileLookup.status===401||profileLookup.status===403)return{ok:false,configured:false,user_id:"",invited:false,error:"Your owner session cannot link employees. Sign out, sign in again, then retry."};
        if(!profileLookup.ok)return{ok:false,configured:false,user_id:"",invited:false,error:"The employee profile could not be checked in Supabase. Please try again."};
        const profiles=await profileLookup.json() as Array<{id?:unknown;email?:unknown}>;
        const profile=profiles[0];
        if(profile&&typeof profile.email==="string"&&profile.email.toLowerCase()!==args.email.toLowerCase())return{ok:false,configured:false,user_id:"",invited:false,error:"That Supabase user has a different email. Copy the UID from the matching email row."};
      }else{
        const profileLookup=await fetch(`${baseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(args.email)}&select=id,email&limit=2`,{headers:ownerHeaders,signal:AbortSignal.timeout(12000)});
        if(profileLookup.status===401||profileLookup.status===403)return{ok:false,configured:false,user_id:"",invited:false,error:"Your owner session cannot link employees. Sign out, sign in again, then retry."};
        if(!profileLookup.ok)return{ok:false,configured:false,user_id:"",invited:false,error:"The employee profile could not be checked in Supabase. Please try again."};
        const profiles=await profileLookup.json() as Array<{id?:unknown;email?:unknown}>;
        const match=profiles.find(item=>typeof item.email==="string"&&item.email.toLowerCase()===args.email.toLowerCase());
        if(typeof match?.id!=="string")return{ok:false,configured:false,user_id:"",invited:false,error:"The Auth user exists without a RetailIQ profile. Copy its User UID from Supabase Authentication > Users, paste it here, and link again."};
        userId=match.id;
      }
      if(!userId)return{ok:false,configured:Boolean(adminHeaders),user_id:"",invited:false,error:"Supabase did not return a user ID."};
      const headers=adminHeaders??ownerHeaders;
      const profileResponse=await fetch(`${baseUrl}/rest/v1/profiles?on_conflict=id`,{method:"POST",headers:{...headers,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({id:userId,full_name:args.full_name,email:args.email,role:args.role,is_active:true}),signal:AbortSignal.timeout(12000)});
      if(!profileResponse.ok)return{ok:false,configured:Boolean(adminHeaders),user_id:userId,invited,error:profileResponse.status===409?"That User UID could not be linked. Confirm it belongs to the employee in Supabase Authentication > Users.":`Auth user exists, but the RetailIQ profile could not be linked (HTTP ${profileResponse.status}).`};
      const clearResponse=await fetch(`${baseUrl}/rest/v1/user_outlets?user_id=eq.${encodeURIComponent(userId)}`,{method:"DELETE",headers,signal:AbortSignal.timeout(12000)});
      if(!clearResponse.ok)return{ok:false,configured:Boolean(adminHeaders),user_id:userId,invited,error:"The employee was linked, but outlet assignments could not be replaced."};
      if(args.outlet_ids.length){
        // Existing RetailIQ Supabase installs use one of two compatible
        // user_outlets schemas: the original composite key, or the cutover
        // schema with a required id column. Try the shared shape first, then
        // retry with UUID row ids only when that schema requires them.
        const outletRows=args.outlet_ids.map(outletId=>({user_id:userId,outlet_id:outletId}));
        let outletResponse=await fetch(`${baseUrl}/rest/v1/user_outlets`,{method:"POST",headers:{...headers,Prefer:"return=minimal"},body:JSON.stringify(outletRows),signal:AbortSignal.timeout(12000)});
        if(!outletResponse.ok){
          outletResponse=await fetch(`${baseUrl}/rest/v1/user_outlets`,{method:"POST",headers:{...headers,Prefer:"return=minimal"},body:JSON.stringify(outletRows.map(row=>({id:crypto.randomUUID(),...row}))),signal:AbortSignal.timeout(12000)});
        }
        if(!outletResponse.ok)return{ok:false,configured:Boolean(adminHeaders),user_id:userId,invited,error:"The employee was linked, but outlet assignments could not be saved."};
      }
      return{ok:true,configured:Boolean(adminHeaders),user_id:userId,invited,error:""};
    }catch{return{ok:false,configured:Boolean(adminHeaders),user_id:"",invited:false,error:"Supabase employee provisioning could not be completed. Try again."}}
  },

  async uploadSupabaseProductImage(args){
    try{
      const bytes=Buffer.from(args.data_base64,"base64");
      const response=await fetch(storageObjectUrl(args.storage_path),{method:"POST",headers:{apikey:supabaseConfig().anonKey,authorization:`Bearer ${args.access_token}`,"content-type":args.mime_type,"cache-control":"3600","x-upsert":"false"},body:bytes,signal:AbortSignal.timeout(25000)});
      if(response.status===404)return{ok:false,storage_ready:false,signed_url:"",error:"Image storage is not set up yet"};
      if(!response.ok){const detail=await response.text().catch(()=>"");const missing=/bucket not found|not found/i.test(detail);return{ok:false,storage_ready:!missing,signed_url:"",error:missing?"Image storage is not set up yet":"Image upload failed. Please try again."};}
      const signed=await signProductImage(args.access_token,args.storage_path);
      return{ok:true,storage_ready:signed.ready,signed_url:signed.url,error:""};
    }catch{return{ok:false,storage_ready:true,signed_url:"",error:"Image upload failed. Please try again."}}
  },
  async signSupabaseProductImages(args){
    if(args.storage_paths.length===0)return{storage_ready:true,urls:{}};
    const results=await Promise.all(args.storage_paths.map(async path=>({path,...await signProductImage(args.access_token,path)})));
    return{storage_ready:results.every(item=>item.ready),urls:Object.fromEntries(results.filter(item=>item.url).map(item=>[item.path,item.url]))};
  },
  async supabaseCheckout(args){
    const config=supabaseConfig();
    if(!config.url||!config.anonKey)return{ok:false,bill_number:"",error:"Supabase is not configured."};
    try{
      const response=await fetch(`${config.url}/rest/v1/rpc/retailiq_complete_bill`,{method:"POST",headers:{apikey:config.anonKey,authorization:`Bearer ${args.access_token}`,"content-type":"application/json"},body:JSON.stringify({p_bill:args.bill,p_items:args.items,p_movements:args.movements}),signal:AbortSignal.timeout(30000)});
      const payload=await response.json().catch(()=>null) as {ok?:unknown;bill_number?:unknown;error?:unknown}|null;
      if(!response.ok)return{ok:false,bill_number:"",error:response.status===404?"The Supabase checkout function is not installed. Run supabase/go_live_cutover.sql in the Supabase SQL Editor.":typeof payload?.error==="string"?payload.error:`Checkout failed (HTTP ${response.status}).`};
      return{ok:payload?.ok===true,bill_number:typeof payload?.bill_number==="string"?payload.bill_number:"",error:typeof payload?.error==="string"?payload.error:""};
    }catch{return{ok:false,bill_number:"",error:"Supabase could not be reached during checkout."};}
  },
  async migrateManagedData(args){
    const startedAt=new Date();
    const config=supabaseConfig();
    const blank=(table:string):MigrationTableReport=>({table,rows_read:0,inserted:0,skipped_existing:0,conflicts_kept_newer:0,updated_from_managed:0,excluded:0,error:null});
    const emptyResult=(error:string)=>({status:"failed" as const,started_at:startedAt.toISOString(),completed_at:new Date().toISOString(),source:"Managed store snapshot",rows_read:0,inserted:0,skipped_existing:0,conflicts_kept_newer:0,updated_from_managed:0,excluded:0,tables:MANAGED_TABLES.map(spec=>({...blank(spec.name),error})),error});
    if(!config.url||!config.anonKey)return emptyResult("Supabase is not configured on the application server.");
    const dbPath=[join(process.cwd(),"app.db"),join(process.cwd(),"..","app.db")].find(existsSync);
    if(!dbPath)return emptyResult("The managed-store snapshot is not available on this application server.");
    const headers={apikey:config.anonKey,authorization:`Bearer ${args.access_token}`};
    const readRemote=async(table:string)=>{
      const rows:Array<Record<string,unknown>>=[];
      for(let offset=0;;offset+=1000){
        const response=await fetch(`${config.url}/rest/v1/${table}?select=*`,{headers:{...headers,Range:`${offset}-${offset+999}`},signal:AbortSignal.timeout(30000)});
        if(!response.ok)throw new Error(`Supabase could not read ${table} (HTTP ${response.status}).`);
        const page=await response.json() as Array<Record<string,unknown>>;
        rows.push(...page);
        if(page.length<1000)break;
      }
      return rows;
    };
    const SQL=await getSqlJsRuntime();
    const managed=new Database(new SQL.Database(readFileSync(dbPath)));
    const reports:MigrationTableReport[]=[];
    try{
      const available=new Set((managed.query("select name from sqlite_master where type='table'").all() as Array<{name:string}>).map(row=>row.name));
      for(const spec of MANAGED_TABLES){
        const report=blank(spec.name);
        reports.push(report);
        if(!available.has(spec.name)){report.error="This table is not present in the managed snapshot.";continue;}
        try{
          const sourceRaw=managed.query(`select * from "${spec.name}"`).all() as Array<Record<string,unknown>>;
          report.rows_read=sourceRaw.length;
          const keyColumns=spec.key;
          let targetHasUserOutletId=false;
          if(spec.name==="user_outlets"){
            const idProbe=await fetch(`${config.url}/rest/v1/user_outlets?select=id&limit=0`,{headers,signal:AbortSignal.timeout(12000)});
            targetHasUserOutletId=idProbe.ok;
          }
          const sourceRows:Record<string,unknown>[]=[];
          for(const raw of sourceRaw){
            if(isRetiredManagedRow(spec.name,raw)){report.excluded+=1;continue;}
            const row=normalizeManagedRow(raw);
            if(spec.name==="user_outlets"){
              // A user/outlet assignment has a composite identity. Never carry a
              // managed-store surrogate id into Supabase: the target may not
              // have that column, or the same id may belong to another pair.
              if(targetHasUserOutletId)row.id=crypto.randomUUID();else delete row.id;
            }
            sourceRows.push(row);
          }
          const targetRows=await readRemote(spec.name);
          const targetByKey=new Map(targetRows.map(row=>[rowKey(row,keyColumns),row]));
          const inserts:Record<string,unknown>[]=[];
          const updates:Array<{row:Record<string,unknown>;keyValues:Record<string,unknown>}>=[];
          for(const row of sourceRows){
            const target=targetByKey.get(rowKey(row,keyColumns));
            if(!target){inserts.push(row);continue;}
            if(!spec.updatedAt){report.skipped_existing+=1;continue;}
            const sourceTime=parseInstant(row[spec.updatedAt]);
            const targetTime=parseInstant(target[spec.updatedAt]);
            if(sourceTime===null||targetTime===null||sourceTime===targetTime){report.skipped_existing+=1;continue;}
            report.conflicts_kept_newer+=1;
            if(sourceTime>targetTime){updates.push({row,keyValues:Object.fromEntries(keyColumns.map(column=>[column,row[column]]))});report.updated_from_managed+=1;}
          }
          if(spec.name==="user_outlets"||spec.name==="invoice_sequences"||spec.name==="return_sequences"){
            // These compact operational tables have intentionally restrictive
            // SELECT policies in older RetailIQ Supabase installs. Insert one
            // logical row at a time with a minimal response: a unique conflict
            // proves the row already exists without requiring read access.
            for(const row of inserts){
              const response=await fetch(`${config.url}/rest/v1/${spec.name}`,{method:"POST",headers:{...headers,"content-type":"application/json",Prefer:"return=minimal"},body:JSON.stringify(row),signal:AbortSignal.timeout(30000)});
              if(response.ok){report.inserted+=1;continue;}
              const detail=await response.json().catch(()=>null) as {code?:unknown;message?:unknown}|null;
              if(response.status===409&&detail?.code==="23505"){report.skipped_existing+=1;continue;}
              const message=typeof detail?.message==="string"?detail.message.slice(0,240):"";
              throw new Error(`Supabase could not insert ${spec.name} (HTTP ${response.status})${message?`: ${message}`:"."}`);
            }
          }else for(const batch of chunks(inserts,100)){
            const query=`?on_conflict=${keyColumns.join(",")}`;
            const response=await fetch(`${config.url}/rest/v1/${spec.name}${query}`,{method:"POST",headers:{...headers,"content-type":"application/json",Prefer:"resolution=ignore-duplicates,return=representation"},body:JSON.stringify(batch),signal:AbortSignal.timeout(30000)});
            if(!response.ok)throw new Error(`Supabase could not insert ${spec.name} (HTTP ${response.status}).`);
            const insertedRows=await response.json() as Array<Record<string,unknown>>;
            report.inserted+=insertedRows.length;
            report.skipped_existing+=Math.max(0,batch.length-insertedRows.length);
          }
          for(const update of updates){
            const filter=keyColumns.map(column=>`${column}=eq.${encodeURIComponent(String(update.keyValues[column]??""))}`).join("&");
            const response=await fetch(`${config.url}/rest/v1/${spec.name}?${filter}`,{method:"PATCH",headers:{...headers,"content-type":"application/json",Prefer:"return=minimal"},body:JSON.stringify(update.row),signal:AbortSignal.timeout(30000)});
            if(!response.ok)throw new Error(`Supabase could not keep the newer ${spec.name} row (HTTP ${response.status}).`);
          }
        }catch(error){report.error=error instanceof Error?error.message:`${spec.name} could not be migrated.`;}
      }
    }finally{managed.close();}
    const totals=reports.reduce((sum,row)=>({rows_read:sum.rows_read+row.rows_read,inserted:sum.inserted+row.inserted,skipped_existing:sum.skipped_existing+row.skipped_existing,conflicts_kept_newer:sum.conflicts_kept_newer+row.conflicts_kept_newer,updated_from_managed:sum.updated_from_managed+row.updated_from_managed,excluded:sum.excluded+row.excluded}),{rows_read:0,inserted:0,skipped_existing:0,conflicts_kept_newer:0,updated_from_managed:0,excluded:0});
    const failed=reports.filter(row=>row.error!==null).length;
    return{status:failed===0?"completed" as const:failed===reports.length?"failed" as const:"partial" as const,started_at:startedAt.toISOString(),completed_at:new Date().toISOString(),source:"Managed store snapshot",...totals,tables:reports,error:failed?`${failed} table${failed===1?"":"s"} could not be migrated. Review the per-table report, then safely run the migration again.`:""};
  },
  async supabaseData(args){
    const config=supabaseConfig();
    if(!config.url||!config.anonKey)throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.");
    const headers={apikey:config.anonKey,authorization:`Bearer ${args.access_token}`};
    const assertName=(value:string)=>{if(!/^[a-z][a-z0-9_]*$/i.test(value))throw new Error("Invalid database identifier.");return value};
    const fetchRows=async(table:string)=>{
      const rows:Array<Record<string,unknown>>=[];
      for(let offset=0;;offset+=1000){
        const response=await fetch(`${config.url}/rest/v1/${assertName(table)}?select=*`,{headers:{...headers,Range:`${offset}-${offset+999}`},signal:AbortSignal.timeout(30000)});
        if(!response.ok)throw new Error(`Supabase read failed for ${table} (HTTP ${response.status}).`);
        const page=await response.json() as Array<Record<string,unknown>>;rows.push(...page);if(page.length<1000)break;
      }
      return rows;
    };
    const makeDb=async(defs:Array<{name:string;columns:Array<{name:string;kind:"number"|"boolean"|"date"|"string"}>}>)=>{
      const SQL=await getSqlJsRuntime();
      const db=new Database(new SQL.Database());
      for(const def of defs){
        const name=assertName(def.name);const cols=def.columns.map(column=>`"${assertName(column.name)}" ${column.kind==="number"||column.kind==="boolean"?"REAL":"TEXT"}`).join(",");
        db.run(`create table "${name}" (${cols})`);
        const rows=await fetchRows(name);if(rows.length){const names=def.columns.map(column=>column.name);const statement=db.prepare(`insert into "${name}" (${names.map(column=>`"${column}"`).join(",")}) values (${names.map(()=>"?").join(",")})`);for(const row of rows)statement.run(...names.map(column=>{const value=row[column];return typeof value==="boolean"?(value?1:0):value??null}) as Array<string|number|boolean|null>);}
      }
      return db;
    };
    const results:Array<Array<Record<string,unknown>>>=[];
    for(const operation of args.operations){
      const table=assertName(operation.table);const def=operation.tables.find(item=>item.name===table);if(!def)throw new Error("Missing table definition.");
      if(operation.kind==="select"){
        const db=await makeDb(operation.tables);try{const rows=db.query(operation.sql??"").all(...(operation.params??[])) as Array<Record<string,unknown>>;results.push(rows);}finally{db.close();}continue;
      }
      if(operation.kind==="insert"){
        if(operation.conflict?.length&&Object.keys(operation.expressions??{}).length){
          const existing=await fetchRows(table);const primary=def.columns[0]?.name;if(!primary)throw new Error("Missing primary key definition.");const changed:Array<Record<string,unknown>>=[];
          for(const row of operation.rows??[]){
            const match=existing.find(candidate=>operation.conflict?.every(column=>candidate[column]===row[column]));
            if(!match){const response=await fetch(`${config.url}/rest/v1/${table}`,{method:"POST",headers:{...headers,"content-type":"application/json",Prefer:"return=representation"},body:JSON.stringify(row),signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`Supabase insert failed for ${table} (HTTP ${response.status}).`);changed.push(...await response.json() as Array<Record<string,unknown>>);continue;}
            const db=await makeDb([def]);const values:Record<string,unknown>={...(operation.values??{})};for(const [column,expression] of Object.entries(operation.expressions??{})){const calculated=db.query(`select ${expression.sql} as value from "${table}" where "${assertName(primary)}"=?`).get(...expression.params,String(match[primary])) as {value?:unknown}|null;values[assertName(column)]=calculated?.value??null;}db.close();
            const response=await fetch(`${config.url}/rest/v1/${table}?${assertName(primary)}=eq.${encodeURIComponent(String(match[primary]))}`,{method:"PATCH",headers:{...headers,"content-type":"application/json",Prefer:"return=representation"},body:JSON.stringify(values),signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`Supabase upsert failed for ${table} (HTTP ${response.status}).`);changed.push(...await response.json() as Array<Record<string,unknown>>);
          }
          results.push(changed);continue;
        }
        const query=operation.conflict?.length?`?on_conflict=${operation.conflict.map(assertName).join(",")}`:"";
        const prefer=operation.ignoreConflict?"resolution=ignore-duplicates,return=representation":operation.conflict?.length?"resolution=merge-duplicates,return=representation":"return=representation";
        const response=await fetch(`${config.url}/rest/v1/${table}${query}`,{method:"POST",headers:{...headers,"content-type":"application/json",Prefer:prefer},body:JSON.stringify(operation.rows??[]),signal:AbortSignal.timeout(30000)});
        if(!response.ok)throw new Error(`Supabase insert failed for ${table} (HTTP ${response.status}): ${(await response.text()).slice(0,240)}`);
        results.push(await response.json() as Array<Record<string,unknown>>);continue;
      }
      const db=await makeDb([def]);
      const primary=def.columns[0]?.name;if(!primary){db.close();throw new Error("Missing primary key definition.");}
      const matching=db.query(`select "${assertName(primary)}" as key from "${table}"${operation.sql?` where ${operation.sql}`:""}`).all(...(operation.params??[])) as Array<{key:unknown}>;
      const changed:Array<Record<string,unknown>>=[];
      for(const match of matching){
        const key=String(match.key);const target=`${config.url}/rest/v1/${table}?${assertName(primary)}=eq.${encodeURIComponent(key)}`;
        if(operation.kind==="delete"){
          const response=await fetch(target,{method:"DELETE",headers:{...headers,Prefer:"return=representation"},signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`Supabase delete failed for ${table} (HTTP ${response.status}).`);changed.push(...await response.json() as Array<Record<string,unknown>>);continue;
        }
        const values:Record<string,unknown>={...(operation.values??{})};
        for(const [column,expression] of Object.entries(operation.expressions??{})){const row=db.query(`select ${expression.sql} as value from "${table}" where "${assertName(primary)}"=?`).get(...expression.params,key) as {value?:unknown}|null;values[assertName(column)]=row?.value??null;}
        const response=await fetch(target,{method:"PATCH",headers:{...headers,"content-type":"application/json",Prefer:"return=representation"},body:JSON.stringify(values),signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`Supabase update failed for ${table} (HTTP ${response.status}): ${(await response.text()).slice(0,240)}`);changed.push(...await response.json() as Array<Record<string,unknown>>);
      }
      db.close();results.push(changed);
    }
    return{results};
  },
  async verifySupabaseUser(args){
    const baseUrl=supabaseConfig().url.replace(/\/$/,"");
    const anonKey=supabaseConfig().anonKey;
    const empty={valid:false,user_id:"",email:"",full_name:"",role:null,is_active:false,outlet_ids:[]};
    if(!baseUrl||!anonKey)return empty;
    const headers={apikey:anonKey,authorization:`Bearer ${args.access_token}`};
    const userResponse=await fetch(`${baseUrl}/auth/v1/user`,{headers,signal:AbortSignal.timeout(12000)});
    if(!userResponse.ok)return empty;
    const user=await userResponse.json() as {id?:unknown;email?:unknown;user_metadata?:{full_name?:unknown}};
    if(typeof user.id!=="string")return empty;
    const profileResponse=await fetch(`${baseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,full_name,email,role,is_active`,{headers,signal:AbortSignal.timeout(12000)});
    if(!profileResponse.ok)return empty;
    const profiles=await profileResponse.json() as Array<{id?:unknown;full_name?:unknown;email?:unknown;role?:unknown;is_active?:unknown}>;
    const profile=profiles[0];
    if(!profile||!(["owner","manager","cashier"] as const).includes(profile.role as "owner"|"manager"|"cashier"))return empty;
    const outletResponse=await fetch(`${baseUrl}/rest/v1/user_outlets?user_id=eq.${encodeURIComponent(user.id)}&select=outlet_id`,{headers,signal:AbortSignal.timeout(12000)});
    const outletRows=outletResponse.ok?await outletResponse.json() as Array<{outlet_id?:unknown}>:[];
    const email=typeof profile.email==="string"?profile.email:typeof user.email==="string"?user.email:"";
    const metadataName=typeof user.user_metadata?.full_name==="string"?user.user_metadata.full_name:"";
    const fullName=typeof profile.full_name==="string"&&profile.full_name.trim()?profile.full_name:metadataName||email.split("@")[0]||"RetailIQ user";
    return{valid:true,user_id:user.id,email,full_name:fullName,role:profile.role as "owner"|"manager"|"cashier",is_active:profile.is_active===true,outlet_ids:outletRows.flatMap(row=>typeof row.outlet_id==="string"?[row.outlet_id]:[])};
  },
});
