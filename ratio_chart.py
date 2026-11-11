"""Local charts from aggregate daily ratios; never opens transcripts or model APIs."""
import argparse
from datetime import date
import html
import json
import math
from pathlib import Path
import statistics


LABELS={'opencode':'OpenCode','claude':'Claude Code','codex':'Codex','claude-desktop':'Claude Chat (Desktop/web)'}


def chart_data(report):
    result={}
    for client in report['clients']:
        if client not in LABELS: raise ValueError('unsupported_client')
        points=[]
        history=zero_work=0
        for day in report['days']:
            if day.get('history_observed_by_client',{}).get(client) is True:
                history+=1
                zero_work+=day.get('developer_hours')==0
            ratio=day.get('ratios_by_client',{}).get(client)
            if ratio is None: continue
            if type(ratio) not in (int,float) or not math.isfinite(ratio) or ratio<0:
                raise ValueError('invalid_ratio')
            stamp=day['date']; date.fromisoformat(stamp)
            points.append({'date':stamp,'ratio':ratio,'activity':day['captured_work_hours_by_client'][client],
                           'work':day['developer_hours']})
        points.sort(key=lambda p:p['date'])
        result[client]={'points':points,'history':history,'zero_work':zero_work,
                        'aggregate':report.get('observed_day_aggregates',{}).get(client,{}).get('ratio'),
                        'median':statistics.median(p['ratio'] for p in points) if points else None}
    return result


def scale(points):
    maximum=max((p['ratio'] for p in points),default=0)
    if maximum==0: return 1,.2
    raw=maximum/5
    power=10**math.floor(math.log10(raw))
    step=next(v*power for v in (1,2,2.5,5,10) if v*power>=raw)
    return math.ceil(maximum/step)*step,step


