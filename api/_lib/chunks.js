// 근거 조각 검색 — docs/답변참고문서/청킹 만 읽는다(원본·청킹전·제외는 읽지 않는다)
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), 'docs', '답변참고문서', '청킹');
let cache = null;

function load() {
  if (cache) return cache;
  const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.md')) : [];
  cache = files.map((file) => {
    const raw = fs.readFileSync(path.join(DIR, file), 'utf8').replace(/^﻿/, '');
    const lines = raw.split(/\r?\n/);
    const src = (lines.find((l) => l.startsWith('출처:')) || '').replace(/^출처:\s*/, '');
    const keywords = (lines.find((l) => l.startsWith('키워드:')) || '').replace(/^키워드:\s*/, '');
    const title = (lines.find((l) => l.startsWith('## ')) || '').replace(/^##\s*/, '');
    const docName = src.split('|')[0].trim() || file.replace(/\.md$/, '');
    const url = (src.split('|')[1] || '').trim();
    const norm = (s) => s.replace(/\s+/g, '').toLowerCase();
    return { file, docName, url, title, keywords, text: raw, nKey: norm(keywords + title), nBody: norm(raw) };
  });
  return cache;
}

// 질문을 공백 없는 글자 두 개씩(바이그램)으로 나눠 맞는 조각을 찾는다 — 한국어 조사에 덜 흔들린다
const STOP = new Set(['어떻', '떻게', '하나', '해요', '예요', '에요', '뭐예', '인가', '나요', '까요', '할까', '하면', '되나', '있나', '은어', '는어']);
function bigrams(s) {
  const t = String(s).replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    if (!STOP.has(g)) out.add(g);
  }
  return out;
}

export function searchChunks(query, k = 4) {
  const qs = [...bigrams(query)];
  if (!qs.length) return [];
  const scored = load()
    .filter((c) => !c.file.startsWith('문의처_'))
    .map((c) => {
      let s = 0, hit = 0;
      for (const g of qs) {
        const inKey = c.nKey.includes(g), inBody = c.nBody.includes(g);
        if (inKey) s += 3;
        if (inBody) s += 1;
        if (inKey || inBody) hit++;
      }
      return { c, score: s, coverage: hit / qs.length };
    })
    .filter((x) => x.coverage >= 0.5)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((x) => x.c);
}

export function contactChunks() {
  return load().filter((c) => c.file.startsWith('문의처_'));
}

export function chunkCount() {
  return load().length;
}
