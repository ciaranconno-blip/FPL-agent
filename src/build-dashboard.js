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
<link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@500;700;800;900&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{
  --bg-deep:#22002A; --bg-panel:#3A0F45; --bg-panel-hi:#4C1657;
  --line:rgba(255,255,255,.10); --line-strong:rgba(255,255,255,.20);
  --ink:#F6EEF7; --muted:#C6A6CB; --muted-dim:#9578A0;
  --green:#00FF87; --green-deep:#0B6B44;
  --cyan:#28E8FF; --pink:#FF4D8D; --gold:#FFC94D;
  --fd1:#00FF87; --fd2:#8CE666; --fd3:#FFC94D; --fd4:#FF8A5B; --fd5:#FF4D8D;
  --turf1:#063321; --turf2:#0B4D31; --turf-line:rgba(255,255,255,.24);
}
*{box-sizing:border-box}
body{
  margin:0;
  background:
    radial-gradient(1200px 600px at 12% -8%, rgba(0,255,135,.12), transparent 58%),
    radial-gradient(900px 520px at 102% 2%, rgba(40,232,255,.10), transparent 55%),
    linear-gradient(180deg,#2C0836 0%,#1B0522 55%,#14021A 100%);
  background-attachment:fixed;
  color:var(--ink);
  font:400 15px/1.6 "Plus Jakarta Sans",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased;
}
.num{font-family:"IBM Plex Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums}
.wrap{max-width:1180px;margin:0 auto;padding:0 20px 80px}
:focus-visible{outline:2px solid var(--green);outline-offset:2px;border-radius:2px}

header{border-bottom:1px solid var(--line);padding:30px 0 20px;margin-bottom:26px;display:flex;flex-wrap:wrap;gap:24px;align-items:flex-end;justify-content:space-between}
h1{margin:0;font-family:"Unbounded",sans-serif;font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
.gw{font-family:"Unbounded",sans-serif;font-size:52px;font-weight:900;line-height:1;margin:8px 0 0;letter-spacing:-.02em;
  background:linear-gradient(100deg,var(--green),var(--cyan));-webkit-background-clip:text;background-clip:text;color:transparent}
.countdown{text-align:right}
.countdown .val{font-family:"IBM Plex Mono",monospace;font-size:28px;font-weight:600;line-height:1;color:var(--green);text-shadow:0 0 18px rgba(0,255,135,.45)}
.countdown .lbl,.meta{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted-dim)}
.meta{margin-top:8px}

h2{font-family:"Unbounded",sans-serif;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:0 0 16px;padding-bottom:10px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:10px}
.panel{
  background:linear-gradient(160deg,rgba(255,255,255,.05),rgba(255,255,255,.01)),var(--bg-panel);
  border:1px solid var(--line);border-radius:20px;padding:20px 22px 24px;margin-bottom:22px;
  box-shadow:0 1px 0 rgba(255,255,255,.06) inset,0 24px 48px -30px rgba(0,0,0,.7);
}

.tag{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:3px 9px;border-radius:99px;white-space:nowrap}
.t-diff{background:rgba(0,255,135,.15);color:var(--green)}
.t-trap{background:rgba(255,77,141,.15);color:var(--pink)}
.t-tmpl{background:rgba(40,232,255,.15);color:var(--cyan)}
.t-flag{background:rgba(255,201,77,.15);color:var(--gold)}
.t-manual{background:rgba(255,201,77,.15);color:var(--gold)}
.t-api{background:rgba(0,255,135,.15);color:var(--green)}

/* squad pitch */
.pitch{background:linear-gradient(180deg,var(--turf1),var(--turf2));border-radius:14px;padding:26px 16px 20px;position:relative;overflow:hidden}
.pitch::before{content:"";position:absolute;inset:12px;border:1.5px solid var(--turf-line);border-radius:6px;pointer-events:none}
.pitch::after{content:"";position:absolute;left:50%;top:12px;bottom:12px;width:1.5px;background:var(--turf-line);pointer-events:none}
.prow{display:flex;justify-content:center;gap:14px;margin-bottom:22px;flex-wrap:wrap;position:relative}
.pcard{
  background:#FFFFFF;color:#1B0522;border-radius:14px;padding:14px 12px 10px;min-width:106px;text-align:center;
  box-shadow:0 8px 18px rgba(0,0,0,.32);position:relative;overflow:hidden;
}
.pcard::before{content:"";position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,.55),rgba(255,255,255,0) 42%);pointer-events:none}
.pcard::after{content:"";position:absolute;top:0;left:0;right:0;height:4px;background:var(--stripe,var(--muted-dim))}
.pcard.pos-GKP{--stripe:var(--gold)} .pcard.pos-DEF{--stripe:var(--cyan)} .pcard.pos-MID{--stripe:var(--green)} .pcard.pos-FWD{--stripe:var(--pink)}
.pcard .band{position:absolute;top:8px;right:8px;width:20px;height:20px;border-radius:50%;font-family:"IBM Plex Mono",monospace;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.35);z-index:1}
.band-c{background:var(--gold);color:#2C0836} .band-vc{background:var(--cyan);color:#0B0517}
.pcard .nm{font-weight:700;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;position:relative}
.pcard .tm{font-size:10px;color:#6B5470;margin-top:1px;position:relative}
.pcard .pt{font-family:"IBM Plex Mono",monospace;font-size:15px;font-weight:600;margin-top:6px;color:var(--green-deep);position:relative}
.pcard.risk .pt{color:#C22E63}
.pcard .pt .lbl{font-size:8px;color:#9578A0;font-weight:500;text-transform:uppercase;display:block}
.bench-row{display:flex;gap:12px;flex-wrap:wrap;margin-top:18px}
.bcard{background:rgba(255,255,255,.06);border:1px solid var(--line);border-radius:10px;padding:10px 14px;flex:1;min-width:150px;display:flex;justify-content:space-between;align-items:center;gap:8px}
.bcard .nm{font-weight:600;font-size:13px}
.bcard .tm{font-size:10.5px;color:var(--muted-dim)}
.bcard .pt{font-family:"IBM Plex Mono",monospace;font-size:13px;color:var(--muted)}
.squad-empty{color:var(--muted);font-size:13px;padding:22px;text-align:center;border:1px dashed var(--line);border-radius:12px}
.squad-total{display:flex;gap:26px;margin-top:18px;padding-top:16px;border-top:1px solid var(--line)}
.squad-total .stat .v{font-family:"IBM Plex Mono",monospace;font-size:21px;font-weight:600;color:var(--green)}
.squad-total .stat .l{font-size:10px;color:var(--muted-dim);text-transform:uppercase;letter-spacing:.08em}

/* chip windows */
.chip-row{display:flex;gap:14px;align-items:center;padding:11px 0;border-bottom:1px solid var(--line)}
.chip-row:last-child{border-bottom:0}
.chip-badge{font-family:"IBM Plex Mono",monospace;font-size:12px;font-weight:600;background:rgba(255,255,255,.06);border:1px solid var(--line);padding:4px 10px;border-radius:99px;flex:0 0 auto}
.chip-detail{flex:1;font-size:13px}
.chip-lbl{font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-right:6px}
.lbl-double{color:var(--green)} .lbl-blank{color:var(--pink)}

#scatter{width:100%;height:auto;display:block}
.axis-note{font-size:12px;color:var(--muted-dim);margin:12px 0 0}
.legend{display:flex;flex-wrap:wrap;gap:16px;margin-top:14px;font-size:12px;color:var(--muted)}
.legend span{display:flex;align-items:center;gap:6px}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block}

.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:22px}
ul.cards{list-style:none;margin:0;padding:0}
ul.cards li{padding:12px 0;border-bottom:1px solid var(--line);display:flex;gap:12px;align-items:flex-start}
ul.cards li:last-child{border-bottom:0}
.who{flex:1;min-width:0}
.nm{font-weight:600}
.sub{font-size:12px;color:var(--muted-dim);margin-top:3px}
.reason{font-size:12px;color:var(--muted);margin-top:5px;font-style:italic}
.stat{font-family:"IBM Plex Mono",monospace;font-size:13px;text-align:right;white-space:nowrap;color:var(--muted)}
.stat b{display:block;font-weight:600;font-size:15px;color:var(--ink)}
.src{font-size:8px;color:var(--muted-dim);text-transform:uppercase;letter-spacing:.04em}

.tick{display:inline-flex;gap:2px;margin-top:6px}
.tick i{width:16px;height:16px;font-style:normal;font-family:"IBM Plex Mono",monospace;font-size:8px;line-height:16px;text-align:center;color:#1B0522;border-radius:4px;font-weight:600}
.d1{background:var(--fd1)}.d2{background:var(--fd2)}.d3{background:var(--fd3)}.d4{background:var(--fd4)}.d5{background:var(--fd5)}

table{width:100%;border-collapse:collapse;font-size:14px}
th{text-align:left;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted-dim);padding:0 10px 10px 0;border-bottom:1px solid var(--line);cursor:pointer;user-select:none}
th:hover{color:var(--green)}
td{padding:10px 10px 10px 0;border-bottom:1px solid var(--line)}
tbody tr.owned{background:rgba(0,255,135,.06)}
tbody tr:hover{background:rgba(255,255,255,.04)}
.controls{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}
input,select{font:400 13px "Plus Jakarta Sans",sans-serif;padding:8px 12px;border:1px solid var(--line);background:rgba(255,255,255,.05);color:var(--ink);border-radius:8px}
input::placeholder{color:var(--muted-dim)}
.empty{color:var(--muted-dim);font-size:13px;padding:14px 0}
.tablewrap{overflow-x:auto}
footer{margin-top:36px;padding-top:16px;border-top:1px solid var(--line);font-size:11px;color:var(--muted-dim);letter-spacing:.06em;text-transform:uppercase}
@media (max-width:640px){.gw{font-size:38px}.countdown{text-align:left}.pcard{min-width:90px}}
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
    <div class="val num" id="cd">--:--:--</div>
    <div class="lbl">to deadline</div>
  </div>
</header>

<section class="panel">
  <h2>My squad <span class="tag" id="squad-source-tag"></span></h2>
  <div id="squad-body"></div>
</section>

<section class="panel">
  <h2>Chip windows</h2>
  <div id="chip-body"></div>
</section>

<section class="panel">
  <h2>Ownership against underlying score</h2>
  <svg id="scatter" viewBox="0 0 900 440" role="img" aria-label="Scatter plot of player ownership against data score, split into four quadrants"></svg>
  <p class="axis-note">Bottom-right is where rank is won: strong numbers the crowd has not bought yet. Ringed markers are in your squad.</p>
  <div class="legend">
    <span><i class="dot" style="background:var(--green)"></i>Differential</span>
    <span><i class="dot" style="background:var(--cyan)"></i>Template</span>
    <span><i class="dot" style="background:var(--pink)"></i>Hype trap</span>
    <span><i class="dot" style="background:#6B5470"></i>Ignore</span>
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
  <div class="tablewrap">
  <table>
    <thead><tr>
      <th data-k="name">Player</th><th data-k="position">Pos</th><th data-k="price">£</th>
      <th data-k="ownership">Own %</th><th data-k="predictedPoints">xPts</th><th data-k="dataScore">Data</th>
      <th data-k="expertScore">Expert</th><th>Next ${board.players[0]?.fixtures.length ?? 5}</th>
    </tr></thead>
    <tbody id="rows"></tbody>
  </table>
  </div>
</section>

<footer>Built ${new Date(board.builtAt).toUTCString()} &middot; FPL API + ${board.videosProcessed} pundit videos &middot; predicted points: ${board.players.filter(p => p.pointsSource === 'model').length}/${board.players.length} from the fixture-adjusted model</footer>
</div>

<script id="board" type="application/json">${JSON.stringify(board).replace(/</g, '\\u003c')}</script>
<script>
const B = JSON.parse(document.getElementById('board').textContent);
const QC = { differential:'#00FF87', template:'#28E8FF', 'hype-trap':'#FF4D8D', ignore:'#6B5470' };
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

function squad(){
  const tagEl = document.getElementById('squad-source-tag');
  const body = document.getElementById('squad-body');
  if(!B.mySquad){
    tagEl.textContent = 'none';
    tagEl.className = 'tag t-flag';
    body.innerHTML = '<div class="squad-empty">No squad loaded — add config/my-squad.json (manually, before the deadline) or wait for entry picks to unlock after it passes.</div>';
    return;
  }
  tagEl.textContent = B.mySquad.source === 'api' ? 'from FPL picks' : 'manual — config/my-squad.json';
  tagEl.className = B.mySquad.source === 'api' ? 'tag t-api' : 'tag t-manual';

  const order = { GKP:0, DEF:1, MID:2, FWD:3 };
  const byPos = {};
  for(const p of B.mySquad.startingXI){ (byPos[p.position] ??= []).push(p); }
  const rowsHtml = Object.keys(byPos).sort((a,b)=>order[a]-order[b]).map(pos =>
    '<div class="prow">' + byPos[pos].map(p => pcard(p)).join('') + '</div>'
  ).join('');

  const benchHtml = B.mySquad.bench.map(p =>
    '<div class="bcard"><div><div class="nm">'+esc(p.name)+'</div><div class="tm">'+esc(p.team)+' '+p.position+'</div></div>'+
    '<div class="pt num">'+p.predictedPoints.toFixed(2)+'</div></div>'
  ).join('');

  body.innerHTML =
    '<div class="pitch">'+rowsHtml+'</div>'+
    '<div class="bench-row">'+benchHtml+'</div>'+
    '<div class="squad-total">'+
      '<div class="stat"><div class="v num">'+B.mySquad.totalPredictedPoints.toFixed(2)+'</div><div class="l">xPts (captain doubled)</div></div>'+
      (B.mySquad.captain ? '<div class="stat"><div class="v">'+esc(B.mySquad.captain.name)+'</div><div class="l">Captain</div></div>' : '')+
      (B.mySquad.viceCaptain ? '<div class="stat"><div class="v">'+esc(B.mySquad.viceCaptain.name)+'</div><div class="l">Vice</div></div>' : '')+
    '</div>';
}

function pcard(p){
  const risky = p.flagged || p.dataScore < 0;
  return '<div class="pcard pos-'+p.position+(risky?' risk':'')+'">'+
    (p.isCaptain ? '<span class="band band-c">C</span>' : p.isViceCaptain ? '<span class="band band-vc">VC</span>' : '')+
    '<div class="nm">'+esc(p.name)+'</div><div class="tm">'+esc(p.team)+'</div>'+
    '<div class="pt">'+p.predictedPoints.toFixed(2)+'<span class="lbl">xPts</span></div></div>';
}

function chipWindows(){
  const body = document.getElementById('chip-body');
  if(!B.chipWindows || !B.chipWindows.length){
    body.innerHTML = '<div class="squad-empty">No double or blank gameweeks scheduled yet — the fixture list only shows these once postponements reshuffle the calendar, usually from around GW25.</div>';
    return;
  }
  body.innerHTML = B.chipWindows.map(w =>
    '<div class="chip-row"><span class="chip-badge">GW'+w.gw+'</span><span class="chip-detail">'+
      (w.doubles.length ? '<span class="chip-lbl lbl-double">Double</span>'+w.doubles.map(esc).join(', ')+' ' : '')+
      (w.blanks.length ? '<span class="chip-lbl lbl-blank">Blank</span>'+w.blanks.map(esc).join(', ') : '')+
    '</span></div>'
  ).join('');
}

function card(p, statLabel, statVal){
  const reason = p.opinions?.[0]?.reason;
  return '<li><div class="who"><div class="nm">'+esc(p.name)+
    (p.flagged ? ' <span class="tag t-flag">flag</span>' : '')+
    (p.owned ? ' <span class="tag t-api">owned</span>' : '')+'</div>'+
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
fill('l-capt', B.lists.captaincy, 'xPts', p => p.predictedPoints.toFixed(2) + (p.captainCalls ? ' ('+p.captainCalls+' calls)' : ''));
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
  s+='<rect x="'+L+'" y="'+T+'" width="'+(W-L-R)+'" height="'+(H-T-Bm)+'" fill="rgba(255,255,255,.03)" stroke="rgba(255,255,255,.14)"/>';
  s+='<line x1="'+L+'" y1="'+midY+'" x2="'+(W-R)+'" y2="'+midY+'" stroke="rgba(255,255,255,.16)" stroke-dasharray="3 3"/>';
  s+='<line x1="'+midX+'" y1="'+T+'" x2="'+midX+'" y2="'+(H-Bm)+'" stroke="rgba(255,255,255,.16)" stroke-dasharray="3 3"/>';
  s+='<text x="'+(W-R-10)+'" y="'+(T+20)+'" text-anchor="end" font-size="11" font-family="IBM Plex Mono" fill="#00FF87">DIFFERENTIAL</text>';
  s+='<text x="'+(L+10)+'" y="'+(T+20)+'" font-size="11" font-family="IBM Plex Mono" fill="#28E8FF">TEMPLATE</text>';
  s+='<text x="'+(L+10)+'" y="'+(H-Bm-10)+'" font-size="11" font-family="IBM Plex Mono" fill="#FF4D8D">HYPE TRAP</text>';
  for(const p of B.players){
    if(p.dataScore < yMin + (yMax-yMin)*0.25 && p.ownership < 3) continue;
    const cx=x(p.ownership), cy=y(p.dataScore);
    const r=p.owned?6:4;
    s+='<circle cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" r="'+r+'" fill="'+QC[p.quadrant]+'" fill-opacity="'+(p.owned?1:0.7)+'"'+
       (p.owned?' stroke="#F6EEF7" stroke-width="2"':'')+'><title>'+esc(p.name)+' — '+p.ownership.toFixed(1)+'% owned, data '+p.dataScore.toFixed(2)+'</title></circle>';
  }
  const labelled=[...B.players].sort((a,b)=>b.dataScore-a.dataScore).slice(0,14);
  for(const p of labelled){
    s+='<text x="'+(x(p.ownership)+8).toFixed(1)+'" y="'+(y(p.dataScore)+4).toFixed(1)+'" font-size="11" font-family="Plus Jakarta Sans" fill="#F6EEF7">'+esc(p.name)+'</text>';
  }
  s+='<text x="'+(W/2)+'" y="'+(H-14)+'" text-anchor="middle" font-size="11" font-family="IBM Plex Mono" fill="#9578A0">← LESS OWNED &nbsp;&nbsp; OWNERSHIP &nbsp;&nbsp; MORE OWNED →</text>';
  s+='<text x="16" y="'+(H/2)+'" text-anchor="middle" font-size="11" font-family="IBM Plex Mono" fill="#9578A0" transform="rotate(-90,16,'+(H/2)+')">DATA SCORE →</text>';
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
    '<td class="num">'+p.ownership.toFixed(1)+'</td>'+
    '<td class="num">'+p.predictedPoints.toFixed(1)+'<div class="src">'+(p.pointsSource==='model'?'model':'ep_next')+'</div></td>'+
    '<td class="num">'+p.dataScore.toFixed(2)+'</td><td class="num">'+p.expertScore.toFixed(2)+'</td>'+
    '<td>'+ticker(p.fixtures)+'</td></tr>').join('');
}
document.querySelectorAll('th[data-k]').forEach(th=>th.onclick=()=>{
  const k=th.dataset.k; sortDir = sortKey===k ? -sortDir : -1; sortKey=k; rows();});
['q','pos','quad','own'].forEach(id=>document.getElementById(id).oninput=rows);

deadline(); squad(); chipWindows(); scatter(); rows();
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
