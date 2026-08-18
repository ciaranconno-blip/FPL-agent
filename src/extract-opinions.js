import fs from 'node:fs/promises';
import { load, save, log, buildNameIndex, resolvePlayer, sleep } from './lib/util.js';

const config = JSON.parse(await fs.readFile(new URL('../config/sources.json', import.meta.url), 'utf8'));
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('Set ANTHROPIC_API_KEY before running this step.');
  process.exit(1);
}

const bootstrap = await load('raw/bootstrap.json');
const { transcripts } = await load('raw/transcripts.json', { transcripts: [] });
if (!bootstrap) { console.error('Run `npm run fpl` first.'); process.exit(1); }
if (!transcripts.length) { console.error('No transcripts. Run `npm run transcripts` first.'); process.exit(1); }

const teamNames = Object.fromEntries(bootstrap.teams.map(t => [t.id, t.name]));
const elements = bootstrap.elements.map(el => ({ ...el, team_name: teamNames[el.team] }));
const nameIndex = buildNameIndex(elements, bootstrap.teams);

const SYSTEM = `You extract Fantasy Premier League opinions from pundit video transcripts.

Return ONLY a JSON array. No preamble, no markdown fences, no commentary.

Each element:
{
  "player": "name exactly as spoken",
  "team": "club if mentioned, else null",
  "stance": "buy" | "hold" | "sell" | "avoid" | "watch",
  "captain": true if named as a captain or triple-captain option, else false,
  "confidence": 0.0-1.0 — how strongly the pundit commits. A throwaway mention is 0.2; "he is my captain, locked in" is 1.0,
  "reason": "one short clause in the pundit's own framing",
  "risk": "injury" | "rotation" | "price" | "fixtures" | "form" | null
}

Rules:
- One entry per player per distinct opinion. Do not repeat the same stance for the same player.
- Ignore players only named in passing match reports with no FPL view attached.
- If the pundit is arguing against a player, use "sell" if they own him, "avoid" if they do not.
- Do not invent players. Only extract names actually spoken.`;

async function callClaude(chunk, meta) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: config.claude.model,
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Channel: ${meta.channel}\nVideo: ${meta.title}\n\nTranscript:\n${chunk}`
      }]
    })
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const cleaned = text.replace(/^```(?:json)?/gm, '').replace(/```$/gm, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try { return JSON.parse(match[0]); } catch { return []; }
  }
}

const opinions = [];
const unmatched = new Map();

for (const t of transcripts) {
  const chunks = [];
  for (let i = 0; i < t.text.length; i += config.claude.maxCharsPerChunk) {
    chunks.push(t.text.slice(i, i + config.claude.maxCharsPerChunk));
  }
  log(`${t.channel}: ${t.title.slice(0, 50)} (${chunks.length} chunk${chunks.length > 1 ? 's' : ''})`);

  for (const chunk of chunks) {
    let extracted = [];
    try {
      extracted = await callClaude(chunk, t);
    } catch (err) {
      log(`  API error: ${err.message}`);
      await sleep(2000);
      continue;
    }
    for (const op of extracted) {
      const id = resolvePlayer(nameIndex, elements, op.player, op.team);
      if (!id) {
        unmatched.set(op.player, (unmatched.get(op.player) ?? 0) + 1);
        continue;
      }
      opinions.push({
        elementId: id,
        stance: op.stance,
        captain: Boolean(op.captain),
        confidence: Math.max(0, Math.min(1, Number(op.confidence) || 0.3)),
        reason: op.reason ?? '',
        risk: op.risk ?? null,
        channel: t.channel,
        channelWeight: t.channelWeight,
        videoTitle: t.title,
        url: t.url,
        uploadedAt: t.uploadedAt
      });
    }
    await sleep(600);
  }
}

await save('raw/opinions.json', {
  builtAt: new Date().toISOString(),
  videosProcessed: transcripts.length,
  opinions,
  unmatchedNames: Object.fromEntries([...unmatched].sort((a, b) => b[1] - a[1]).slice(0, 40))
});

log(`Extracted ${opinions.length} opinions across ${new Set(opinions.map(o => o.elementId)).size} players`);
if (unmatched.size) log(`${unmatched.size} names could not be matched — check unmatchedNames in opinions.json`);
