"""Aggregate-only dashboard components. No private diagnostic index or network I/O."""
import calendar
from datetime import date
import html
import json
import math
import re
from pathlib import Path


CSS='''
:root{--accent:#145f82;--accent-dim:#e8f1f5;--text:#172c35;--text-dim:#526772;--border:#dce3e7;--border-bright:#71848e}
body{background:var(--bg)}main{max-width:1240px;padding:var(--s-5)}
header.dashboard-head{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,320px);gap:var(--s-5);align-items:end;margin-bottom:var(--s-4)}
.dashboard-head h1{font-size:var(--t-h1);max-width:26ch;line-height:1.08;margin:var(--s-2) 0}.dashboard-head .lead{max-width:62ch}
.scope-note{border:1px solid var(--border-bright);padding:var(--s-3);border-radius:var(--r-1);font-size:var(--t-small)}.scope-note p{margin:var(--s-2) 0}
.request-cells{display:flex;gap:var(--s-1);margin:var(--s-2) 0}.request-cells span{display:inline-grid;place-items:center;width:20px;height:20px;border:1px solid var(--border-bright);color:var(--text);font-weight:700}
.client-tabs{gap:var(--s-5);margin-bottom:var(--s-4)}.client-tabs label{padding:var(--s-3) 0;font-size:var(--t-body)}
.kpis{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-2);gap:0;margin-bottom:var(--s-3)}
.kpi{padding:var(--s-3);border-right:1px solid var(--border)}.kpi .val{font-size:var(--t-h2);letter-spacing:-.02em;text-align:left}.kpi .meta{min-height:2.5em}
.kpi svg{max-width:160px}.metric-note{margin:var(--s-2) 0 var(--s-3)}.frame{border:0;background:none}
.chart-controls{display:flex;gap:var(--s-2);align-items:center;flex-wrap:wrap;margin-bottom:var(--s-3)}
.chart-controls button{font:inherit;background:var(--surface);color:var(--text);border:1px solid var(--border-bright);border-radius:var(--r-1);padding:var(--s-2) var(--s-3);cursor:pointer}
.chart-controls button[aria-pressed="true"]{background:var(--accent);color:var(--bg);font-weight:700}.chart-controls button:focus-visible{outline:2px solid var(--text);outline-offset:2px}
.chart-controls output{color:var(--text-dim);font-size:var(--t-small)}.overflow-marker{fill:var(--accent);stroke:var(--text);stroke-width:1}
.selected-day{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--s-3);border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:var(--s-3) 0;margin-top:var(--s-3)}
.selected-day span{display:block;font-size:var(--t-small);color:var(--text-dim)}.selected-day strong{display:block;font-size:var(--t-h3);font-variant-numeric:tabular-nums}
.insights{margin-top:var(--s-6);border:0;padding:0}.insights h2{font-size:var(--t-h2);margin:var(--s-2) 0 var(--s-4)}
.insight-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s-5);align-items:start}.insight-grid figure{margin:0 0 var(--s-5);min-width:0}
.insight-grid h3{font-size:var(--t-h3);margin:0 0 var(--s-3)}.insight-grid figcaption{font-size:var(--t-small);color:var(--text-dim);line-height:1.5}
.measure-row{display:grid;grid-template-columns:105px minmax(0,1fr) 78px;gap:var(--s-2);align-items:center;margin:var(--s-3) 0;font-size:var(--t-small)}
.measure-label{color:var(--text-dim)}.rail{height:12px;background:var(--border);position:relative}.fill{display:block;height:100%;background:var(--accent)}
.fill.neutral{background:var(--text-dim)}.num{text-align:right;font-variant-numeric:tabular-nums}.axis-ends{display:flex;justify-content:space-between;color:var(--text-dim);font-size:var(--t-small);margin:var(--s-2) 78px 0 113px}
.stat-large{font-size:var(--t-h1);line-height:1;letter-spacing:-.03em;font-variant-numeric:tabular-nums;margin:var(--s-2) 0}.stat-note{color:var(--text-dim);font-size:var(--t-small);margin-bottom:var(--s-4)}
.segments{display:flex;height:26px;background:var(--border);margin:var(--s-3) 0}.segment{display:block;height:100%;background:var(--accent)}.segment.rest{background:var(--border-bright)}
.segment-keys{display:flex;justify-content:space-between;gap:var(--s-3);font-size:var(--t-small);color:var(--text-dim);margin-bottom:var(--s-3)}
.segment-keys b{color:var(--text);font-variant-numeric:tabular-nums}.small-print{font-size:var(--t-small);color:var(--text-dim)}
.coverage-calendar{width:100%;min-width:920px;height:auto}.calendar-scroll{overflow:auto}.calendar-label{fill:var(--text-dim);font-size:14px}.calendar-cell{fill:none;stroke:var(--border);stroke-width:1}
.calendar-cell{stroke:var(--border-bright)}.calendar-cell.paired{fill:var(--accent);stroke:var(--accent)}.calendar-cell.zero-work{fill:none;stroke:var(--border-bright);stroke-width:1.5;stroke-dasharray:3 2}
.calendar-legend{display:flex;gap:var(--s-4);flex-wrap:wrap;font-size:var(--t-small);color:var(--text-dim);margin:var(--s-3) 0}.swatch{display:inline-block;width:12px;height:12px;margin-right:var(--s-2);vertical-align:middle;border:1px solid var(--border)}
.swatch.paired{background:var(--accent);border-color:var(--accent)}.swatch.zero-work{border:1.5px dashed var(--border-bright)}
.quality-foot{border:1px solid var(--border-bright);border-radius:var(--r-2);padding:var(--s-4);margin-top:var(--s-5)}.quality-foot p{margin:var(--s-2) 0}
.methods{margin-top:var(--s-5);font-size:var(--t-small)}.sources{border-top:1px solid var(--border);padding-top:var(--s-4)}
@media(prefers-color-scheme:dark){:root{--accent:#73c5df;--accent-dim:#17323e;--text:#e4edf1;--text-dim:#a4b6c0;--border:#2b3b44;--border-bright:#6a7d86;--bg:#10191e;--surface:#16242b}.chart-controls button[aria-pressed="true"]{color:#10191e}}
@media(max-width:760px){main{padding:var(--s-3)}header.dashboard-head{grid-template-columns:1fr;gap:var(--s-3)}.dashboard-head h1{font-size:var(--t-h2)}.scope-note{padding:var(--s-2) var(--s-3)}.insight-grid{grid-template-columns:1fr}.selected-day{grid-template-columns:repeat(2,minmax(0,1fr))}.kpi .meta{display:block;min-height:0}.client-tabs{gap:var(--s-4)}}
'''


