import { describe, expect, test } from 'bun:test';
import { boundaries, localDate, mergeSpans, stable, strictJSON, timestamp } from '../src/core.ts';
import { argumentsFor } from '../src/cli.ts';

describe('dates and timing',()=>{
  test('Montréal spring day has 23 hours',()=>{const [d]=boundaries('2026-03-08','2026-03-08');expect(d.hi-d.lo).toBe(23*3600_000);});
  test('Montréal fall day has 25 hours',()=>{const [d]=boundaries('2026-11-01','2026-11-01');expect(d.hi-d.lo).toBe(25*3600_000);});
  test('UTC punches convert to local dates',()=>expect(localDate('2026-06-02T01:00:00Z')).toBe('2026-06-01'));
  for(const value of ['2026-02-30','2026-1-01','oops'])test('reject invalid date '+value,()=>expect(()=>boundaries(value,'2026-11-11')).toThrow());
  test('reject reversed period',()=>expect(()=>boundaries('2026-11-11','2026-01-01')).toThrow());
  for(const value of ['2026-01-01T12:00:00',-1,1.5,null])test('reject missing/naive timestamp '+String(value),()=>expect(timestamp(value)).toBeNull());
  test('merge only within session',()=>expect(mergeSpans([[10,20],[15,30],[40,45]])).toEqual([[10,30],[40,45]]));
});
describe('strict JSON',()=>{
  for(const text of ['{"a":1,"a":2}','{"x":{"a":1,"a":2}}','{"x":NaN}','{"x":1e1000}','{} trailing','{"a":01}','[1,]','{"a":1,}','{"x":"unterminated}','{"x":"bad\nvalue"}'])test('reject '+text,()=>expect(()=>strictJSON(text)).toThrow());
  test('valid escaped keys and arrays',()=>expect(strictJSON('{"x":[1,true,null,"a\\\"b"],"a":{}}')).toEqual({x:[1,true,null,'a"b'],a:{}}));
  test('duplicate escaped key rejected',()=>expect(()=>strictJSON('{"a":1,"\\u0061":2}')).toThrow());
  test('stable hash context ordering',()=>expect(stable({b:2,a:1})).toBe(stable({a:1,b:2})));
});
describe('options and policy',()=>{
  test('default limits',()=>expect(argumentsFor([]).workers).toBe(2));
  for(const args of [['--workers','5'],['--max-calls','0'],['--clients','invalid'],['--request-timeout','9'],['--timesentry-scope','yes'],['--model','invalid'],['--unknown']])test('reject '+args.join(' '),()=>expect(()=>argumentsFor(args)).toThrow());
  test('repeatable archives and client subset',()=>{const a=argumentsFor(['--database','a','--database','b','--clients','claude,codex']);expect(a.values.database).toEqual(['a','b']);expect(a.clients).toEqual(['claude','codex']);});
  test('legacy scope flag remains parseable but no longer gates reporting',()=>expect(argumentsFor(['--timesentry-scope','unknown']).values['timesentry-scope']).toBe('unknown'));
});
