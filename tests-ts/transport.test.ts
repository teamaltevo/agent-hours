import { expect,test } from 'bun:test';
import { transportFromClient, type GenerationClient } from '../src/classifier.ts';

function client(){return {model:{default:async()=>({data:{id:'fast',providerID:'synthetic',headers:{authorization:'SECRET'}}}),list:async()=>({data:[{id:'fast',providerID:'synthetic',name:'Fast',enabled:true,type:'chat',headers:{authorization:'SECRET'}},{id:'hidden',providerID:'synthetic',enabled:false},{id:'image',providerID:'synthetic',type:'image'}]})},experimental:{generate:{text:async()=>({text:'{}'})}}};}
test('model catalogue projects only public labels',async()=>{
  const result=await transportFromClient(client(),new AbortController().signal).models();expect(result.defaultModel).toEqual({id:'fast',providerID:'synthetic'});expect(result.models).toEqual([{id:'fast',providerID:'synthetic',name:'Fast'}]);expect(JSON.stringify(result)).not.toContain('SECRET');
});
test('only stateless generation endpoint gets the request, no sessions or tools',async()=>{
  let payload:any;const c=client();c.experimental.generate.text=async(...args:any[])=>{payload=args[0];return {text:'result'};};
  const result=await transportFromClient(c,new AbortController().signal).generate('UNTRUSTED_PRIVATE_PROMPT',{id:'fast',providerID:'synthetic',name:'Not an input'},new AbortController().signal);
  expect(result).toBe('result');expect(payload).toEqual({prompt:'UNTRUSTED_PRIVATE_PROMPT',model:{id:'fast',providerID:'synthetic'}});expect(Object.keys(payload)).not.toContain('tools');
});
test('transport errors never forward provider response bodies',async()=>{
  const c=client();c.experimental.generate.text=async()=>{throw new Error('PROVIDER_SECRET_BODY');};
  try{await transportFromClient(c,new AbortController().signal).generate('PRIVATE',{id:'fast',providerID:'synthetic'},new AbortController().signal);throw new Error('should throw');}catch(error){expect(String(error)).toContain('model_transport_failure');expect(String(error)).not.toContain('PROVIDER_SECRET_BODY');}
});
test('request timeout is an abort signal, not model config',async()=>{
  let request:any;const c=client();c.experimental.generate.text=async(...args:any[])=>{request=args;return {text:'{}'};};
  const controller=new AbortController();await transportFromClient(c,new AbortController().signal).generate('prompt',{id:'fast',providerID:'synthetic'},controller.signal);expect(request[1].signal).toBeInstanceOf(AbortSignal);expect(request[0].model).toEqual({id:'fast',providerID:'synthetic'});
});