def measure(label,value,maximum,unit='h',neutral=False):
    width=0 if maximum<=0 else value/maximum*100
    display=f'{value:,.0f}'+(' d' if unit=='d' else '') if unit in ('d','sessions') else f'{value:,.1f} {unit}'
    return f'<div class="measure-row"><span class="measure-label">{html.escape(label)}</span><div class="rail" role="img" aria-label="{html.escape(label)} {value:.3f} {unit}"><span class="fill'+(' neutral' if neutral else '')+f'" style="width:{width:.4f}%"></span></div><span class="num">{display}</span></div>'


def segments(first,total,left,right):
    percent=first/total*100 if total else 0
    return f'<div class="segments" role="img" aria-label="{html.escape(left)} {first:.3f} of {total:.3f}"><span class="segment" style="width:{percent:.4f}%"></span><span class="segment rest" style="width:{100-percent:.4f}%"></span></div><div class="segment-keys"><span>{html.escape(left)} <b>{first:,.1f}</b></span><span>{html.escape(right)} <b>{total-first:,.1f}</b></span></div>'


def calendar_svg(report,client):
    history=[day for day in report['days'] if day.get('history_observed_by_client',{}).get(client) is True]
    if not history: return '<p class="small-print">No dated history is retained for this client.</p>'
    months=sorted({(date.fromisoformat(day['date']).year,date.fromisoformat(day['date']).month) for day in history})[-12:]
    lookup={day['date']:day for day in report['days']}
    width,height=920,55+len(months)*32
    out=[f'<svg class="coverage-calendar" viewBox="0 0 {width} {height}" role="img" aria-label="Dates with recorded history and positive or zero work hours">']
    for n in (1,5,10,15,20,25,31):
        out.append(f'<text class="calendar-label" x="{106+(n-1)*25}" y="20">{n}</text>')
    for row,(year,month) in enumerate(months):
        y=38+row*32
        out.append(f'<text class="calendar-label" x="4" y="{y+15}">{calendar.month_abbr[month]} {str(year)[2:]}</text>')
        for n in range(1,calendar.monthrange(year,month)[1]+1):
            stamp=date(year,month,n).isoformat(); day=lookup.get(stamp,{})
            has=day.get('history_observed_by_client',{}).get(client) is True
            ratio=day.get('ratios_by_client',{}).get(client)
            kind='paired' if ratio is not None else 'zero-work' if has and day.get('developer_hours')==0 else ''
            label='calculable ratio' if kind=='paired' else 'history, zero recorded work hours' if kind=='zero-work' else 'no captured history'
            out.append(f'<rect class="calendar-cell {kind}" x="{102+(n-1)*25}" y="{y}" width="18" height="18"><title>{stamp}: {label}</title></rect>')
    out.append('</svg>')
    return ''.join(out)