def svg_chart(client,values,standalone=False,y_limit=None):
    points=values['points']; maximum,step=scale(points)
    if y_limit is not None: maximum,step=y_limit,y_limit/4
    width,height=1120,460
    left,right,top,bottom=76,28,32,76
    plotw,ploth=width-left-right,height-top-bottom
    parts=[f'<svg xmlns="http://www.w3.org/2000/svg" class="ve-svg ratio-chart" viewBox="0 0 {width} {height}" role="img" aria-label="{LABELS[client]} daily captured activity hours per recorded work hour">']
    if standalone:
        parts.append('<style>svg{background:#fafaf7;color:#182c35;font-family:Verdana,sans-serif}.grid{stroke:#dbe0de;stroke-width:1}.axis-label{fill:#52626a;font-size:13px}.bar{fill:#176d80}.zero{fill:#fafaf7;stroke:#176d80;stroke-width:2}.reference{stroke:#7c6a43;stroke-dasharray:5 5;stroke-width:1.4}.reference-label{fill:#6d5a33;font-size:12px}.annotation{fill:#182c35;font-size:13px;font-weight:600}.baseline{stroke:#829197;stroke-width:1}text{font-variant-numeric:tabular-nums}</style>')
    parts.append(f'<text class="axis-label" x="{left}" y="18">Captured activity hours / recorded developer hour</text>')
    for i in range(round(maximum/step)+1):
        tick=i*step; y=top+ploth*(1-tick/maximum)
        parts.append(f'<line class="grid" x1="{left}" x2="{width-right}" y1="{y:.2f}" y2="{y:.2f}"/>')
        parts.append(f'<text class="axis-label" x="{left-12}" y="{y+4:.2f}" text-anchor="end">{tick:g}×</text>')
    if not points:
        parts.append(f'<text class="annotation" x="{left+20}" y="{top+100}">No dates have a calculable daily ratio.</text>')
    else:
        first=date.fromisoformat(points[0]['date']); last=date.fromisoformat(points[-1]['date'])
        span=max(1,(last-first).days)
        def x(day): return left+10+(date.fromisoformat(day)-first).days/span*(plotw-20)
        barw=min(10,max(2.5,(plotw-20)/(span+1)*.7))
        if maximum>=1:
            y=top+ploth*(1-1/maximum)
            parts.append(f'<line class="reference" x1="{left}" x2="{width-right}" y1="{y:.2f}" y2="{y:.2f}"/>')
            parts.append(f'<text class="reference-label" x="{width-right}" y="18" text-anchor="end">Dashed line: 1×, not a productivity threshold</text>')
        for point in points:
            xx=x(point['date']); yy=top+ploth*(1-min(point['ratio'],maximum)/maximum)
            label=f"{point['date']}: {point['ratio']:.4f} activity h/work h; {point['activity']:.3f} captured h / {point['work']:.3f} work h"
            parts.append(f'<g tabindex="0" role="img" aria-label="{html.escape(label,quote=True)}"><title>{html.escape(label)}</title>')
            if point['ratio']==0:
                parts.append(f'<circle class="zero" cx="{xx:.2f}" cy="{top+ploth}" r="3.5"/>')
            else:
                parts.append(f'<rect class="bar" x="{xx-barw/2:.2f}" y="{yy:.2f}" width="{barw:.2f}" height="{max(.8,top+ploth-yy):.2f}"/>')
                if point['ratio']>maximum:
                    parts.append(f'<polygon class="overflow-marker" points="{xx:.2f},{top-7} {xx-5:.2f},{top+2} {xx+5:.2f},{top+2}"/>')
            parts.append('</g>')
        ticks=[points[0]['date']]
        for year in range(first.year,last.year+1):
            for month in range(1,13):
                value=date(year,month,1)
                if first<value<last and (value-first).days>8 and (last-value).days>8: ticks.append(value.isoformat())
        ticks.append(points[-1]['date'])
        for index,day in enumerate(dict.fromkeys(ticks)):
            xx=x(day); stamp=date.fromisoformat(day)
            anchor='start' if day==points[0]['date'] else 'end' if day==points[-1]['date'] else 'middle'
            parts.append(f'<text class="axis-label" x="{xx:.2f}" y="{top+ploth+29}" text-anchor="{anchor}">{stamp.strftime("%b %d")}</text>')
        parts.append(f'<text class="axis-label" x="{left}" y="{height-13}">Montréal calendar dates · {first.isoformat()}–{last.isoformat()} · gaps are not zero observations</text>')
        peak=max(points,key=lambda p:p['ratio'])
        if peak['ratio']>0 and y_limit is None:
            xx=x(peak['date']); yy=top+ploth*(1-peak['ratio']/maximum)
            right_side=xx<width*.65
            tx=xx+18 if right_side else xx-18
            anchor='start' if right_side else 'end'
            parts.append(f'<text class="annotation" x="{tx:.2f}" y="{max(top+15,yy-12):.2f}" text-anchor="{anchor}">{peak["ratio"]:.3f}× · {peak["date"]}</text>')
    parts.append(f'<line class="baseline" x1="{left}" x2="{width-right}" y1="{top+ploth}" y2="{top+ploth}"/>')
    parts.append('</svg>')
    return ''.join(parts)


def mini(value,maximum):
    fraction=0 if value is None else min(1,value/maximum)
    return f'<svg viewBox="0 0 144 12" aria-hidden="true"><rect class="mini-track" width="144" height="8"/><rect class="bar" width="{fraction*144:.2f}" height="8"/></svg>'


