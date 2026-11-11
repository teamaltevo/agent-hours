import { expect,test } from 'bun:test';
import { estimateUsage,pricedModel,sumCosts,pricingModels } from '../src/pricing.ts';
import { nativeUsage,telemetry,claudeTelemetry,addUsage } from '../src/telemetry.ts';
import type { UsageEvent } from '../src/types.ts';
const event=(overrides:Partial<UsageEvent>={}):UsageEvent=>({id:'synthetic',at:1,input:1000,output:100,cache_read:500,cache_write:0,reasoning:30,cost_usd:0,model:'gpt-5.3-codex',format:'codex',...overrides});
test('Codex subtracts cached input and does not bill reasoning twice',()=>{
  const value=estimateUsage(event()),rates=pricingModels['gpt-5.3-codex'];expect(value.priced_samples).toBe(1);expect(value.estimated_api_cost_usd).toBeCloseTo(500*rates.input_cost_per_token+500*rates.cache_read_input_token_cost+100*rates.output_cost_per_token,12);
});
test('OpenCode uncached input and separate reasoning are priced once',()=>{
  const value=estimateUsage(event({format:'opencode'})),rates=pricingModels['gpt-5.3-codex'];expect(value.estimated_api_cost_usd).toBeCloseTo(1000*rates.input_cost_per_token+500*rates.cache_read_input_token_cost+130*rates.output_cost_per_token,12);
});
test('Claude cache writes with unknown TTL have a 5m–1h cost range',()=>{
  const value=estimateUsage(event({format:'claude',model:'claude-sonnet-4-5',cache_write:1000}));expect(value.priced_samples).toBe(1);expect(value.estimated_api_cost_upper_usd!).toBeGreaterThan(value.estimated_api_cost_usd!);
});
test('known cache TTL prices both write buckets without doubling them',()=>{
  const e=event({format:'claude',model:'claude-sonnet-4-5',cache_write:1000,cache_write_1h:400}),value=estimateUsage(e),r=pricingModels['claude-sonnet-4-5'];expect(value.estimated_api_cost_usd).toBeCloseTo(1000*r.input_cost_per_token+100*r.output_cost_per_token+500*r.cache_read_input_token_cost+600*r.cache_creation_input_token_cost+400*r.cache_creation_input_token_cost_above_1hr,12);expect(value.estimated_api_cost_upper_usd).toBe(value.estimated_api_cost_usd);
});
test('long context thresholds use the entire request input including cached input',()=>{
  const e=event({model:'gpt-5.4',input:300000,cache_read:280000}),value=estimateUsage(e),r=pricingModels['gpt-5.4'];expect(value.estimated_api_cost_usd).toBeCloseTo(20000*r.input_cost_per_token_above_272k_tokens+280000*r.cache_read_input_token_cost_above_272k_tokens+100*r.output_cost_per_token_above_272k_tokens,12);
});
test('unknown aliases and routing labels never fuzzy-match a paid model',()=>{
  for(const model of ['auto','default','PRIVATE_MODEL','claude','gpt-5.3-codex-spark','gpt-5.3-codex-high']){expect(pricedModel(model)).toBeNull();expect(estimateUsage(event({model})).estimated_api_cost_usd).toBeNull();}
  expect(pricedModel('openai/gpt-5.3-codex')).toBe('gpt-5.3-codex');
});
test('source-reported zero is not substituted for API-equivalent cost',()=>expect(estimateUsage(event()).estimated_api_cost_usd!).toBeGreaterThan(0));
test('missing counts and inconsistent cache counts are unavailable, not free',()=>{
  for(const e of [event({input:null}),event({input:1,cache_read:3}),event({format:undefined}),event({format:'claude',model:'claude-sonnet-4-5',cache_write:1,cache_write_1h:2})]){const value=estimateUsage(e);expect(value.unpriced_samples).toBe(1);expect(value.estimated_api_cost_usd).toBeNull();}
});
test('aggregate price totals retain the unpriced coverage count',()=>{
  const v=sumCosts([estimateUsage(event()),estimateUsage(event({model:'unknown'}))]);expect(v.priced_samples).toBe(1);expect(v.unpriced_samples).toBe(1);expect(v.estimated_api_cost_usd).toBe(estimateUsage(event()).estimated_api_cost_usd);
});
test('Claude parsing retains model and TTL, while streamed events still deduplicate',()=>{
  const t=telemetry();for(const output_tokens of [2,5])claudeTelemetry(t,{type:'assistant',timestamp:'2026-06-01T12:00:00Z',message:{id:'one',model:'claude-sonnet-4-5',usage:{input_tokens:10,output_tokens,cache_creation_input_tokens:8,cache_creation:{ephemeral_1h_input_tokens:3}}}});expect(t.usage.size).toBe(1);const e=[...t.usage.values()][0];expect(e.model).toBe('claude-sonnet-4-5');expect(e.cache_write_1h).toBe(3);expect(e.output).toBe(5);
});
test('conflicting model metadata stays unpriced after subsequent mirrors',()=>{
  const t=telemetry();addUsage(t,event());addUsage(t,event({model:'gpt-5.4'}));addUsage(t,event());expect(estimateUsage([...t.usage.values()][0]).unpriced_samples).toBe(1);
});
test('cost-only native records do not fabricate token pricing',()=>{
  const e=nativeUsage('one',1,null,2,'opencode','gpt-5.4')!;expect(e.cost_usd).toBe(2);expect(estimateUsage(e).estimated_api_cost_usd).toBeNull();
});
test('invalid optional cache counters cannot turn into a full-price estimate',()=>{
  const e=nativeUsage('one',1,{input_tokens:1000,output_tokens:30,cached_input_tokens:'invalid'},null,'codex','gpt-5.3-codex')!;expect(estimateUsage(e).unpriced_samples).toBe(1);
});