def insights(report,data):
    primary='opencode' if 'opencode' in data else next(iter(data))
    values=data[primary]; points=values['points']
    name={'opencode':'OpenCode','claude':'Claude Code','codex':'Codex','claude-desktop':'Claude Chat (Desktop/web)'}[primary]
    n=len(points); spans=sum(p['activity'] for p in points); work=sum(p['work'] for p in points)
    maximum=max(1,math.ceil(max(spans,work)/100)*100)
    hour_bars=measure('Activity spans',spans,maximum)+measure('Recorded work',work,maximum,neutral=True)
    hour_bars+=f'<div class="axis-ends"><span>0 h</span><span>{maximum:g} h</span></div>'
    bins=[sum(0<=p['ratio']<.25 for p in points),sum(.25<=p['ratio']<1 for p in points),
          sum(1<=p['ratio']<2 for p in points),sum(2<=p['ratio']<5 for p in points),sum(p['ratio']>=5 for p in points)]
    below=sum(p['ratio']<1 for p in points)
    distribution_title='Most paired dates fall below 1×' if below>n/2 else 'Most paired dates reach at least 1×' if n else 'No paired dates are available'
    distribution=''.join(measure(label,count,max(1,max(bins)),unit='d') for label,count in zip(('Below 0.25×','0.25–1×','1–2×','2–5×','5× or more'),bins))
    largest=sorted(points,key=lambda p:p['activity'],reverse=True)[:5]
    top_total=sum(p['activity'] for p in largest)
    share=top_total/spans*100 if spans else 0
    concentration=segments(top_total,spans,f'Top {len(largest)} dates / h','Other dates / h')
    concentration+=''.join(measure(date.fromisoformat(p['date']).strftime('%b %d'),p['activity'],max(1,max((p['activity'] for p in largest),default=1))) for p in largest)
    all_hours=report['clients'][primary].get('observed_inferred_work_hours')
    all_hours=max(spans,all_hours) if type(all_hours) in (int,float) else spans
    all_work=sum(day.get('developer_hours') or 0 for day in report['days'])
    omitted=all_hours-spans
    coverage=segments(work,all_work,'Paired work h','Other recorded work h')
    quality=report['classification_counts']; accepted=quality.get('work',0)
    total=sum(quality.values()); excluded=total-accepted
    issues=report.get('unknown_reason_counts',{})
    failed_unresolved=issues.get('failure_circuit_open',0)+issues.get('model_transport_failure',0)
    quality_picture=segments(accepted,total,'Included sessions','Excluded sessions')
    quality_picture+=measure('Model unavailable',failed_unresolved,max(1,excluded),unit='sessions')
    quality_picture+=measure('Other exclusions',max(0,excluded-failed_unresolved),max(1,excluded),unit='sessions',neutral=True)
    profile=report.get('profiling',{}); phases=profile.get('phases',{})
    timing_labels={'session_load':'Read / parse','metadata_discovery':'Metadata','local_triage':'Local / cache','report_write':'Report writes','model_request':'Model requests'}
    phase_values={key:phases.get(key,{}).get('total_seconds',0) for key in timing_labels}
    max_time=max(1,max(phase_values.values(),default=1))
    timing_picture=''.join(measure(timing_labels[key],phase_values[key],max_time,unit='s',neutral=key!='session_load')
                           for key in sorted(phase_values,key=phase_values.get,reverse=True))
    history_picture=calendar_svg(report,primary)
    paired_share=work/all_work*100 if all_work else 0
    healthy=report.get('profiling',{}).get('requests',{}).get('success',0)>0
    dominant=max(phase_values,key=phase_values.get)
    runtime_title='No runtime phases were profiled' if not any(phase_values.values()) else 'File reading dominates this particular run' if dominant=='session_load' else 'Model requests dominate this run' if dominant=='model_request' else 'Runtime phases at a glance'
    runtime_caption=('Model requests failed quickly in this run, so these timings do not benchmark healthy model-generation speed.'
                     if not healthy and report.get('classifier_counts',{}).get('failed_calls',0) else
                     'These cumulative phase timings can overlap across workers and are not developer or agent work hours.')
    local_only=report.get('classifier_counts',{}).get('keyword_work_sessions',0)==accepted and accepted>0
    attribution='included sessions in this run were accepted by local reference rules' if local_only else 'automatic or operator-declared ownership is not independent verification'
    return f'''<section class="insights" id="additional-stats"><p class="eyebrow">{name} / interpretation</p><h2>What sits behind the headline ratio</h2>
<div class="insight-grid">
<figure><h3>Activity and work are different measures</h3>{hour_bars}<figcaption>{spans:,.1f} captured activity hours divided by {work:,.1f} recorded work hours gives the paired-day ratio; parallel spans and waiting are included.</figcaption></figure>
<figure><h3>{distribution_title}</h3><p class="stat-large">{below/n*100 if n else 0:.0f}%</p><p class="stat-note">{below} of {n} calculable dates fall below 1×, not a performance score</p>{distribution}<figcaption>The typical daily ratio can be lower than the ratio of sums because activity and recorded work hours vary by date.</figcaption></figure>
<figure><h3>A few dates account for much of the activity</h3><p class="stat-large">{share:.1f}%</p><p class="stat-note">of paired activity spans on the top {len(largest)} dates</p>{concentration}<figcaption>{len(largest)} of {n} dates account for {share:.1f}% of paired response-span hours, so a small number of dates strongly influence the total.</figcaption></figure>
<figure><h3>The paired denominator is a selected subset</h3><p class="stat-large">{paired_share:.1f}%</p><p class="stat-note">of all recorded TimeSentry work hours enters this client’s paired ratio</p>{coverage}{segments(spans,all_hours,'Paired activity h','Activity on zero-work dates h')}<figcaption>{omitted:,.1f} captured activity hours fall on dates with zero recorded work hours and have no daily ratio; absence of a ratio does not erase those observations.</figcaption></figure>
</div><figure><h3>Recorded history is not the full calendar</h3><div class="calendar-scroll">{history_picture}</div><div class="calendar-legend"><span><i class="swatch paired"></i>history + positive work hours</span><span><i class="swatch zero-work"></i>history + zero work hours</span><span><i class="swatch"></i>no retained history</span></div><figcaption>{values['history']} dates have retained history; {len(points)} are paired and {values['zero_work']} have zero recorded work hours, while blank dates are not evidence of zero actual usage.</figcaption></figure>
<p class="eyebrow">Whole run / quality and cost</p><h2>Attribution and runtime need context too</h2><div class="insight-grid">
<figure><h3>Excluded does not mean proven personal</h3>{quality_picture}<figcaption>{failed_unresolved:,} of {excluded:,} excluded sessions reflect model transport/circuit failures; {attribution}.</figcaption></figure>
<figure><h3>{runtime_title}</h3>{timing_picture}<p class="small-print">Cumulative worker-seconds, not wall time. Phases can overlap.</p><figcaption>{runtime_caption}</figcaption></figure>
</div></section>'''


