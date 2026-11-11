import { date } from './core.ts';
import { meta,toolSummary,usageSummary,intervalStats,emptyDetails } from './telemetry.ts';
import { spans,messageGapSpans } from './sources.ts';
import type { Session,Client,Label,Span,ToolEvent,UsageEvent,DailyDetails,Report,PeriodSummary } from './types.ts';

interface Accumulator {
  sessions:Record<Label,Set<string>>;methods:{model:Set<string>;keyword:Set<string>;declared:Set<string>};
  primary:Span[][];recorded:Span[][];gaps:Span[][];turnDurations:number[];tools:ToolEvent[];usage:UsageEvent[];issues:number;
}
const accumulator=():Accumulator=>({sessions:{work:new Set(),personal:new Set(),mixed:new Set(),unknown:new Set()},methods:{model:new Set(),keyword:new Set(),declared:new Set()},primary:[],recorded:[],gaps:[],turnDurations:[],tools:[],usage:[],issues:0});
function joinAcc(values:Accumulator[]):Accumulator {
  const result=accumulator();for(const value of values){
    for(const label of ['work','personal','mixed','unknown'] as const)for(const id of value.sessions[label])result.sessions[label].add(id);
    for(const method of ['model','keyword','declared'] as const)for(const id of value.methods[method])result.methods[method].add(id);
    result.primary.push(...value.primary);result.recorded.push(...value.recorded);result.gaps.push(...value.gaps);result.turnDurations.push(...value.turnDurations);result.tools.push(...value.tools);result.usage.push(...value.usage);result.issues+=value.issues;
  }return result;
}
function details(value:Accumulator):DailyDetails {
  const result=emptyDetails();
  for(const key of ['work','personal','mixed','unknown'] as const)result.sessions[key]=value.sessions[key].size;
  for(const key of ['model','keyword','declared'] as const)result.attribution[key]=value.methods[key].size;
  result.tools=toolSummary(value.tools);result.usage=usageSummary(value.usage);result.telemetry_issues=value.issues;
  result.activity={...intervalStats(value.primary),recorded_span_hours:value.recorded.length?intervalStats(value.recorded).summed_hours:null,recorded_turn_duration_hours:value.turnDurations.length?value.turnDurations.reduce((a,b)=>a+b,0)/3600000:null,bounded_message_gap_hours:value.gaps.length?intervalStats(value.gaps).summed_hours:null};
  return result;
}
export class DetailBuilder {
  private values=new Map<Client,Map<string,Accumulator>>();
  constructor(private bounds:{date:string;lo:number;hi:number}[]){}
  private get(client:Client,day:string):Accumulator {
    let days=this.values.get(client);if(!days){days=new Map();this.values.set(client,days);}let value=days.get(day);if(!value){value=accumulator();days.set(day,value);}return value;
  }
  add(s:Session,label:Label,history:string[]):void {
    const id=s.identity;for(const day of history){const a=this.get(s.client,day);a.sessions[label].add(id);if(label==='work')a.methods[s.method??'model'].add(id);}
    if(label!=='work')return;const t=meta(s);
    const primary=spans(s),gaps=messageGapSpans(s),recorded=s.client==='opencode'?primary:[...t.recorded_spans.values()];
    const clip=(values:Span[],lo:number,hi:number):Span[]=>values.map(([a,b])=>[Math.max(a,lo),Math.min(b,hi)] as Span).filter(([a,b])=>b>a);
    for(const day of this.bounds){
      const p=clip(primary,day.lo,day.hi),r=clip(recorded,day.lo,day.hi),g=clip(gaps,day.lo,day.hi);
      const tools=[...t.tools.values()].filter(e=>{const at=e.end??e.start;return at!==null&&day.lo<=at&&at<day.hi;});
      const usage=[...t.usage.values()].filter(e=>e.at!==null&&day.lo<=e.at&&e.at<day.hi);
      const turns=[...t.turns.values()].filter(e=>e.at!==null&&day.lo<=e.at&&e.at<day.hi).map(e=>e.duration_ms);
      if(!p.length&&!r.length&&!g.length&&!tools.length&&!usage.length&&!turns.length&&day.date!==history[0])continue;
      const a=this.get(s.client,day.date);
      if(p.length)a.primary.push(p);if(r.length)a.recorded.push(r);if(g.length)a.gaps.push(g);
      a.tools.push(...tools);a.usage.push(...usage);a.turnDurations.push(...turns);
      // Issues have no precise timestamp; attach once on the first history day.
      if(day.date===history[0])a.issues+=t.issues;
    }
  }
  apply(report:Report):void {
    const active=Object.keys(report.clients) as Client[];
    for(const day of report.days){day.details_by_client={};for(const client of active)if(day.history_observed_by_client[client]===true)day.details_by_client[client]=details(this.get(client,day.date));}
    for(const client of active)report.clients[client]!.details=details(joinAcc([...this.values.get(client)?.values()??[]]));
    const group=(unit:'week'|'month'):PeriodSummary[]=>{
      const groups=new Map<string,typeof report.days>();
      for(const day of report.days){const key=unit==='month'?day.date.slice(0,7):date(day.date).subtract({days:date(day.date).dayOfWeek-1}).toString();const list=groups.get(key)??[];list.push(day);groups.set(key,list);}
      const result:PeriodSummary[]=[];
      for(const [period,days]of groups)for(const client of active){
        if(!days.some(d=>d.history_observed_by_client[client]===true))continue;
        const paired=days.filter(d=>d.ratios_by_client[client]!=null),activity=paired.reduce((n,d)=>n+(d.captured_work_hours_by_client[client]??0),0),work=paired.reduce((n,d)=>n+(d.developer_hours??0),0);
        result.push({period,client,developer_hours:report.timesentry_coverage==='operator_confirmed'?days.reduce((n,d)=>n+(d.developer_hours??0),0):null,captured_work_hours:days.some(d=>d.captured_work_hours_by_client[client]!=null)?days.reduce((n,d)=>n+(d.captured_work_hours_by_client[client]??0),0):null,paired_days:paired.length,paired_activity_hours:paired.length?activity:null,paired_developer_hours:paired.length?work:null,ratio:paired.length?activity/work:null,days_with_activity_and_zero_work:days.filter(d=>(d.captured_work_hours_by_client[client]??0)>0&&d.developer_hours===0).length,details:details(joinAcc(days.map(d=>this.get(client,d.date))))});
      }return result;
    };
    report.period_summaries={week:group('week'),month:group('month')};
    report.telemetry_schema_version=1;
    report.telemetry_interpretation='Work-classified sessions only. Tool duration and tool-call distributions are attributed to completion date (invocation date when no completion exists). Recorded wall durations and timestamp round-trip estimates stay separate; neither is CPU time. Tool durations overlap agent activity and must not be added to it. Recorded Claude turn durations are completion-date totals, not reconstructed execution intervals. Token fields are source-specific; cached/reasoning counts may overlap other fields and must not be blindly summed. Cost is the source-reported estimate where present, not an invoice. Missing measurements remain null. Session counts are unique within each date/period, not additive across periods. Claude Chat exports may include web/mobile history and do not prove Desktop-only provenance or Cowork coverage.';
  }
}
