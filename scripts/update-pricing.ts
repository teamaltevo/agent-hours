/** Vendor data, not LiteLLM/Tokscale runtime code. Pin upstream for repeatability. */
import { createHash } from 'node:crypto';
const meta=await fetch('https://api.github.com/repos/BerriAI/litellm/commits/main').then(r=>{if(!r.ok)throw new Error('pricing_revision_unavailable');return r.json();}) as {sha:string};
if(!/^[a-f0-9]{40}$/.test(meta.sha))throw new Error('invalid_revision');
const url=`https://raw.githubusercontent.com/BerriAI/litellm/${meta.sha}/model_prices_and_context_window.json`;
const raw=await fetch(url).then(r=>{if(!r.ok)throw new Error('pricing_unavailable');return r.text();}),data=JSON.parse(raw);
const models:Record<string,Record<string,number>>={};
for(const [key,value]of Object.entries(data) as [string,any][]){
  // Original-vendor text API tariffs only; subscription/reseller zero rows are
  // not an API-equivalent price. No fuzzy model-name fallback.
  if(!['anthropic','openai'].includes(value.litellm_provider)||!['chat','completion','responses'].includes(value.mode)||key.includes('/')||!/^[a-z0-9][a-z0-9._-]{1,119}$/.test(key))continue;
  if(!key.startsWith('claude-')&&!/^(gpt-|o[134](?:-|$)|chatgpt-)/.test(key))continue;
  if(/audio|realtime|image|search|computer-use/.test(key))continue;
  const rates=Object.fromEntries(Object.entries(value).filter(([k,v])=>/^(input_cost_per_token|output_cost_per_token|cache_read_input_token_cost|cache_creation_input_token_cost)(?:_above_\d+k_tokens|_above_1hr(?:_above_\d+k_tokens)?)?$/.test(k)&&typeof v==='number'&&Number.isFinite(v)&&v>=0));
  if(typeof rates.input_cost_per_token!=='number'||typeof rates.output_cost_per_token!=='number')continue;
  models[key]=rates as Record<string,number>;
}
if(Object.keys(models).length<20)throw new Error('pricing_catalog_incomplete');
await Bun.write('src/vendor/api-pricing.json',JSON.stringify({snapshot:meta.sha,sha256:createHash('sha256').update(raw).digest('hex'),retrieved:new Date().toISOString().slice(0,10),source:url,models},null,2)+'\n');
console.log(`Vendored ${Object.keys(models).length} original-vendor API tariffs at ${meta.sha.slice(0,12)}.`);