SCRIPT='''
const extra=JSON.parse(document.getElementById('ratio-extra-data').textContent);
const panel=document.getElementById('panel-opencode');
if(panel&&extra.focusSvg){
 const figure=panel.querySelector('figure');
 const frame=figure.querySelector('.frame');
 const full=frame.innerHTML;
 const metric=panel.querySelector(':scope > p.meta');const fullMetric=metric?metric.textContent:'';
 const controls=document.createElement('div');controls.className='chart-controls';controls.setAttribute('role','group');controls.setAttribute('aria-label','Daily ratio display range');
 controls.innerHTML='<button type="button" aria-pressed="true">Full range</button><button type="button" aria-pressed="false">Focus 0–2×</button><output>All values shown on a linear scale</output>';
 figure.prepend(controls);
 const selected=document.createElement('div');selected.className='selected-day';selected.setAttribute('aria-live','polite');
 figure.append(selected);
 const format=(value,digits=3)=>Number(value).toLocaleString('en-CA',{maximumFractionDigits:digits,minimumFractionDigits:digits});
 const show=point=>{selected.innerHTML='<div><span>Selected Montréal date</span><strong>'+point.date+'</strong></div><div><span>Captured activity spans</span><strong>'+format(point.activity)+' h</strong></div><div><span>Recorded work</span><strong>'+format(point.work)+' h</strong></div><div><span>Daily ratio</span><strong>'+format(point.ratio,5)+'×</strong></div>';};
 const wire=()=>frame.querySelectorAll('g[aria-label]').forEach((node,index)=>{node.addEventListener('mouseenter',()=>show(extra.points[index]));node.addEventListener('focus',()=>show(extra.points[index]));node.addEventListener('click',()=>show(extra.points[index]));});
 const buttons=controls.querySelectorAll('button');
 buttons.forEach((button,index)=>button.addEventListener('click',()=>{frame.innerHTML=index?extra.focusSvg:full;if(metric)metric.textContent=index?fullMetric.replace('linear scale, no clipping','focus 0–2×; outliers marked'):fullMetric;buttons.forEach((b,i)=>b.setAttribute('aria-pressed',String(index===i)));controls.querySelector('output').textContent=index?'Triangles mark '+extra.clipped+' dates above 2×; values remain in the detail strip':'All values shown on a linear scale';wire();}));
 wire();if(extra.points.length)show(extra.points.reduce((a,b)=>a.ratio>b.ratio?a:b));
}
Object.entries(extra.topShares).forEach(([client,value])=>{const node=document.querySelector('#panel-'+client+' .kpi:last-child');if(!node)return;node.querySelector('.ve-label').textContent='Top dates / activity share';node.querySelector('.val').textContent=value===null?'n/a':value.toFixed(1)+'%';node.querySelector('.meta').textContent='Share of captured activity on the top '+extra.topCounts[client]+' dates';const fill=node.querySelector('svg .bar');if(fill)fill.setAttribute('width',value===null?'0':String(144*value/100));});
'''