def _base_html_page(report,source,data):
    options=[]; labels=[]; panels=[]
    primary=report.get('primary_ratio_client','opencode')
    for client,values in data.items():
        checked=' checked' if client==primary else ''
        options.append(f'<input class="tab-input" type="radio" name="client" id="tab-{client}"{checked}>')
        labels.append(f'<label for="tab-{client}">{LABELS[client]}</label>')
        points=values['points']; maximum,_=scale(points)
        peak=max((p['ratio'] for p in points),default=0)
        fmt=lambda v:'n/a' if v is None else f'{v:.4f}'
        metrics=[('Paired dates',str(len(points)),mini(len(points),max(1,values['history'])),f"{values['zero_work']} zero-work-hour dates excluded"),
                 ('Ratio of sums',fmt(values['aggregate']),mini(values['aggregate'],maximum),'Not the average of daily ratios'),
                 ('Median daily ratio',fmt(values['median']),mini(values['median'],maximum),'Middle observed daily value'),
                 ('Highest daily ratio',fmt(peak),mini(peak,maximum),'Hover or focus a bar for its hours')]
        kpis=''.join(f'<div class="kpi"><span class="ve-label">{name}</span><span class="val num">{value}</span>{picture}<span class="meta">{html.escape(note)}</span></div>' for name,value,picture,note in metrics)
        mode='recorded response spans, including tools and waiting' if client=='opencode' else 'bounded-message-gap estimates, not measured execution runtime'
        top=sorted(points,key=lambda p:p['ratio'],reverse=True)[:10]
        ranking=''.join('<ve-bar value="'+(f'{p["ratio"]:.2f}' if p['ratio']>=10 else f'{p["ratio"]:.3f}')+'"'+(' hot' if i==0 else '')+f'>{date.fromisoformat(p["date"]).strftime("%b %d")}</ve-bar>' for i,p in enumerate(top))
        caption=(f'{LABELS[client]} has {len(points)} calculable daily ratios; dates with no history or zero work hours are not plotted.')
        peak_text=(f'The highest {LABELS[client]} ratio is {peak:.3f}×; the bars rank the highest observed dates.' if peak else
                   f'{LABELS[client]} has no measurable included work spans on its paired dates; captured zeros do not establish zero usage.')
        panels.append(f'<section class="client-panel" id="panel-{client}"><div class="kpis">{kpis}</div><p class="meta">{LABELS[client]} · {mode} · linear scale, no clipping</p>'
                      f'<figure><div class="frame">{svg_chart(client,values)}</div><figcaption><span class="fig-n">Fig. 1</span>{caption}</figcaption></figure>'
                      f'<details><summary>Rank the highest days</summary><figure><ve-bars unit="×" max="{maximum:g}" label="Highest daily ratios, descending">{ranking}</ve-bars>'
                      f'<figcaption><span class="fig-n">Fig. 2</span>{peak_text}</figcaption></figure></details></section>')
    tab_rules=''.join(f'#tab-{client}:checked~.client-tabs label[for="tab-{client}"]{{font-weight:700;border-color:var(--accent);color:var(--text)}}#tab-{client}:checked~.panels #panel-{client}{{display:block}}' for client in data)
    failed=report.get('classifier_counts',{}).get('failed_calls',0)
    quality=f'{failed} model requests failed in this run; included work came from local reference rules.' if failed and not report.get('profiling',{}).get('requests',{}).get('success') else 'Attribution is automatic and unverified; unknown sessions are excluded as personal for this estimate.'
    return f'''<!doctype html>
<html lang="en" data-register="instrument"><head><title>Daily captured activity / work-hour ratios</title>
<link rel="stylesheet" href="kit.css" data-ve-kit>
<style>
main{{display:block;max-width:1240px;margin:auto;padding:var(--s-4)}}h1{{font-size:var(--t-h2);max-width:40ch;margin:var(--s-2) 0}}header{{padding:0;margin:0 0 var(--s-3)}}header p{{margin:var(--s-2) 0}}.lead{{font-size:var(--t-body)}}
.meta{{color:var(--text-dim);font-size:var(--t-small)}}.client-tabs{{display:flex;gap:var(--s-4);border-bottom:1px solid var(--border);margin-bottom:var(--s-4)}}
.client-tabs label{{cursor:pointer;padding:var(--s-3) 0;border-bottom:2px solid transparent;color:var(--text-dim)}}
.tab-input{{position:absolute;width:1px;height:1px;opacity:0}}.tab-input:focus-visible~.client-tabs{{outline:2px solid var(--border-bright)}}
.client-panel{{display:none;margin:0;padding:0;border:0}}.kpis{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--s-3);margin:0 0 var(--s-3)}}
.kpi{{display:block;border:0;border-right:1px solid var(--border);border-radius:0;background:none;padding:var(--s-2) var(--s-3) var(--s-2) 0}}.kpi:last-child{{border-right:0}}.kpi .ve-label,.kpi .val{{display:block}}.kpi .val{{font-size:var(--t-h2)}}.kpi svg{{display:block;width:100%;height:12px;margin:var(--s-2) 0}}.kpi .meta{{display:block}}.frame{{background:none;padding:0;border:0}}
.ratio-chart{{width:100%;height:auto}}.grid{{stroke:var(--border);stroke-width:1}}.axis-label{{fill:var(--text-dim);font-size:14px}}.bar{{fill:var(--accent)}}
.mini-track{{fill:var(--border)}}.zero{{fill:var(--bg);stroke:var(--accent);stroke-width:2}}.reference{{stroke:var(--text-dim);stroke-width:1.4;stroke-dasharray:5 5}}
.reference-label{{fill:var(--text-dim);font-size:14px}}.annotation{{fill:var(--text);font-size:14px;font-weight:600}}.baseline{{stroke:var(--border-bright);stroke-width:1}}
.ratio-chart g:focus .bar,.ratio-chart g:hover .bar{{stroke:var(--text);stroke-width:2}}.ratio-chart text{{font-variant-numeric:tabular-nums}}
figure{{margin:0 0 var(--s-5)}}figcaption{{margin-top:var(--s-3)}}.sources{{margin-top:var(--s-6);overflow-wrap:anywhere}}details{{margin-top:var(--s-4)}}
@media(max-width:700px){{main{{padding:var(--s-3)}}.kpis{{grid-template-columns:repeat(2,minmax(0,1fr))}}.kpi .meta{{display:none}}.frame{{overflow:auto}}.ratio-chart{{min-width:1120px}}}}
{tab_rules}
</style></head><body><main>
<header><p class="eyebrow">Agent hours / observed-history proxy</p><h1>Daily captured activity per work hour</h1>
<p class="lead">Each bar is one Montréal date with recorded history and positive TimeSentry hours.</p>
<p class="meta">Requested period: {report['since']}–{report['until']} · TimeSentry complete by operator confirmation · clients stay separate</p></header>
{''.join(options)}<div class="client-tabs" aria-label="Choose a client">{''.join(labels)}</div><div class="panels">{''.join(panels)}</div>
<p><span class="chip warn">Rules-only / unverified</span> {html.escape(quality)}</p>
<p class="meta">Parallel sessions sum, and OpenCode spans include tool/test waiting. Ratios above 1× are not speedup or productivity. Missing ratios stay missing; captured zeros are not proof of zero usage. This is not a guaranteed full-period lower bound.</p>
<section class="sources" aria-label="Sources"><p class="ve-label caps">Local sources</p>
<p><a href="{html.escape(source.name,quote=True)}">Aggregate JSON report</a> · <a href="{html.escape(source.with_suffix('.daily.csv').name,quote=True)}">Daily CSV</a></p>
<p class="meta">Only dates, numeric activity/work totals and fixed client/metric labels appear here. No conversation text, working directories, session IDs or customer names.</p></section>
</main></body></html>'''


def html_page(report,source,data):
    from chart_insights import enhance_html
    return enhance_html(_base_html_page(report,source,data),report,data)


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report',type=Path)
    args=parser.parse_args(argv)
    report=json.loads(args.report.read_text())
    data=chart_data(report)
    prefix=args.report.parent/('daily-ratios-chart-'+report['until'])
    src=prefix.with_suffix('.src.html')
    primary=report.get('primary_ratio_client','opencode')
    svg=prefix.with_name(prefix.name+'-'+primary).with_suffix('.svg')
    if src.exists() or svg.exists(): raise ValueError('chart_output_already_exists')
    src.write_text(html_page(report,args.report,data))
    svg.write_text(svg_chart(primary,data[primary],standalone=True))
    src.chmod(0o600);svg.chmod(0o600)
    print('Source: '+str(src));print('SVG: '+str(svg))
    return 0


if __name__=='__main__': raise SystemExit(main())
