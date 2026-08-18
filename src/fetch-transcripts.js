import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA, save, log, sleep } from './lib/util.js';

const run = promisify(execFile);
const config = JSON.parse(await fs.readFile(new URL('../config/sources.json', import.meta.url), 'utf8'));
const { videosPerChannel, maxAgeDays } = config.transcripts;

const tmp = path.join(DATA, 'tmp-subs');
await fs.mkdir(tmp, { recursive: true });

try {
  await run('yt-dlp', ['--version']);
} catch {
  console.error('yt-dlp not found. Install it: brew install yt-dlp   (or: pipx install yt-dlp)');
  process.exit(1);
}

const cutoff = new Date(Date.now() - maxAgeDays * 864e5);
const transcripts = [];

for (const channel of config.channels) {
  log(`Listing ${channel.handle}`);
  let entries = [];
  try {
    const { stdout } = await run('yt-dlp', [
      `${channel.url}/videos`,
      '--flat-playlist',
      '--playlist-end', String(videosPerChannel),
      '--dump-json',
      '--no-warnings'
    ], { maxBuffer: 64 * 1024 * 1024 });
    entries = stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
  } catch (err) {
    log(`  Could not list ${channel.handle}: ${err.message.split('\n')[0]}`);
    continue;
  }

  for (const entry of entries) {
    const id = entry.id;
    const uploaded = entry.timestamp ? new Date(entry.timestamp * 1000) : null;
    if (uploaded && uploaded < cutoff) continue;

    const stem = path.join(tmp, id);
    try {
      await run('yt-dlp', [
        `https://www.youtube.com/watch?v=${id}`,
        '--skip-download',
        '--write-auto-subs', '--write-subs',
        '--sub-lang', 'en.*',
        '--sub-format', 'vtt',
        '--convert-subs', 'vtt',
        '-o', `${stem}.%(ext)s`,
        '--no-warnings'
      ], { maxBuffer: 64 * 1024 * 1024 });
    } catch (err) {
      log(`  No subtitles for ${id}`);
      continue;
    }

    const files = (await fs.readdir(tmp)).filter(f => f.startsWith(id) && f.endsWith('.vtt'));
    if (!files.length) continue;

    const raw = await fs.readFile(path.join(tmp, files[0]), 'utf8');
    const text = vttToText(raw);
    if (text.length < 400) continue;

    transcripts.push({
      videoId: id,
      channel: channel.handle,
      channelWeight: channel.weight,
      title: entry.title ?? '',
      uploadedAt: uploaded?.toISOString() ?? null,
      url: `https://www.youtube.com/watch?v=${id}`,
      text
    });
    log(`  ${channel.handle}: ${(entry.title ?? id).slice(0, 60)} (${text.length} chars)`);
    await sleep(400);
  }
}

await save('raw/transcripts.json', { fetchedAt: new Date().toISOString(), transcripts });
await fs.rm(tmp, { recursive: true, force: true });
log(`Captured ${transcripts.length} transcripts`);

await writeNotebookFiles(transcripts);

// One markdown file per channel, not per video. NotebookLM caps sources (50 on free tier),
// and 11 files means its citations read "FPLFocal" rather than an opaque video id.
async function writeNotebookFiles(list) {
  const dir = path.join(DATA, 'notebooklm');
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  if (!list.length) { log('No transcripts to export.'); return; }

  const stamp = new Date().toISOString().slice(0, 10);
  const byChannel = new Map();
  for (const t of list) {
    if (!byChannel.has(t.channel)) byChannel.set(t.channel, []);
    byChannel.get(t.channel).push(t);
  }

  const written = [];
  for (const [channel, vids] of byChannel) {
    const body = [
      `# ${channel}`,
      '',
      `Source: FPL YouTube channel. ${vids.length} video${vids.length > 1 ? 's' : ''} transcribed ${stamp}.`,
      '',
      ...vids.flatMap(v => [
        `## ${v.title || v.videoId}`,
        '',
        `Channel: ${channel}`,
        `Published: ${v.uploadedAt ? v.uploadedAt.slice(0, 10) : 'unknown'}`,
        `Link: ${v.url}`,
        '',
        ...paragraphs(v.text),
        ''
      ])
    ].join('\n');
    const file = `${stamp}_${channel}.md`;
    await fs.writeFile(path.join(dir, file), body);
    written.push({ file, channel, videos: vids.length, words: body.split(/\s+/).length });
  }

  // A single combined file, for when you'd rather add one source than eleven.
  const combined = [
    `# FPL pundit transcripts — week of ${stamp}`,
    '',
    `${list.length} videos across ${byChannel.size} channels.`,
    '',
    '## Contents',
    '',
    ...list.map(v => `- ${v.channel}: ${v.title || v.videoId}`),
    '',
    '---',
    ''
  ].join('\n') + (await Promise.all([...byChannel.keys()].map(async c =>
    fs.readFile(path.join(dir, `${stamp}_${c}.md`), 'utf8')))).join('\n\n---\n\n');
  await fs.writeFile(path.join(dir, `${stamp}_ALL-CHANNELS.md`), combined);

  log(`NotebookLM export → data/notebooklm/`);
  for (const w of written) log(`  ${w.file} — ${w.videos} video(s), ~${w.words} words`);
  log(`  ${stamp}_ALL-CHANNELS.md — everything in one file`);
}

// Auto-captions arrive as one unpunctuated run. Break into readable blocks so
// NotebookLM chunks it sensibly instead of treating the lot as one passage.
function paragraphs(text, wordsPerBlock = 90) {
  const words = text.split(' ');
  const out = [];
  for (let i = 0; i < words.length; i += wordsPerBlock) {
    out.push(words.slice(i, i + wordsPerBlock).join(' '), '');
  }
  return out;
}

// WebVTT is timestamped and heavily duplicated by the rolling-caption effect.
// Strip cues, tags, and consecutive repeats to get clean prose.
function vttToText(vtt) {
  const lines = vtt.split('\n');
  const out = [];
  for (let line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith('WEBVTT') || line.startsWith('Kind:') || line.startsWith('Language:')) continue;
    if (line.includes('-->')) continue;
    if (/^\d+$/.test(line.trim())) continue;
    line = line.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    if (!line) continue;
    if (out.length && out[out.length - 1] === line) continue;
    out.push(line);
  }
  const joined = out.join(' ').replace(/\s+/g, ' ');
  const words = joined.split(' ');
  const deduped = words.filter((w, i) => !(i > 2 && w === words[i - 1] && w === words[i - 2]));
  return deduped.join(' ');
}