def enhance_html(text,report,data):
    from ratio_chart import svg_chart
    requested=f"{report['since']}–{report['until']}"
    failed=report.get('classifier_counts',{}).get('failed_calls',0)
    local_only=report.get('classifier_counts',{}).get('keyword_work_sessions',0)==report.get('classification_counts',{}).get('work',0)
    quality=(f'<b>{failed} model requests failed</b> in this run; local matching rules supplied the included work.' if failed and local_only
             else 'Attribution uses automated rules/models or an operator declaration, not independent verification.')
    denominator='TimeSentry hours were retrieved successfully.' if report.get('timesentry_coverage') in ('complete','operator_confirmed') else 'This older report can be rebuilt with the current CLI to calculate ratios.'
    failures='<div class="request-cells" aria-label="Failed model requests">'+''.join('<span>×</span>' for _ in range(min(failed,8)))+'</div>' if failed else ''
    headline=f'''<header class="dashboard-head"><div><p class="eyebrow">Agent hours / daily ratio explorer</p><h1>Activity ratios, with context.</h1><p class="lead">Compare captured agent activity with recorded work hours, one Montréal date at a time.</p><p class="meta">Requested period: {requested} · client metrics remain separate</p></div><aside class="scope-note"><span class="chip warn">Unverified attribution</span><p>{denominator} Agent history and work attribution remain unverified.</p>{failures}<p>{quality}</p></aside></header>'''
    text=re.sub(r'<header>.*?</header>',lambda _:headline,text,count=1,flags=re.S)
    text=text.replace('</style>',CSS+'\n</style>',1)
    text=text.replace('<section class="sources"',insights(report,data)+'<section class="sources"',1)
    text=re.sub(r'<p><span class="chip warn">Rules-only / unverified</span>.*?</p>','',text,count=1)
    shares={}
    for client,values in data.items():
        amounts=sorted((point['activity'] for point in values['points']),reverse=True)
        shares[client]=sum(amounts[:5])/sum(amounts)*100 if sum(amounts)>0 else None
    points=data.get('opencode',{}).get('points',[])
    payload={'focusSvg':svg_chart('opencode',data['opencode'],y_limit=2) if 'opencode' in data else None,
             'points':points,'clipped':sum(p['ratio']>2 for p in points),'topShares':shares,
             'topCounts':{client:min(5,len(values['points'])) for client,values in data.items()}}
    encoded=json.dumps(payload).replace('<','\\u003c')
    text=text.replace('</body>',f'<script id="ratio-extra-data" type="application/json">{encoded}</script><script>{SCRIPT}</script></body>',1)
    return text


def update_existing_source(source,report):
    from ratio_chart import chart_data
    path=Path(source); text=path.read_text()
    if 'ratio-extra-data' in text: raise ValueError('dashboard_already_enhanced')
    path.write_text(enhance_html(text,report,chart_data(report)))
