import fs from 'node:fs/promises';
import path from 'node:path';
import { load, DATA, ROOT, log } from './lib/util.js';

const board = await load('board.json');
if (!board) { console.error('Run `npm run score` first.'); process.exit(1); }

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FPL board — GW${board.meta?.nextGw ?? '?'}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{
  --paper:#EFF2F1; --panel:#FFFFFF; --ink:#10161B; --muted:#5C6B70; --rule:#D3DAD8;
  --diff:#0B6E4F; --diff-bg:#E2EFE9; --trap:#A83A20; --trap-bg:#F6E7E2;
  --tmpl:#3E5C76; --tmpl-bg:#E5EAEF; --warn:#8A6A0B;
  --fd1:#1B8A5A; --fd2:#68A83B; --fd3:#B9A227; --fd4:#C4692A; --fd5:#A83A20;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:400 15px/1.5 Archivo,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.num{font-family:"IBM Plex Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}
.wrap{max-width:1180px;margin:0 auto;padding:0 20px 80px}

header{border-bottom:2px solid var(--ink);padding:26px 0 16px;margin-bottom:26px;display:flex;flex-wrap:wrap;gap:24px;align-items:flex-end;justify-content:space-between}
h1{margin:0;font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}
.gw{font-family:"IBM Plex Mono",monospace;font-size:46px;font-weight:600;line-height:1;margin:6px 0 0;letter-spacing:-.02em}
.countdown{text-align:right}
.countdown .val{font-family:"IBM Plex Mono",monospace;font-size:30px;font-weight:600;line-height:1}
.countdown .lbl,.meta{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.meta{margin-top:6px}

h2{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:0 0 12px;padding-bottom:8px;border-bottom:1px solid var(--rule)}
.panel{background:var(--panel);border:1px solid var(--rule);padding:18px 20px 20px;margin-bottom:22px}

#scatter{width:100%;height:auto;display:block}
.axis-note{font-size:12px;color:var(--muted);margin:10px 0 0}
.legend{display:flex;flex-wrap:wrap;gap:16px;margin-top:12px;font-size:12px;color:var(--muted)}
.legend span{display:flex;align-items:center;gap:6px}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block}

.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:22px}
ul.cards{list-style:none;margin:0;padding:0}
ul.cards li{padding:11px 0;border-bottom:1px solid var(--rule);display:flex;gap:12px;align-items:flex-start}
ul.cards li:last-child{border-bottom:0}
.who{flex:1;min-width:0}
.nm{font-weight:500}
.sub{font-size:12px;color:var(--muted);margin-top:2px}
.reason{font-size:12px;color:var(--muted);margin-top:4px;font-style:italic}
.stat{font-family:"IBM Plex Mono",monospace;font-size:13px;text-align:right;white-space:nowrap}
.stat b{display:block;font-weight:600;font-size:15px}

