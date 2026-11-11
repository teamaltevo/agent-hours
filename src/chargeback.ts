import { spans,transcript } from './sources.ts';
import { meta } from './telemetry.ts';
import { ProjectAttributor } from './projects.ts';
import { estimateUsage,emptyCost,pricedModel,PRICING_SNAPSHOT,sumCosts } from './pricing.ts';
import type { Session,Project,Chargeback,ProjectDay,ProjectWorkDay } from './types.ts';
import { projectLabel } from './chargeback-export.ts';

export class ChargebackBuilder {
  private rows=new Map<string,ProjectDay>();private matcher:ProjectAttributor;private undated=0;private missingUsage=0;
  constructor(private bounds:{date:string;lo:number;hi:number}[],private projects:Project[],private workDays:ProjectWorkDay[]=[]){this.matcher=new ProjectAttributor(projects);}
  add(s:Session,history:string[],workOnly:boolean){
    const directories=[s.directory,...[...s.records.values()].map(r=>r.cwd)];
    const project=s.project==='unattributed'?'unattributed':s.project&&this.projects.some(p=>p.key===s.project)?s.project:this.matcher.match(workOnly?'':transcript(s),directories)??'unattributed';
    const t=meta(s),intervals=spans(s);
    if(!t.usage.size)this.missingUsage++;
    const get=(date:string,model:string|null)=>{const key=JSON.stringify([date,project,s.client,model]);let row=this.rows.get(key);if(!row){row={date,project,client:s.client,model,agent_hours:0,sessions:0,tool_calls:0,tool_failures:0,...emptyCost()};this.rows.set(key,row);}return row;};
    // Timing and sessions are deliberately placed on model=null rows: a session
    // may use several models, but its duration must never be repeated per model.
    for(const day of this.bounds){
      const hours=intervals.reduce((n,[a,b])=>n+Math.max(0,Math.min(b,day.hi)-Math.max(a,day.lo)),0)/3600000;
      if(history.includes(day.date)||hours>0){const row=get(day.date,null);row.agent_hours+=hours;row.sessions++;}
      for(const e of t.tools.values()){const at=e.end??e.start;if(at!==null&&at>=day.lo&&at<day.hi){const row=get(day.date,null);row.tool_calls++;if(e.status==='failure')row.tool_failures++;}}
    }
    for(const event of t.usage.values()){
      if(event.at===null){this.undated++;continue;}const day=this.bounds.find(d=>d.lo<=event.at!&&event.at!<d.hi);if(!day)continue;
      const row=get(day.date,pricedModel(event.model));Object.assign(row,sumCosts([row,estimateUsage(event)]));
    }
  }
  build():Chargeback {
    const days=[...this.rows.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.project.localeCompare(b.project)||a.client.localeCompare(b.client)||(a.model??'').localeCompare(b.model??''));
    const used=new Set([...days.map(d=>d.project),...this.workDays.map(d=>d.project)]);
    return {schema_version:1,pricing_snapshot:PRICING_SNAPSHOT,basis:'published_api_equivalent_usd',projects:this.projects.filter(p=>used.has(p.key)).map(p=>({key:p.key,title:projectLabel(p.title)??p.key,client:projectLabel(p.client)??'Customer unavailable'})),days,work_days:this.workDays,total:sumCosts(days),undated_usage_samples:this.undated,sessions_without_usage:this.missingUsage};
  }
}
