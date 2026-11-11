import { expect, test } from 'bun:test';
import { CALLBACK, CLIENT_ID, SCOPE, SERVER, fetchTimeSentry, guardedFetch, normalizePunches, ownEmployee, unwrap, validCallback, validateAuthorization, type Fetch } from '../src/timesentry.ts';
import { projectContext } from '../src/projects.ts';

const employee='00000000-0000-4000-8000-000000000000';
const result=(value:unknown)=>({content:[{type:'text',text:JSON.stringify(value)}]});
const punch=(id='p1',hours:unknown=2,userId=employee,workDate='2026-06-01')=>({id,hours,userId,workDate,projectId:'private_project_id',ticketLink:'https://synthetic.atlassian.net/browse/TSV-1?token=SECRET'});
test('MCP tool errors not interpreted as data',()=>expect(()=>unwrap({...result([]),isError:true})).toThrow());
test('partial punch envelopes rejected',()=>expect(()=>normalizePunches(result({employeeId:employee}),result({rows:[]}), '2026-06-01','2026-06-01')).toThrow());
test('employee identity required',()=>expect(()=>ownEmployee(result({employeeId:'not-a-uuid'}))).toThrow());
test('only own returned punches, decimals and deduplication',()=>{
  const punches=[punch('p1',.1),punch('p2',.2),punch('p1',.1)];expect(normalizePunches(result({employeeId:employee}),result(punches),'2026-06-01','2026-06-01').get('2026-06-01')).toBe(.3);
});
test('raw decimal JSON is summed before conversion to JS numbers',()=>{
  const content='['+['a','b','c'].map(id=>`{"id":"${id}","userId":"${employee}","workDate":"2026-06-01","hours":0.10000000000000001}`).join(',')+']';
  expect(normalizePunches(result({employeeId:employee}),{content:[{type:'text',text:content}]},'2026-06-01','2026-06-01').get('2026-06-01')).toBe(Number('0.30000000000000003'));
});
test('foreign punch fails closed',()=>expect(()=>normalizePunches(result({employeeId:employee}),result([punch('p1',2,'00000000-0000-4000-8000-000000000001')]),'2026-06-01','2026-06-01')).toThrow());
test('conflicting duplicate fails closed',()=>expect(()=>normalizePunches(result({employeeId:employee}),result([punch(),punch('p1',3)]),'2026-06-01','2026-06-01')).toThrow());
for(const hours of [true,-1,'NaN','Infinity','1e999',null,{}])test('invalid hours '+String(hours),()=>expect(()=>normalizePunches(result({employeeId:employee}),result([punch('p1',hours)]),'2026-06-01','2026-06-01')).toThrow());
test('punch outside range rejected',()=>expect(()=>normalizePunches(result({employeeId:employee}),result([punch('p1',2,employee,'2026-06-02')]),'2026-06-01','2026-06-01')).toThrow());
test('structured MCP content unwraps result only',()=>expect(unwrap({structuredContent:{result:[1]}})).toEqual([1]));
test('project context strips ticket secrets and project IDs',()=>{
  const value=projectContext([{name:'Synthetic',projects:[{id:'private_project_id',title:'Distinctive'}]}],[punch()]);expect(value[0].key).toBe('p0000');expect(value[0].jira_references).toEqual([{host:'synthetic.atlassian.net',project_key:'TSV'}]);expect(JSON.stringify(value)).not.toContain('SECRET');expect(JSON.stringify(value)).not.toContain('private_project_id');
});
function authURL(){const u=new URL('https://login.microsoftonline.com/synthetic/oauth2/v2.0/authorize');for(const [k,v]of Object.entries({client_id:CLIENT_ID,scope:SCOPE,state:'state',redirect_uri:'http://127.0.0.1:1234'+CALLBACK,response_type:'code',code_challenge:'a'.repeat(43),code_challenge_method:'S256'}))u.searchParams.set(k,v);return u;}
test('OAuth permits only exact scope, public client and PKCE',()=>expect(()=>validateAuthorization(authURL(),'http://127.0.0.1:1234'+CALLBACK,'state')).not.toThrow());
for(const [key,value]of [['scope','openid offline_access'],['client_id','wrong'],['code_challenge_method','plain'],['state','wrong'],['redirect_uri','http://attacker']])test('reject altered OAuth '+key,()=>{const u=authURL();u.searchParams.set(key,value);expect(()=>validateAuthorization(u,'http://127.0.0.1:1234'+CALLBACK,'state')).toThrow();});
test('reject foreign auth host',()=>{const u=authURL();u.hostname='attacker.example';expect(()=>validateAuthorization(u,'http://127.0.0.1:1234'+CALLBACK,'state')).toThrow();});
test('callback rejects duplicate state and unexpected path',()=>{expect(validCallback(new URL('http://127.0.0.1'+CALLBACK+'?state=a'),'a')).toBe(true);expect(validCallback(new URL('http://127.0.0.1'+CALLBACK+'?state=a&state=a'),'a')).toBe(false);expect(validCallback(new URL('http://127.0.0.1/other?state=a'),'a')).toBe(false);});
test('off-origin token endpoint blocked before network',async()=>{let called=false;const guarded=guardedFetch(async()=>{called=true;return new Response('{}');});await expect(guarded('https://attacker.example/token',{method:'POST'})).rejects.toThrow();expect(called).toBe(false);});
test('dynamic registration blocked before network',async()=>{let called=false;const guarded=guardedFetch(async()=>{called=true;return new Response('{}');});await expect(guarded('https://api.timesentry.app/register',{method:'POST'})).rejects.toThrow();expect(called).toBe(false);});
test('discovery containing foreign endpoint rejected',async()=>{const guarded=guardedFetch(async()=>Response.json({token_endpoint:'https://attacker.example/token'}));await expect(guarded('https://login.microsoftonline.com/synthetic/.well-known/openid-configuration')).rejects.toThrow();});
test('token exchange forces only configured delegated scope',async()=>{
  let body='';const guarded=guardedFetch((async(_input:any,init:any)=>{body=init.body.toString();return Response.json({});}) as typeof fetch);
  await guarded('https://login.microsoftonline.com/synthetic/oauth2/v2.0/token',{method:'POST',body:new URLSearchParams({client_id:CLIENT_ID,grant_type:'authorization_code',scope:'openid offline_access'})});expect(new URLSearchParams(body).get('scope')).toBe(SCOPE);
});
test('real MCP SDK OAuth handshake is self-only, read-only and memory-only (mock HTTP)',async()=>{
  const tools:string[]=[];const posts:string[]=[];let browserCount=0;
  const fake:Fetch=async(input,init)=>{
    const url=new URL(String(input));const method=init?.method??'GET';
    if(url.pathname.includes('.well-known/oauth-protected-resource'))return Response.json({resource:SERVER,authorization_servers:['https://login.microsoftonline.com/synthetic/v2.0'],scopes_supported:[SCOPE]});
    if(url.hostname==='login.microsoftonline.com'&&method==='GET')return Response.json({issuer:'https://login.microsoftonline.com/synthetic/v2.0',authorization_endpoint:'https://login.microsoftonline.com/synthetic/oauth2/v2.0/authorize',token_endpoint:'https://login.microsoftonline.com/synthetic/oauth2/v2.0/token',response_types_supported:['code'],grant_types_supported:['authorization_code'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256']});
    if(url.hostname==='login.microsoftonline.com'&&method==='POST'){
      const params=new URLSearchParams(init?.body as URLSearchParams);expect(params.get('scope')).toBe(SCOPE);expect(params.get('client_id')).toBe(CLIENT_ID);expect(params.get('code')).toBe('SYNTHETIC_CODE');expect(params.get('code_verifier')?.length).toBeGreaterThan(20);posts.push('token');return Response.json({access_token:'SYNTHETIC_TOKEN',token_type:'Bearer',expires_in:3600});
    }
    if(url.href!==SERVER)throw new Error('Unexpected URL in synthetic test');
    if(method==='GET')return new Response(null,{status:405});
    if(method==='DELETE')return new Response(null,{status:200});
    if(new Headers(init?.headers).get('authorization')!=='Bearer SYNTHETIC_TOKEN')return new Response(null,{status:401,headers:{'WWW-Authenticate':`Bearer resource_metadata="https://api.timesentry.app/.well-known/oauth-protected-resource/mcp", scope="${SCOPE}"`}});
    const body=JSON.parse(String(init?.body));posts.push(body.method);
    if(body.method==='notifications/initialized')return new Response(null,{status:202});
    let response:unknown;
    if(body.method==='initialize')response={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'synthetic',version:'1'}};
    else if(body.method==='tools/call'){
      const name=body.params.name;tools.push(name);
      if(name==='current_employee')response=result({employeeId:employee,firstName:'Synthetic',lastName:'Person',email:'synthetic@altevo.ca'});
      else if(name==='list_punches'){expect(body.params.arguments).toEqual({fromDate:'2026-06-01',toDate:'2026-06-01'});response=result([punch()]);}
      else if(name==='list_projects')response=result([{name:'Synthetic',projects:[{id:'private_project_id',title:'Synthetic Product'}]}]);
      else throw new Error('Write/unexpected tool rejected');
    }else throw new Error('Unexpected MCP method');
    return Response.json({jsonrpc:'2.0',id:body.id,result:response},{headers:{'mcp-session-id':'synthetic-session'}});
  };
  const output=await fetchTimeSentry('2026-06-01','2026-06-01',{consent:true,projects:true,onBrowser:()=>browserCount++,signal:AbortSignal.timeout(5000),dependencies:{fetch:fake,openBrowser:async value=>{
    const auth=new URL(value);expect(auth.searchParams.get('scope')).toBe(SCOPE);const callback=new URL(auth.searchParams.get('redirect_uri')!);callback.searchParams.set('state',auth.searchParams.get('state')!);callback.searchParams.set('code','SYNTHETIC_CODE');const response=await fetch(callback);expect(response.status).toBe(200);
  }}});
  expect(output.hours.get('2026-06-01')).toBe(2);expect(tools).toEqual(['current_employee','list_punches','list_projects']);expect(browserCount).toBe(1);expect(posts).toContain('token');expect(JSON.stringify([...output.hours])).not.toContain('TOKEN');
  expect(output.person).toEqual({name:'Synthetic Person',source:'timesentry_profile'});expect(JSON.stringify(output.person)).not.toContain('@');expect(JSON.stringify(output.person)).not.toContain(employee);
});
