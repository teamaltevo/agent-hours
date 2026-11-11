import snapshot from './vendor/api-pricing.json';
import type { UsageEvent,CostCoverage } from './types.ts';
export const PRICING_SNAPSHOT=snapshot.snapshot;
export const pricingModels=snapshot.models as Record<string,Record<string,number>>;
export function pricedModel(model:unknown):string|null {
  if(typeof model!=='string')return null;
  const key=model.replace(/^(?:anthropic|openai)\//,'');
  return Object.hasOwn(pricingModels,key)?key:null;
}
export const emptyCost=():CostCoverage=>({estimated_api_cost_usd:null,estimated_api_cost_upper_usd:null,priced_samples:0,unpriced_samples:0,input_tokens:0,output_tokens:0,cache_read_tokens:0,cache_write_tokens:0,reasoning_tokens:0});
export function sumCosts(values:CostCoverage[]):CostCoverage {
  const result=emptyCost();for(const v of values){for(const key of ['priced_samples','unpriced_samples','input_tokens','output_tokens','cache_read_tokens','cache_write_tokens','reasoning_tokens'] as const)result[key]+=v[key];for(const key of ['estimated_api_cost_usd','estimated_api_cost_upper_usd'] as const)if(v[key]!==null)result[key]=(result[key]??0)+v[key]!;}return result;
}
/** No text tokenization: price native request usage only. Reasoning is included
 * in Claude/Codex output, separate in OpenCode's normalized AI SDK usage. */
export function estimateUsage(e:UsageEvent):CostCoverage {
  const result=emptyCost();result.input_tokens=e.input??0;result.output_tokens=e.output??0;result.cache_read_tokens=e.cache_read??0;result.cache_write_tokens=e.cache_write??0;result.reasoning_tokens=e.reasoning??0;
  const key=pricedModel(e.model),rates=key?pricingModels[key]:null;
  const unavailable=()=>{result.unpriced_samples=1;return result;};
  if(!rates||!e.format||e.invalid_usage||e.input===null||e.output===null)return unavailable();
  const read=e.cache_read??0,write=e.cache_write??0,reasoning=e.reasoning??0;
  const input=e.format==='codex'?e.input-read:e.input,output=e.output+(e.format==='opencode'?reasoning:0);
  if(input<0||(e.format==='codex'&&reasoning>e.output))return unavailable();
  const context=input+read+write;
  const rate=(field:string):number|undefined=>{
    let value=rates[field];for(const threshold of [100,128,200,256,272])if(context>threshold*1000&&rates[field+'_above_'+threshold+'k_tokens']!==undefined)value=rates[field+'_above_'+threshold+'k_tokens'];return value;
  };
  const ir=rate('input_cost_per_token'),or=rate('output_cost_per_token'),cr=rate('cache_read_input_token_cost'),cw=rate('cache_creation_input_token_cost'),hour=rate('cache_creation_input_token_cost_above_1hr');
  if(ir===undefined||or===undefined||(read>0&&cr===undefined)||(write>0&&cw===undefined))return unavailable();
  const knownHour=e.cache_write_1h;
  if(knownHour!=null&&(knownHour>write||knownHour>0&&hour===undefined))return unavailable();
  const base=input*ir+output*or+read*(cr??0);
  const low=base+(write-(knownHour??0))*(cw??0)+(knownHour??0)*(hour??0);
  const high=knownHour==null&&write>0&&hour!==undefined?base+write*Math.max(hour,cw??0):low;
  result.priced_samples=1;result.estimated_api_cost_usd=low;result.estimated_api_cost_upper_usd=high;return result;
}