.tick{display:inline-flex;gap:2px;margin-top:5px}
.tick i{width:15px;height:15px;font-style:normal;font-family:"IBM Plex Mono",monospace;font-size:8px;line-height:15px;text-align:center;color:#fff;border-radius:2px}
.d1{background:var(--fd1)}.d2{background:var(--fd2)}.d3{background:var(--fd3)}.d4{background:var(--fd4)}.d5{background:var(--fd5)}

.tag{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:2px 6px;border-radius:2px}
.t-diff{background:var(--diff-bg);color:var(--diff)}
.t-trap{background:var(--trap-bg);color:var(--trap)}
.t-tmpl{background:var(--tmpl-bg);color:var(--tmpl)}
.t-flag{background:#F6EEDC;color:var(--warn)}

table{width:100%;border-collapse:collapse;font-size:14px}
th{text-align:left;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);padding:0 10px 8px 0;border-bottom:1px solid var(--rule);cursor:pointer;user-select:none}
th:hover{color:var(--ink)}
td{padding:9px 10px 9px 0;border-bottom:1px solid var(--rule)}
tbody tr.owned{background:#FBF8E9}
.controls{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
input,select{font:400 13px Archivo,sans-serif;padding:7px 10px;border:1px solid var(--rule);background:var(--panel);color:var(--ink);border-radius:2px}
.empty{color:var(--muted);font-size:13px;padding:14px 0}
footer{margin-top:36px;padding-top:14px;border-top:1px solid var(--rule);font-size:11px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase}
@media (max-width:640px){.gw{font-size:34px}.countdown{text-align:left}}
</style>
</head>
<body>
<div class="wrap">
<header>
  <div>
    <h1>FPL board</h1>
    <p class="gw">GW${board.meta?.nextGw ?? '—'}</p>
    <p class="meta">${board.teamName ? esc(board.teamName) : 'Squad not loaded'}${board.overallRank ? ` &middot; OR ${board.overallRank.toLocaleString()}` : ''} &middot; ${board.videosProcessed} videos read</p>
  </div>
  <div class="countdown">
    <div class="val" id="cd">--:--:--</div>
    <div class="lbl">to deadline</div>
  </div>
</header>

<section class="panel">
  <h2>Ownership against underlying score</h2>
  <svg id="scatter" viewBox="0 0 900 440" role="img" aria-label="Scatter plot of player ownership against data score, split into four quadrants"></svg>
  <p class="axis-note">Bottom-right is where rank is won: strong numbers the crowd has not bought yet. Ringed markers are in your squad.</p>
  <div class="legend">
    <span><i class="dot" style="background:var(--diff)"></i>Differential</span>
    <span><i class="dot" style="background:var(--tmpl)"></i>Template</span>
    <span><i class="dot" style="background:var(--trap)"></i>Hype trap</span>
    <span><i class="dot" style="background:#B4BFBC"></i>Ignore</span>
  </div>
</section>

<div class="grid">
  <section class="panel"><h2>Differentials</h2><ul class="cards" id="l-diff"></ul></section>
  <section class="panel"><h2>Ahead of the crowd</h2><ul class="cards" id="l-curve"></ul></section>
  <section class="panel"><h2>Captaincy</h2><ul class="cards" id="l-capt"></ul></section>
  <section class="panel"><h2>Hype traps</h2><ul class="cards" id="l-trap"></ul></section>
  <section class="panel"><h2>Template core</h2><ul class="cards" id="l-tmpl"></ul></section>
  <section class="panel"><h2>Risks in your squad</h2><ul class="cards" id="l-risk"></ul></section>
</div>

<section class="panel">
  <h2>All players</h2>
  <div class="controls">
    <input id="q" type="search" placeholder="Search name or club" style="flex:1;min-width:180px">
    <select id="pos"><option value="">All positions</option><option>GKP</option><option>DEF</option><option>MID</option><option>FWD</option></select>
    <select id="quad"><option value="">All quadrants</option><option value="differential">Differential</option><option value="template">Template</option><option value="hype-trap">Hype trap</option><option value="ignore">Ignore</option></select>
    <select id="own"><option value="">Any ownership</option><option value="10">Under 10%</option><option value="5">Under 5%</option></select>
  </div>
  <table>
    <thead><tr>
      <th data-k="name">Player</th><th data-k="position">Pos</th><th data-k="price">£</th>
      <th data-k="ownership">Own %</th><th data-k="epNext">xPts</th><th data-k="dataScore">Data</th>
      <th data-k="expertScore">Expert</th><th>Next ${board.players[0]?.fixtures.length ?? 5}</th>
    </tr></thead>
    <tbody id="rows"></tbody>
  </table>
</section>

<footer>Built ${new Date(board.builtAt).toUTCString()} &middot; FPL API + ${board.videosProcessed} pundit videos</footer>
</div>

<script id="board" type="application/json">${JSON.stringify(board).replace(/</g, '\\u003c')}</script>
<script>
const B = JSON.parse(document.getElementById('board').textContent);
const QC = { differential:'#0B6E4F', template:'#3E5C76', 'hype-trap':'#A83A20', ignore:'#B4BFBC' };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function deadline(){
  if(!B.meta?.deadline){ document.getElementById('cd').textContent='—'; return; }
  const tick = () => {
    const ms = new Date(B.meta.deadline) - Date.now();
    const el = document.getElementById('cd');
    if(ms <= 0){ el.textContent = 'LOCKED'; return; }
    const d = Math.floor(ms/864e5), h = Math.floor(ms/36e5)%24, m = Math.floor(ms/6e4)%60, s = Math.floor(ms/1e3)%60;
    el.textContent = (d ? d+'d ' : '') + String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
  };
  tick(); setInterval(tick, 1000);
}

function ticker(fx){
  if(!fx.length) return '<span class="sub">no fixtures</span>';
  return '<span class="tick">' + fx.map(f =>
    '<i class="d'+f.difficulty+'" title="GW'+f.gw+' '+(f.home?'vs ':'at ')+f.opponent+'">'+f.opponent.slice(0,3)+'</i>'
  ).join('') + '</span>';
}

function card(p, statLabel, statVal){
  const reason = p.opinions?.[0]?.reason;
  return '<li><div class="who"><div class="nm">'+esc(p.name)+
    (p.flagged ? ' <span class="tag t-flag">flag</span>' : '')+'</div>'+
    '<div class="sub">'+p.position+' &middot; '+esc(p.team)+' &middot; £'+p.price.toFixed(1)+' &middot; '+p.ownership.toFixed(1)+'% owned'+
    (p.channelsCovering ? ' &middot; '+p.channelsCovering+' channels' : '')+'</div>'+
    ticker(p.fixtures)+
    (reason ? '<div class="reason">"'+esc(reason)+'"</div>' : '')+
    '</div><div class="stat"><b>'+statVal(p)+'</b>'+statLabel+'</div></li>';
}

function fill(id, list, label, val){
  const el = document.getElementById(id);
  el.innerHTML = list.length ? list.map(p => card(p, label, val)).join('')
    : '<li class="empty">Nothing here yet.</li>';
}

fill('l-diff', B.lists.differentials, 'data', p => p.dataScore.toFixed(2));
fill('l-curve', B.lists.aheadOfCurve, 'expert', p => p.expertScore.toFixed(2));
fill('l-capt', B.lists.captaincy, 'calls', p => p.captainCalls || p.epNext.toFixed(1));
fill('l-trap', B.lists.hypeTraps, 'data', p => p.dataScore.toFixed(2));
fill('l-tmpl', B.lists.template, 'own %', p => p.ownership.toFixed(0));
fill('l-risk', B.lists.squadRisks, 'data', p => p.dataScore.toFixed(2));

function scatter(){
  const svg = document.getElementById('scatter');
  const W=900,H=440,L=56,R=20,T=18,Bm=44;
  const ds = B.players.map(p=>p.dataScore);
  const yMin=Math.min(...ds), yMax=Math.max(...ds);
  const xMax=Math.max(60, Math.max(...B.players.map(p=>p.ownership)));
  const x=v=>L+(1-v/xMax)*(W-L-R);
  const y=v=>T+(1-(v-yMin)/(yMax-yMin||1))*(H-T-Bm);
  const midY=y((yMin+yMax)/2), midX=x(xMax/2);
  let s='';
  s+='<rect x="'+L+'" y="'+T+'" width="'+(W-L-R)+'" height="'+(H-T-Bm)+'" fill="#FBFCFC" stroke="#D3DAD8"/>';
  s+='<line x1="'+L+'" y1="'+midY+'" x2="'+(W-R)+'" y2="'+midY+'" stroke="#D3DAD8" stroke-dasharray="3 3"/>';
  s+='<line x1="'+midX+'" y1="'+T+'" x2="'+midX+'" y2="'+(H-Bm)+'" stroke="#D3DAD8" stroke-dasharray="3 3"/>';
  s+='<text x="'+(W-R-10)+'" y="'+(T+20)+'" text-anchor="end" font-size="11" font-family="IBM Plex Mono" fill="#0B6E4F">DIFFERENTIAL</text>';
  s+='<text x="'+(L+10)+'" y="'+(T+20)+'" font-size="11" font-family="IBM Plex Mono" fill="#3E5C76">TEMPLATE</text>';
  s+='<text x="'+(L+10)+'" y="'+(H-Bm-10)+'" font-size="11" font-family="IBM Plex Mono" fill="#A83A20">HYPE TRAP</text>';
  for(const p of B.players){
    if(p.dataScore < yMin + (yMax-yMin)*0.25 && p.ownership < 3) continue;
    const cx=x(p.ownership), cy=y(p.dataScore);
    const r=p.owned?6:4;
    s+='<circle cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="'+r+'" fill="'+QC[p.quadrant]+'" fill-opacity="'+(p.owned?1:0.65)+'"'+
       (p.owned?' stroke="#10161B" stroke-width="2"':'')+'><title>'+esc(p.name)+' — '+p.ownership.toFixed(1)+'% owned, data '+p.dataScore.toFixed(2)+'</title></circle>';
  }
  const labelled=[...B.players].sort((a,b)=>b.dataScore-a.dataScore).slice(0,14);
  for(const p of labelled){
    s+='<text x="'+(x(p.ownership)+8).toFixed(1)+'" y="'+(y(p.dataScore)+4).toFixed(1)+'" font-size="11" font-family="Archivo" fill="#10161B">'+esc(p.name)+'</text>';
  }
  s+='<text x="'+(W/2)+'" y="'+(H-14)+'" text-anchor="middle" font-size="11" font-family="IBM Plex Mono" fill="#5C6B70">← LESS OWNED &nbsp;&nbsp; OWNERSHIP &nbsp;&nbsp; MORE OWNED →</text>';
  s+='<text x="16" y="'+(H/2)+'" text-anchor="middle" font-size="11" font-family="IBM Plex Mono" fill="#5C6B70" transform="rotate(-90,16,'+(H/2)+')">DATA SCORE →</text>';
  svg.innerHTML=s;
}

let sortKey='dataScore', sortDir=-1;
function rows(){
  const q=document.getElementById('q').value.toLowerCase();
  const pos=document.getElementById('pos').value;
  const quad=document.getElementById('quad').value;
  const own=parseFloat(document.getElementById('own').value);
  let list=B.players.filter(p=>
    (!q || p.name.toLowerCase().includes(q) || p.teamName.toLowerCase().includes(q)) &&
    (!pos || p.position===pos) && (!quad || p.quadrant===quad) && (!own || p.ownership<own));
  list.sort((a,b)=>{const x=a[sortKey],y=b[sortKey];
    return (typeof x==='string'? x.localeCompare(y) : x-y)*sortDir;});
  document.getElementById('rows').innerHTML=list.slice(0,180).map(p=>
    '<tr class="'+(p.owned?'owned':'')+'"><td><span class="nm">'+esc(p.name)+'</span> '+
    '<span class="tag t-'+(p.quadrant==='differential'?'diff':p.quadrant==='template'?'tmpl':p.quadrant==='hype-trap'?'trap':'flag')+'">'+p.quadrant+'</span>'+
    '<div class="sub">'+esc(p.teamName)+(p.news?' &middot; '+esc(p.news):'')+'</div></td>'+
    '<td class="num">'+p.position+'</td><td class="num">'+p.price.toFixed(1)+'</td>'+
    '<td class="num">'+p.ownership.toFixed(1)+'</td><td class="num">'+p.epNext.toFixed(1)+'</td>'+
    '<td class="num">'+p.dataScore.toFixed(2)+'</td><td class="num">'+p.expertScore.toFixed(2)+'</td>'+
    '<td>'+ticker(p.fixtures)+'</td></tr>').join('');
}
document.querySelectorAll('th[data-k]').forEach(th=>th.onclick=()=>{
  const k=th.dataset.k; sortDir = sortKey===k ? -sortDir : -1; sortKey=k; rows();});
['q','pos','quad','own'].forEach(id=>document.getElementById(id).oninput=rows);

deadline(); scatter(); rows();
</script>
</body>
</html>`;

const out = path.join(ROOT, 'dist');
await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, 'index.html'), html);
log(`Dashboard written to dist/index.html (${(html.length / 1024).toFixed(0)} KB)`);

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
