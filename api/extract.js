// 자유롭게 쓴 문장 → 사실 항목(기획서 〈표 5〉). 분류는 하지 않는다(규칙표는 화면 코드가 한다)
import { readJson, send, rateLimited } from './_lib/http.js';
import { askAI, parseJsonLoose } from './_lib/ai.js';
import { maskPersonal } from './_lib/mask.js';
import { FIELDS, sanitizeFacts, detectCrisis, guessFacts } from '../public/rules.js';

const SYSTEM = [
  '너는 중고거래 피해자가 쓴 문장에서 정해진 사실 항목의 값을 고르는 도구다.',
  '사기인지 분쟁인지 판단하거나 조언하지 않는다. 값을 고르는 일만 한다.',
  '각 항목은 아래 목록에 있는 값 중 하나만 쓴다. 문장에 분명히 없거나 확실하지 않으면 반드시 "모름"을 쓴다. 추측하지 않는다.',
  '"잘못 보냈다"처럼 착오송금인지 거래 문제인지 불분명하면 situation 은 "모름"으로 둔다.',
  'crisis 는 자해·자살을 암시하는 표현이 있으면 "있음", 없으면 "없음".',
  'lure 는 판매자가 보낸 결제 링크나 추가 요구가 문장에 분명히 있을 때만 고른다. 안전결제·결제 링크로 입금한 뒤 수수료·재입금 등을 요구받았으면 "가짜 안전결제 링크·추가 입금 요구", 링크로 앱을 설치했거나 인증번호·비밀번호를 알려 줬으면 "링크로 앱 설치·인증번호 제공". 언급이 없으면 "모름".',
  '',
  ...Object.entries(FIELDS).map(([k, d]) => `${k} (${d.label}): ${d.values.map((v) => `"${v}"`).join(' | ')}`),
  '',
  '출력 형식: {"crisis":"...","situation":"...","product":"...","payment":"...","lure":"...","receipt":"...","contact":"...","fakePost":"..."}',
].join('\n');

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST 만 받습니다' });
  const body = await readJson(req);
  const text = String(body.text || '').slice(0, 1000).trim();
  if (!text) return send(res, 400, { error: '문장이 비어 있습니다' });

  const masked = maskPersonal(text);
  const wordCrisis = detectCrisis(text);
  // 호출이 너무 많으면 AI 대신 낱말 기반 정리(시연 값)로 답한다 — 흐름은 끊기지 않는다
  if (rateLimited(req)) {
    return send(res, 200, { live: false, provider: null, tried: [{ provider: 'AI', reason: '요청이 많아 잠시 쉼' }], facts: guessFacts(text), masked: masked !== text });
  }
  const ai = await askAI({ system: SYSTEM, user: masked, json: true });

  if (ai.ok) {
    const parsed = parseJsonLoose(ai.text);
    if (parsed) {
      const facts = sanitizeFacts(parsed);
      // 위기 단어 목록과 AI 판단 중 하나라도 걸리면 '있음'
      if (wordCrisis) facts.crisis = '있음';
      return send(res, 200, { live: true, provider: ai.provider, model: ai.model, tried: ai.tried, facts, masked: masked !== text });
    }
    ai.tried.push({ provider: ai.provider, reason: '오류', detail: '정해진 형식(JSON)이 아님' });
  }

  // AI 를 모두 못 썼을 때: 낱말 기반 정리(시연 값)
  const facts = guessFacts(text);
  return send(res, 200, { live: false, provider: null, tried: ai.tried, facts, masked: masked !== text });
}
