import { createActionClient } from "@hatch/space-sdk/client";
import type { Actions } from "../../server/src/actions";
import { ensureFreshAccessToken } from "./supabaseAuth";

const authenticatedFetch=(async(input:URL|RequestInfo,init?:RequestInit)=>{
  if(typeof init?.body!=="string")return fetch(input,init);
  try{
    const payload=JSON.parse(init.body) as {action?:unknown;args?:unknown};
    if(payload.action!=="getAuthConfig")payload.args={...(payload.args&&typeof payload.args==="object"?payload.args:{}),auth_token:await ensureFreshAccessToken()};
    return fetch(input,{...init,body:JSON.stringify(payload)});
  }catch{return fetch(input,init)}
}) as typeof globalThis.fetch;

const rawApi=createActionClient<typeof Actions>({endpoint:"/api/actions",fetch:authenticatedFetch});
type CallableKey<T>={[K in keyof T]-?:T[K] extends (...args:never[])=>unknown?K:never}[keyof T];
type PublicApi<T>={
  [K in CallableKey<T>]:T[K] extends (args:infer A)=>infer R?(args:Omit<A,"auth_token">)=>R:never
};
export const api=rawApi as unknown as PublicApi<typeof rawApi>;
export type ApiResponse<TApi,K extends keyof TApi>=TApi[K] extends (...args:never[])=>Promise<infer R>?R:never;
