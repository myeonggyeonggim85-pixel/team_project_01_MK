// 요청 본문 읽기와 JSON 응답 — Vercel 함수와 로컬 server.js 에서 똑같이 동작한다
export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 20000) break; // 너무 긴 입력은 자른다
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

export function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

// 시간 제한이 있는 fetch. 실패 이유를 「시간 초과」로 구분하려고 name 을 남긴다
export async function fetchWithTimeout(url, options = {}, ms = 10000) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(ms) });
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      const err = new Error('시간 초과');
      err.reason = '시간 초과';
      throw err;
    }
    const err = new Error(`연결 오류: ${e?.message || e}`);
    err.reason = '오류';
    throw err;
  }
}

// AI 를 부르는 API 의 간단한 호출 제한 — 같은 IP 에서 10분에 30번까지.
// 서버 메모리에 두므로 Vercel 에서는 함수 인스턴스마다 따로 센다(완벽한 차단이 아니라 반복 호출 요금 폭주를 줄이는 정도)
const hits = new Map();
const WINDOW_MS = 10 * 60 * 1000;
export function rateLimited(req, max = 30) {
  const fwd = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = fwd || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear(); // 메모리가 계속 늘지 않게
  return list.length > max;
}

// .env 값 읽기. 쉼표로 여러 개 들어 있으면 첫 번째만 쓰고 표시해 둔다
export function readKey(name) {
  const raw = (process.env[name] || '').trim();
  if (!raw) return { value: '', multi: false };
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return { value: parts[0] || '', multi: parts.length > 1 };
}
