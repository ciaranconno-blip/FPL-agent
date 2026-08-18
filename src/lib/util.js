import fs from 'node:fs/promises';
import path from 'node:path';

export const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
export const DATA = path.join(ROOT, 'data');
const BASE = 'https://fantasy.premierleague.com/api';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
  'Accept': 'application/json'
};

export async function fplGet(endpoint, { retries = 3 } = {}) {
  const url = `${BASE}/${endpoint}`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw new Error(`FPL ${endpoint} failed: ${err.message}`);
      await sleep(500 * attempt);
    }
  }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function pool(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    out.push(...await Promise.all(batch.map(fn)));
    if (i + size < items.length) await sleep(250);
  }
  return out;
}

export async function save(relPath, obj) {
  const full = path.join(DATA, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, JSON.stringify(obj, null, 2));
  return full;
}

export async function load(relPath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA, relPath), 'utf8'));
  } catch {
    return fallback;
  }
}

// Strips accents and punctuation so "Gabriel Fernando de Jesus" and "Jesus" can meet.
export function normalise(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Builds every reasonable alias for each player, pointing back to the FPL element id.
export function buildNameIndex(elements, teams) {
  const teamById = Object.fromEntries(teams.map(t => [t.id, t]));
  const index = new Map();
  const add = (key, id) => {
    if (!key) return;
    const k = normalise(key);
    if (!k || k.length < 3) return;
    if (!index.has(k)) index.set(k, new Set());
    index.get(k).add(id);
  };
  for (const el of elements) {
    add(el.web_name, el.id);
    add(`${el.first_name} ${el.second_name}`, el.id);
    add(el.second_name, el.id);
    const surname = String(el.second_name).split(' ').pop();
    add(surname, el.id);
    const team = teamById[el.team];
    if (team) add(`${el.web_name} ${team.short_name}`, el.id);
  }
  return index;
}

// Resolves a spoken name to one element id. Ambiguous surnames need a team hint.
export function resolvePlayer(nameIndex, elements, spokenName, teamHint) {
  const key = normalise(spokenName);
  const direct = nameIndex.get(key);
  if (direct && direct.size === 1) return [...direct][0];
  if (direct && direct.size > 1 && teamHint) {
    const hint = normalise(teamHint);
    for (const id of direct) {
      const el = elements.find(e => e.id === id);
      if (el && normalise(el.team_name || '').includes(hint)) return id;
    }
  }
  if (direct) return [...direct][0];
  const partial = [...nameIndex.keys()].filter(k => k.includes(key) || key.includes(k));
  if (partial.length === 1) return [...nameIndex.get(partial[0])][0];
  return null;
}

export function zScores(values) {
  const clean = values.filter(v => Number.isFinite(v));
  if (!clean.length) return values.map(() => 0);
  const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
  const sd = Math.sqrt(clean.reduce((a, b) => a + (b - mean) ** 2, 0) / clean.length) || 1;
  return values.map(v => (Number.isFinite(v) ? (v - mean) / sd : 0));
}

export function log(...args) {
  console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);
}
