import { names,type Report } from './types.ts';
import { publicReport,type PublicReport } from './public-report.ts';
import { DASHBOARD_SCRIPT } from './dashboard-script.ts';
import CHART_RUNTIME from './vendor/chart-runtime.txt';
import { escapeHTML } from './person.ts';

export function dashboardHTML(input:Report):string {return publicDashboardHTML(publicReport(input));}
/** Render already-validated aggregates without creating another deep copy. */
export function publicDashboardHTML(report:PublicReport,serializedData?:string):string {
  const encoded=(serializedData??JSON.stringify(report)).replace(/</g,'\\u003c');
  const person=report.person?escapeHTML(report.person.name):null;
  const options='<option value="all">All clients</option>'+Object.keys(report.clients).map(c=>`<option value="${c}">${names[c as keyof typeof names]}</option>`).join('');
  const measures=Object.keys(report.clients).map(c=>`<tr><td>${names[c as keyof typeof names]}</td><td>${report.clients[c as keyof typeof report.clients]!.metric.includes('response')?'Recorded response spans':'Bounded message-gap estimate'}</td></tr>`).join('');
  return `<!doctype html>
<html lang="en" data-register="instrument"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>${person?person+' · ':''}Agent Hours · ${report.since}–${report.until}</title>
<style>
:root{color-scheme:light dark;--bg:#f9faf8;--surface:#fff;--text:#182e38;--dim:#526971;--line:#d9e0e1;--accent:#146683;--neutral:#778992}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 'Avenir Next','Segoe UI',Verdana,sans-serif;font-variant-numeric:tabular-nums}
main{display:block;max-width:1240px;margin:auto;padding:32px}header{display:grid;grid-template-columns:1fr minmax(250px,350px);gap:32px;align-items:center;padding:0}
h1{font:40px/1.1 Georgia,serif;margin:6px 0 12px}h2{font-size:24px;line-height:1.2;margin:0 0 20px}h3{font-size:17px;margin:0 0 14px}p{margin:8px 0}
h1{overflow-wrap:anywhere}
.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:var(--dim)}.meta,figcaption,.note{font-size:14px;color:var(--dim)}aside{border:1px solid var(--neutral);padding:12px 16px;font-size:14px}[hidden]{display:none!important}
.controls{display:flex;gap:14px;flex-wrap:wrap;margin:26px 0 20px;align-items:end}label{font-size:14px;color:var(--dim)}label span{display:block;margin-bottom:5px}
select,button{font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--neutral);border-radius:4px;padding:9px 12px}button{cursor:pointer}select:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;border-block:1px solid var(--line);margin-bottom:24px;background:none;border-radius:0}
.kpi{display:block;padding:18px 18px 18px 0;border:0;border-right:1px solid var(--line);margin-right:18px;background:none;border-radius:0}.kpi:last-child{border:0;margin:0}.value{font-size:31px;display:block;line-height:1.4}.kpi small{display:block;color:var(--dim)}
.ratio-summary{display:flex;gap:20px;flex-wrap:wrap;font-size:14px;margin:-10px 0 20px;color:var(--dim)}
figure{margin:0 0 32px}figcaption{margin-top:10px}.chart-scroll,.table-scroll{overflow:auto}.chart-box{position:relative;height:380px;width:100%;min-width:0}.chart-box canvas{display:block}.chart-box.compact{height:220px}#legend:empty{display:none}
.grid{stroke:var(--line);stroke-width:1}.reference{stroke:var(--dim);stroke-width:1;stroke-dasharray:4 4}.legend{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:14px;font-size:14px}.key{display:inline-block;width:11px;height:11px;vertical-align:middle;margin-right:7px;background:var(--accent)}
section{margin-top:42px;padding:0;border:0}.twocol{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:36px}.bar-row{display:grid;grid-template-columns:130px minmax(0,1fr) 90px;gap:12px;align-items:center;font-size:14px;margin:13px 0}.rail{height:10px;background:var(--line)}.fill{height:100%;background:var(--accent)}.bar-row b{text-align:right;font-weight:500}
.stack{height:22px;display:flex;margin:12px 0}.stack span{height:100%;border-right:2px solid var(--bg)}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-bottom:1px solid var(--line);padding:9px 10px;text-align:right;white-space:nowrap}th{font-weight:500;color:var(--dim)}th:first-child,td:first-child{text-align:left}
details summary{cursor:pointer;margin-bottom:14px}footer{border-top:1px solid var(--line);padding-top:20px;margin-top:36px}.note{max-width:90ch}.unavailable{color:var(--dim)}
@media(prefers-color-scheme:dark){:root{--bg:#101b21;--surface:#16262e;--text:#e0ebef;--dim:#a6bac4;--line:#30414a;--accent:#70c3dc;--neutral:#849ba6}}
@media(max-width:750px){main{padding:20px}header,.twocol{grid-template-columns:1fr;gap:20px}h1{font-size:32px}.kpis{grid-template-columns:1fr 1fr}.kpi{margin:0;padding:14px 14px 14px 0}.value{font-size:27px}.controls{gap:12px}.controls label{flex:1 1 145px}.controls button{width:100%}select{max-width:100%;width:100%}.bar-row{grid-template-columns:105px minmax(0,1fr) 80px;gap:8px}}
</style></head><body><main>
<header><div><p class="eyebrow">${person?'Agent Hours':'Activity report'}</p><h1>${person??'Agent Hours'}</h1><p class="meta">${report.since}–${report.until} · Montréal${report.current_day_in_progress?' · today is partial':''}</p></div><aside id="quality-box"><p id="quality"></p></aside></header>
<div class="controls">
<label><span>Client</span><select id="client">${options}</select></label>
<label><span>Measure</span><select id="measure"></select></label>
<label><span>Period</span><select id="period"><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option></select></label>
<label><span>Chart</span><select id="view"><option value="hours">Activity &amp; work hours</option><option value="ratio">Activity / work ratio</option></select></label>
<button id="download">Download JSON</button></div>
<div id="kpis" class="kpis"></div>
<div id="ratio-summary" class="ratio-summary"></div>
<figure><div id="legend" class="legend"></div><div id="main-chart" class="chart-scroll"></div><figcaption id="main-caption"></figcaption></figure>
<section><div class="twocol">
<figure><h2>Concurrency</h2><div id="overlap" class="table-scroll"></div><figcaption>Session totals and distinct elapsed time.</figcaption></figure>
<figure><h2>Most active dates</h2><div id="top-days"></div><figcaption id="concentration"></figcaption></figure>
</div></section>
<section><h2>Tools</h2><div class="twocol">
<figure><h3>Tool time</h3><div id="tools"></div><figcaption>Recorded wall time and round-trip estimates.</figcaption></figure>
<figure><h3>Results</h3><div id="tool-quality"></div><figcaption>Recorded durations and round-trip estimates.</figcaption></figure>
</div><figure><h3>Command categories</h3><div id="commands"></div><figcaption>Captured shell calls.</figcaption></figure></section>
<section><div class="twocol">
<figure><h2>Sessions</h2><div id="classification"></div><figcaption>Classification counts.</figcaption></figure>
<figure><h2>Tokens &amp; cost</h2><div id="usage" class="table-scroll"></div><figcaption>Source-reported usage and estimated cost.</figcaption></figure>
</div><p id="coverage" class="note"></p></section>
<section><details><summary>Daily data</summary><div id="daily-table" class="table-scroll"></div></details></section>
<footer><details><summary>About these numbers</summary>
<p class="note">${report.daily_ratio_interpretation}</p><p class="note">${report.telemetry_interpretation??'Detailed telemetry was not collected in this report.'}</p>
<p class="note">Summed agent-hours add each client's captured session durations. Parallel agents count separately: five agents for one developer hour gives five agent-hours (5×). Client measurement methods differ, so the total is a captured-activity proxy, not CPU runtime. The optional elapsed message-gap view removes overlap and is a different metric.</p>
<p class="note">Per-client ratios and the optional elapsed estimate use returned TimeSentry hours on matched dates with positive work hours. Work hours are never counted once per client.</p>
<p class="note">The summed all-client ratio divides all captured agent-hours by developer hours on dates with available agent history. Agent-hours on zero-work dates remain in that total, but no daily ratio is defined for a zero-hour denominator.</p>
<table><thead><tr><th>Client</th><th>Primary activity measure</th></tr></thead><tbody>${measures}</tbody></table>
<p class="note">This dashboard is offline and includes its aggregate JSON. Source conversations, commands, private paths and session IDs are not included.</p>
</details></footer></main>
<script type="application/json" id="report-data">${encoded}</script><script>${CHART_RUNTIME}</script><script>${DASHBOARD_SCRIPT}</script></body></html>`;
}
