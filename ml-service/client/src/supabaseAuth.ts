import { createActionClient } from "@hatch/space-sdk/client";
import type { Actions } from "../../server/src/actions";
import { safeLocalStorage } from "./safeStorage";

export type SupabaseAuthConfig={configured:boolean;supabase_url:string;anon_key:string;redirect_url:string};
type StoredSession={access_token:string;refresh_token:string;expires_at:number};
type TokenResult={ok:boolean;access_token:string;refresh_token:string;expires_in:number;error:string};
export type AuthCallbackType="recovery"|"invite"|"authenticated"|null;

const SESSION_KEY="retailiq.supabase.session";
const authApi=createActionClient<typeof Actions>({endpoint:"/api/actions"});
let activeConfig:SupabaseAuthConfig|null=null;
let activeSession:StoredSession|null=null;
let refreshInFlight:Promise<StoredSession|null>|null=null;

function sessionFrom(data:TokenResult):StoredSession|null{
  if(!data.ok||!data.access_token||!data.refresh_token)return null;
  return{access_token:data.access_token,refresh_token:data.refresh_token,expires_at:Date.now()+data.expires_in*1000};
}

export function setAuthConfig(config:SupabaseAuthConfig){activeConfig=config.configured?config:null}
export function getStoredSession():StoredSession|null{if(activeSession)return activeSession;try{const raw=safeLocalStorage.getItem(SESSION_KEY);if(!raw)return null;const value=JSON.parse(raw) as Partial<StoredSession>;if(typeof value.access_token!=="string"||typeof value.refresh_token!=="string"||typeof value.expires_at!=="number")return null;activeSession={access_token:value.access_token,refresh_token:value.refresh_token,expires_at:value.expires_at};return activeSession}catch{return null}}
export function getAccessToken(){return getStoredSession()?.access_token??""}
export function clearStoredSession(){activeSession=null;safeLocalStorage.removeItem(SESSION_KEY)}
function saveSession(session:StoredSession){activeSession=session;safeLocalStorage.setItem(SESSION_KEY,JSON.stringify(session));return session}

export async function signInWithPassword(config:SupabaseAuthConfig,email:string,password:string){
  setAuthConfig(config);
  if(!config.configured)throw new Error("Supabase Auth is not configured for this deployment.");
  const data=await authApi.signInWithSupabase({email,password});
  if(!data.ok)throw new Error(data.error||"Sign-in failed. Check your email and password, then try again.");
  const session=sessionFrom(data);
  if(!session)throw new Error("Supabase returned an invalid sign-in session. Please try again.");
  return saveSession(session);
}

export async function refreshSession(config:SupabaseAuthConfig,force=false){
  setAuthConfig(config);
  const existing=getStoredSession();
  if(!existing)return null;
  if(!force&&existing.expires_at-Date.now()>60_000)return existing;
  if(refreshInFlight)return refreshInFlight;
  refreshInFlight=(async()=>{
    try{
      const data=await authApi.refreshSupabaseSession({refresh_token:existing.refresh_token});
      if(!data.ok){clearStoredSession();return null}
      const session=sessionFrom(data);
      if(!session){clearStoredSession();return null}
      return saveSession(session);
    }catch{return existing.expires_at>Date.now()?existing:null}
  })();
  try{return await refreshInFlight}finally{refreshInFlight=null}
}

export async function ensureFreshAccessToken(){if(!activeConfig)return getAccessToken();const session=await refreshSession(activeConfig);return session?.access_token??""}

export async function sendPasswordReset(config:SupabaseAuthConfig,email:string){
  setAuthConfig(config);
  if(!config.redirect_url)throw new Error("Password recovery will be available after the app has a public callback URL. Sign in with your current password or ask an administrator to reset it in Supabase.");
  const result=await authApi.recoverSupabasePassword({email,redirect_url:config.redirect_url});
  if(!result.ok)throw new Error(result.error||"We could not start password recovery. Please try again.");
}

export function consumeAuthCallback():AuthCallbackType{const hash=new URLSearchParams(window.location.hash.replace(/^#/,""));const callbackType=hash.get("type");const accessToken=hash.get("access_token");const refreshToken=hash.get("refresh_token");const expiresIn=Number(hash.get("expires_in")??3600);if(!accessToken||!refreshToken)return null;saveSession({access_token:accessToken,refresh_token:refreshToken,expires_at:Date.now()+(Number.isFinite(expiresIn)?expiresIn:3600)*1000});history.replaceState(null,"",`${window.location.pathname}${window.location.search}`);return callbackType==="recovery"||callbackType==="invite"?callbackType:"authenticated"}

export async function updatePassword(config:SupabaseAuthConfig,password:string){
  setAuthConfig(config);
  const token=await ensureFreshAccessToken();
  if(!token)throw new Error("The reset link is invalid or has expired.");
  const result=await authApi.updateSupabasePassword({access_token:token,password});
  if(!result.ok)throw new Error(result.error||"The password could not be updated.");
}

export async function signOutFromSupabase(config:SupabaseAuthConfig){
  setAuthConfig(config);
  const token=getAccessToken();
  try{if(token)await authApi.signOutSupabase({access_token:token})}finally{clearStoredSession()}
}
