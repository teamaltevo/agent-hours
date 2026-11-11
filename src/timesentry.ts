import { Client as MCPClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientMetadata, OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import Decimal from 'decimal.js';
import { boundaries, localDate, SafeError, stable, strictJSON } from './core.ts';
import { projectContext } from './projects.ts';
import type { Project } from './types.ts';

export const SERVER='https://api.timesentry.app/mcp';
export const CLIENT_ID='ff5184df-31f6-45f0-8f78-4e2000860bd6';
export const SCOPE='https://api.timesentry.app/mcp/access_as_user';
export const CALLBACK='/callback/wfxtzoFsW09G';
export function unwrap(result:any,decimalNumbers=false):any {
  if (!result||typeof result!=='object'||![undefined,false].includes(result.isError)) throw new SafeError('invalid_mcp_result');
  if (result.structuredContent!=null) {
    const value=result.structuredContent;
    return value&&typeof value==='object'&&Object.keys(value).join(',')==='result'?value.result:value;
  }
  if (!Array.isArray(result.content)||result.content.length!==1||result.content[0]?.type!=='text'||typeof result.content[0].text!=='string') throw new SafeError('invalid_mcp_result');
  return strictJSON(result.content[0].text,decimalNumbers?literal=>new Decimal(literal):undefined);
}
export function ownEmployee(result:any):string {
  const value=unwrap(result)?.employeeId;
  if (typeof value!=='string'||!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)) throw new SafeError('invalid_employee');
  return value.toLowerCase();
}
export function normalizePunches(employeeResult:any,punchesResult:any,since:string,until:string):Map<string,number> {
  boundaries(since,until); const employee=ownEmployee(employeeResult); const punches=unwrap(punchesResult,true);
  if (!Array.isArray(punches)) throw new SafeError('partial_punch_response');
  const seen=new Map<string,string>(); const days=new Map<string,Decimal>();
  for (const p of punches) {
    if (!p||typeof p.id!=='string'||!p.id||typeof p.userId!=='string'||p.userId.toLowerCase()!==employee) throw new SafeError('foreign_or_invalid_punch');
    if (typeof p.hours!=='number'&&typeof p.hours!=='string'&&!Decimal.isDecimal(p.hours)) throw new SafeError('invalid_punch_hours');
    let hours:Decimal; try { hours=new Decimal(p.hours); } catch { throw new SafeError('invalid_punch_hours'); }
    if (!hours.isFinite()||hours.isNegative()||typeof p.workDate!=='string') throw new SafeError('invalid_punch_hours');
    const day=localDate(p.workDate); if (day<since||day>until) throw new SafeError('punch_outside_period');
    const fingerprint=stable([employee,day,hours.toString()]);
    if (seen.has(p.id)) { if (seen.get(p.id)!==fingerprint) throw new SafeError('conflicting_punch'); continue; }
    seen.set(p.id,fingerprint); days.set(day,(days.get(day)??new Decimal(0)).plus(hours));
  }
  return new Map([...days].map(([day,hours])=>{const value=hours.toNumber();if(!Number.isFinite(value))throw new SafeError('invalid_punch_hours');return [day,value];}));
}
function microsoft(url:URL):boolean { return url.protocol==='https:'&&url.hostname==='login.microsoftonline.com'&&!url.username&&!url.password&&(!url.port||url.port==='443'); }
export function validateAuthorization(url:URL,redirect:string,state:string):void {
  const one=(key:string,value:string)=>url.searchParams.getAll(key).length===1&&url.searchParams.get(key)===value;
  if (!microsoft(url)||!one('client_id',CLIENT_ID)||!one('scope',SCOPE)||!one('code_challenge_method','S256')||!one('state',state)||!one('redirect_uri',redirect)||!one('response_type','code')||url.searchParams.getAll('code_challenge').length!==1||!/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('code_challenge')??'')) throw new SafeError('authorization_url_rejected');
}
/** Restricted transport: no off-origin credentials, redirects, registration or extra scopes. */
export type Fetch = (input:Parameters<typeof fetch>[0],init?:RequestInit)=>Promise<Response>;
export function guardedFetch(base:Fetch=fetch):Fetch {
  return (async (input:any,init?:RequestInit)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    const api=url.origin==='https://api.timesentry.app'&&!url.username&&!url.password;
    if (!api&&!microsoft(url)) throw new SafeError('oauth_endpoint_rejected');
    const method=init?.method??(input instanceof Request?input.method:'GET');
    if (api&&method!=='GET'&&url.href!==SERVER) throw new SafeError('oauth_endpoint_rejected');
    let options={...init,redirect:'error' as const};
    if (!api&&method==='POST') {
      if (!(init?.body instanceof URLSearchParams)||!url.pathname.endsWith('/token')) throw new SafeError('token_endpoint_rejected');
      const params=new URLSearchParams(init.body);
      if (params.get('client_id')!==CLIENT_ID||!['authorization_code','refresh_token'].includes(params.get('grant_type')??'')||params.has('client_secret')) throw new SafeError('token_request_rejected');
      params.set('scope',SCOPE); options={...options,body:params};
    }
    const response=await base(input,options);
    // Validate discovery before the SDK can act on endpoints or advertised scopes.
    if (method==='GET'&&response.ok&&url.pathname.includes('.well-known/')) {
      const meta=await response.clone().json() as any;
      for (const field of ['authorization_endpoint','token_endpoint','issuer']) if (meta[field]&&!microsoft(new URL(meta[field]))) throw new SafeError('oauth_endpoint_rejected');
      if (meta.authorization_servers&&(!Array.isArray(meta.authorization_servers)||!meta.authorization_servers.every((s:string)=>microsoft(new URL(s))))) throw new SafeError('oauth_endpoint_rejected');
    }
    return response;
  }) as Fetch;
}
export function validCallback(url:URL,state:string):boolean {
  const values=url.searchParams.getAll('state');
  if (url.pathname!==CALLBACK||values.length!==1) return false;
  const a=Buffer.from(values[0]),b=Buffer.from(state);
  return a.length===b.length&&timingSafeEqual(a,b);
}
export async function openBrowser(url:string):Promise<void> {
  const command=process.platform==='darwin'?['open',url]:process.platform==='win32'?['rundll32','url.dll,FileProtocolHandler',url]:['xdg-open',url];
  const child=Bun.spawn(command,{stdout:'ignore',stderr:'ignore'});
  if (await child.exited!==0) throw new SafeError('browser_open_failed');
}
export interface TimeSentryResult { hours:Map<string,number>; projects:Project[] }
export async function fetchTimeSentry(since:string,until:string,options:{ consent:boolean; projects:boolean; onBrowser:()=>void; signal:AbortSignal; dependencies?:{ fetch?:Fetch; openBrowser?:(url:string)=>Promise<void> } }):Promise<TimeSentryResult> {
  if (options.consent!==true) throw new SafeError('login_opt_in_required');
  boundaries(since,until); options.signal.throwIfAborted();
  const state=randomBytes(32).toString('hex'); let settled=false;
  let accept!:(code:string)=>void; let reject!:(e:Error)=>void;
  const callback=new Promise<string>((res,rej)=>{accept=res; reject=rej;});
  // Attach immediately so an early abort/error cannot become an unhandled rejection.
  void callback.catch(()=>{});
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
    const u=new URL(request.url); let valid=false;
    if (request.method==='GET'&&!settled&&validCallback(u,state)) {
      const codes=u.searchParams.getAll('code'),errors=u.searchParams.getAll('error');
      if (codes.length===1&&codes[0]&&!errors.length) { settled=true; valid=true; accept(codes[0]); }
      else if (errors.length===1&&!codes.length) { settled=true; valid=true; reject(new SafeError('sign_in_failed')); }
    }
    return new Response(valid?'Return to your terminal.':'Invalid callback.',{status:valid?200:400,headers:{'Cache-Control':'no-store','Content-Type':'text/plain'}});
  }});
  const redirect=`http://127.0.0.1:${server.port}${CALLBACK}`;
  let tokens:OAuthTokens|undefined; let verifier=''; let clientInfo:OAuthClientInformationMixed={client_id:CLIENT_ID};
  const metadata:OAuthClientMetadata={redirect_uris:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code'],response_types:['code'],scope:SCOPE,client_name:'Agent hours local reader'};
  const provider:OAuthClientProvider={
    get redirectUrl(){return redirect;},get clientMetadata(){return metadata;},state:()=>state,
    clientInformation:()=>clientInfo,
    saveClientInformation:info=>{if (info.client_id!==CLIENT_ID||info.client_secret) throw new SafeError('registration_rejected'); clientInfo=info;},
    tokens:()=>tokens,saveTokens:value=>{tokens=value;},
    saveCodeVerifier:value=>{verifier=value;},codeVerifier:()=>verifier,
    redirectToAuthorization:async url=>{ validateAuthorization(url,redirect,state); await (options.dependencies?.openBrowser??openBrowser)(url.href); options.onBrowser(); },
    invalidateCredentials:scope=>{if (scope==='all'||scope==='tokens') tokens=undefined;if (scope==='all'||scope==='verifier') verifier='';},
  };
  const makeTransport=()=>new StreamableHTTPClientTransport(new URL(SERVER),{authProvider:provider,fetch:guardedFetch(options.dependencies?.fetch),requestInit:{signal:options.signal}});
  let transport=makeTransport();
  let client=new MCPClient({name:'agent-hours',version:'0.1.0'});
  const timeout=setTimeout(()=>reject(new SafeError('sign_in_timeout')),300_000);
  const abort=()=>{reject(new SafeError('cancelled')); void client.close().catch(()=>{});};
  options.signal.addEventListener('abort',abort,{once:true});
  try {
    try { await client.connect(transport); }
    catch(error) {
      if (!(error instanceof UnauthorizedError)) throw error;
      const code=await callback; options.signal.throwIfAborted();
      await transport.finishAuth(code);
      // A failed initialize has already started this transport; SDK transports
      // are single-use. Reconnect with the same in-memory OAuth provider only.
      await client.close();transport=makeTransport();client=new MCPClient({name:'agent-hours',version:'0.1.0'});
      await client.connect(transport);
    }
    clearTimeout(timeout);
    // No generic tool forwarding; the signed-in user is selected by the server.
    const employee=await client.callTool({name:'current_employee',arguments:{}},undefined,{signal:options.signal,timeout:60_000}); ownEmployee(employee);
    const punches=await client.callTool({name:'list_punches',arguments:{fromDate:since,toDate:until}},undefined,{signal:options.signal,timeout:60_000});
    const hours=normalizePunches(employee,punches,since,until);
    const projects=options.projects?projectContext(unwrap(await client.callTool({name:'list_projects',arguments:{}},undefined,{signal:options.signal,timeout:60_000})),unwrap(punches)):[];
    return {hours,projects};
  } finally {
    clearTimeout(timeout); options.signal.removeEventListener('abort',abort);
    await client.close().catch(()=>{}); server.stop(true); tokens=undefined; verifier=''; clientInfo={client_id:CLIENT_ID};
  }
}
