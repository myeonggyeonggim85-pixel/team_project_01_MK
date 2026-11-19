// AI 호출 — CLAUDE_API_KEY → GROQ_API_KEY → GEMINI_API_KEY 순서.
// 앞이 실패하면(키 비어 있음 · 오류 · 시간 초과) 다음으로 넘어가고, 어느 AI 가 답했는지 돌려준다.
// 모델 이름은 각 키로 모델 목록을 조회해서 정한다. 404 가 나면 모델 이름부터 의심해 목록을 다시 조회한다.
import Anthropic from '@anthropic-ai/sdk';
import { fetchWithTimeout, readKey } from './http.js';

const TIMEOUT_MS = 15000;
const modelCache = {}; // provider → 모델 이름 (서버가 켜져 있는 동안만)

function fail(reason, detail) {
  const e = new Error(detail || reason);
  e.reason = reason;
  return e;
}

// ---------- Claude ----------
async function claudeModel(client, refresh) {
  if (modelCache.claude && !refresh) return modelCache.claude;
  const ids = [];
  for await (const m of client.models.list({ limit: 100 }, { timeout: TIMEOUT_MS })) ids.push(m.id);
  if (!ids.length) throw fail('오류', '모델 목록이 비어 있음');
  const pick = ids.find((id) => id === 'claude-opus-5-5') || ids.find((id) => id.startsWith('claude-opus')) || ids[0];
  modelCache.claude = pick;
  return pick;
}

async function callClaude(key, { system, user, json }, refresh = false) {
  const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: TIMEOUT_MS });
  const model = await claudeModel(client, refresh);
  const params = {
    model,
    max_tokens: 4000,
    system: json ? `${system}\n\nJSON 객체 하나만 출력한다. 설명 문장이나 코드 블록 표시를 붙이지 않는다.` : system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort: 'low' },
  };
  // 거절(refusal) 시 서버 쪽 대체 모델 — Claude Opus 5.5 에서만 켠다
  const useFallback = model === 'claude-opus-5-5';
  let res;
  try {
    res = useFallback
      ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await client.messages.create(params);
  } catch (e) {
    if (e instanceof Anthropic.NotFoundError && !refresh) return callClaude(key, { system, user, json }, true);
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw fail('시간 초과');
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw fail('승인 안 됨', e.message);
    if (e instanceof Anthropic.NotFoundError) throw fail('오류', `404 — 모델 이름(${model}) 확인 필요`);
    throw fail('오류', e.message);
  }
  if (res.stop_reason === 'refusal') throw fail('오류', '답변 거절(refusal)');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { text, model: res.model || model };
}

// ---------- Groq ----------
async function groqModel(key, refresh) {
  if (modelCache.groq && !refresh) return modelCache.groq;
  const r = await fetchWithTimeout('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` } }, TIMEOUT_MS);
  if (r.status === 401 || r.status === 403) throw fail('승인 안 됨', `모델 목록 ${r.status}`);
  if (!r.ok) throw fail('오류', `모델 목록 ${r.status}`);
  const ids = ((await r.json()).data || []).map((m) => m.id);
  const usable = ids.filter((id) => !/whisper|tts|guard|safeguard|distil|playai|orpheus|allam/i.test(id));
  // 큰 범용 모델 먼저: gpt-oss-120b → qwen → llama → 그 밖
  const pick = usable.find((id) => /gpt-oss-120b/.test(id)) || usable.find((id) => /qwen/.test(id))
    || usable.find((id) => /llama/.test(id)) || usable[0];
  if (!pick) throw fail('오류', '쓸 수 있는 모델 없음');
  modelCache.groq = pick;
  return pick;
}

async function callGroq(key, { system, user, json }, refresh = false) {
  const model = await groqModel(key, refresh);
  const r = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  }, TIMEOUT_MS);
  if (r.status === 404 && !refresh) return callGroq(key, { system, user, json }, true);
  if (r.status === 401 || r.status === 403) throw fail('승인 안 됨', `${r.status}`);
  if (r.status === 404) throw fail('오류', `404 — 모델 이름(${model}) 확인 필요`);
  if (!r.ok) throw fail('오류', `${r.status} ${(await r.text()).slice(0, 120)}`);
  const data = await r.json();
  return { text: data.choices?.[0]?.message?.content || '', model };
}

