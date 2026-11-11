import { expect,test } from 'bun:test';
import { CHARTING_SCRIPT } from '../src/charting.ts';
import runtime from '../src/vendor/chart-runtime.txt';
import { dashboardHTML } from '../src/dashboard.ts';
import { sampleReport } from './fixtures.ts';

function harness(){
  const nodes=new Map<string,any>(),pending:(()=>void)[]=[],instances:any[]=[];
  const node=(id:string)=>{const el={id,value:'day',innerHTML:'',canvas:{id:id+'-canvas'},querySelector:()=>el.canvas};nodes.set(id,el);return el;};
  node('period');for(const id of ['tools','commands','overlap','classification'])node(id);
  class FakeChart {static defaults={font:{}};destroyed=false;constructor(public canvas:any,public config:any){instances.push(this);}destroy(){this.destroyed=true;}}
  const create=new Function('Chart','document','getComputedStyle','$','fmt','queueMicrotask',CHARTING_SCRIPT+';return {calendarRows,chart,horizontalChart,classificationChart,disposeCharts};');
  const api=create(FakeChart,{documentElement:{}},()=>({getPropertyValue:()=> '#336677'}),(id:string)=>nodes.get(id)??null,(v:any)=>v==null?'—':String(v),(fn:()=>void)=>pending.push(fn));
  const mount=(html:string)=>{const id=html.match(/id="(activity-canvas-\d+)"/)?.[1];if(id)node(id);while(pending.length)pending.shift()!();};
  return {api,nodes,instances,mount};
}
test('offline runtime is pinned, licensed, and has no source-map request',()=>{
  expect(runtime).toContain('Chart.js 4.6.1');expect(runtime).toContain('Permission is hereby granted');expect(runtime).not.toContain('sourceMappingURL');expect(runtime).not.toMatch(/<\/script/i);
  const html=dashboardHTML(sampleReport());expect(html).toContain(runtime);expect(html).not.toMatch(/<script[^>]+src=/i);expect(html).toContain("connect-src 'none'");
});
test('vendored runtime matches the pinned package distribution',async()=>{
  const source=(await Bun.file('node_modules/chart.js/dist/chart.umd.min.js').text()).replace(/\/\/# sourceMappingURL=[^\r\n]*/g,'').trim().replace(/\r\n/g,'\n');expect(runtime.replace(/\r\n/g,'\n').endsWith(source+'\n')).toBe(true);
});
test('calendar gaps are null while captured zeros remain zero',()=>{
  const h=harness(),html=h.api.chart([{date:'2026-06-01',values:{agent:0}},{date:'2026-06-03',values:{agent:2}}],[{key:'agent',label:'Agent',color:'#176c89'}],false);h.mount(html);
  const c=h.instances[0].config;expect(c.type).toBe('bar');expect(c.data.labels).toEqual(['2026-06-01','2026-06-02','2026-06-03']);expect(c.data.datasets[0].data).toEqual([0,null,2]);expect(c.options.responsive).toBe(true);
});
test('ratio charts show lines without bridging missing days',()=>{
  const h=harness();h.mount(h.api.chart([{date:'2026-06-01',values:{agent:.2}},{date:'2026-06-03',values:{agent:.4}}],[{key:'agent',label:'Ratio',color:'var(--accent)'}],true));
  const c=h.instances[0].config;expect(c.type).toBe('line');expect(c.data.datasets[0].spanGaps).toBe(false);expect(c.data.datasets[0].data).toEqual([.2,null,.4]);expect(c.options.plugins.tooltip.callbacks.label({dataset:{label:'Ratio'},parsed:{y:.2}})).toBe('Ratio: 0.2×');
});
test('changing selections destroys the old Chart.js instance',()=>{
  const h=harness(),data=[{date:'2026-06-01',values:{agent:1}}],series=[{key:'agent',label:'Agent',color:'#176c89'}];h.mount(h.api.chart(data,series,false));const first=h.instances[0];h.mount(h.api.chart(data,series,true));expect(first.destroyed).toBe(true);expect(h.instances.length).toBe(2);h.api.chart([],series,false);expect(h.instances[1].destroyed).toBe(true);
});
test('monthly gaps follow calendar months without a date adapter',()=>{
  const h=harness(),rows=h.api.calendarRows([{date:'2026-01',values:{agent:1}},{date:'2026-03',values:{agent:2}}],'month');expect(rows.map((r:any)=>r.date)).toEqual(['2026-01','2026-02','2026-03']);expect(rows[1].values).toEqual({});
});
test('tool charts keep recorded duration and round-trip estimates separate',()=>{
  const h=harness();h.api.horizontalChart('tools',['shell'],[{label:'Recorded',data:[null]},{label:'Round trip',data:[10]}],'s');const c=h.instances[0].config;expect(c.options.indexAxis).toBe('y');expect(c.data.datasets[0].data).toEqual([null]);expect(c.data.datasets[1].data).toEqual([10]);
});