// ---------- Gemini ----------
async function geminiModel(key, refresh) {
  if (modelCache.gemini && !refresh) return modelCache.gemini;
  const r = await fetchWithTimeout('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } }, TIMEOUT_MS);
  if (r.status === 400 || r.status === 401 || r.status === 403) throw fail('승인 안 됨', `모델 목록 ${r.status}`);
  if (!r.ok) throw fail('오류', `모델 목록 ${r.status}`);
  const models = ((await r.json()).models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    // 일반 글 생성용 flash 만: gemini-flash-latest, gemini-3.8-flash 처럼 이름이 단순한 것
    .filter((n) => /^gemini-(\d+(\.\d+)?-)?flash(-latest)?$/.test(n));
  // 최신 별칭 먼저, 그다음 버전 숫자가 큰 것
  models.sort((a, b) => (/latest/.test(b) - /latest/.test(a)) || b.localeCompare(a, 'en', { numeric: true }));
  const list = models;
  if (!list.length) throw fail('오류', '쓸 수 있는 모델 없음');
  modelCache.gemini = list;
  return list;
}

// 한도 초과(429)·과부하(503)면 목록의 다음 모델로 한 번 더 시도한다
async function callGemini(key, { system, user, json }, refresh = false) {
  const list = await geminiModel(key, refresh);
  let last;
  for (const model of list.slice(0, 3)) {
    const r = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0, ...(json ? { responseMimeType: 'application/json' } : {}) },
      }),
    }, TIMEOUT_MS);
    if (r.status === 404 && !refresh) return callGemini(key, { system, user, json }, true);
    if (r.status === 401 || r.status === 403) throw fail('승인 안 됨', `${r.status}`);
    if (r.status === 404) throw fail('오류', `404 — 모델 이름(${model}) 확인 필요`);
    if (r.status === 429 || r.status === 503) { last = fail('오류', `${r.status} ${model} 한도 초과·과부하`); continue; }
    if (!r.ok) throw fail('오류', `${r.status} ${(await r.text()).slice(0, 120)}`);
    const data = await r.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    return { text, model };
  }
  throw last;
}

const PROVIDERS = [
  { id: 'claude', name: 'Claude', env: 'CLAUDE_API_KEY', call: callClaude },
  { id: 'groq', name: 'Groq', env: 'GROQ_API_KEY', call: callGroq },
  { id: 'gemini', name: 'Gemini', env: 'GEMINI_API_KEY', call: callGemini },
];

// 성공하면 { ok:true, text, provider, model, tried }, 모두 실패하면 { ok:false, tried }
export async function askAI(req) {
  const tried = [];
  for (const p of PROVIDERS) {
    const { value } = readKey(p.env);
    if (!value) { tried.push({ provider: p.name, reason: '키 비어 있음' }); continue; }
    try {
      const out = await p.call(value, req);
      if (!out.text.trim()) throw fail('오류', '빈 답변');
      console.log(`[AI] ${p.name} (${out.model}) 응답`);
      return { ok: true, text: out.text, provider: p.name, model: out.model, tried };
    } catch (e) {
      const reason = e.reason || '오류';
      console.warn(`[AI] ${p.name} 실패: ${reason} ${e.message && e.message !== reason ? `— ${e.message}` : ''}`);
      tried.push({ provider: p.name, reason, detail: e.message !== reason ? String(e.message).slice(0, 160) : undefined });
    }
  }
  return { ok: false, tried };
}

// AI 답에서 JSON 객체만 꺼낸다
export function parseJsonLoose(text) {
  try { return JSON.parse(text); } catch { /* 아래에서 다시 */ }
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export function keyStatus() {
  return PROVIDERS.map((p) => {
    const k = readKey(p.env);
    return { name: p.env, filled: !!k.value, multi: k.multi };
  });
}
