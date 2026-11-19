// 근거 법령 — 공공 API(국가법령정보 · 국민참여입법센터)는 이 파일에서만 부른다.
// LAW_OC: 현행 법령 조문 · 시행일 · 변경이력 / LAWMAKING_OC: 진행 중인 입법예고
// 실패하면 이유(키 비어 있음 · 승인 안 됨 · 시간 초과 · 오류)와 시연 값을 함께 돌려준다.
import { send, fetchWithTimeout, readKey } from './_lib/http.js';
import { DEMO_LAWS, BILL_NOTE } from './_lib/fallback.js';

const TIMEOUT = 8000;
const SETS = {
  fraud: [
    { name: '형법', jo: 347 },
    { name: '전기통신금융사기 피해 방지 및 피해자산 환급에 관한 특별법', jo: 2, ho: 2 },
  ],
  dispute: [{ name: '민법', jo: 390 }],
};

const cache = new Map(); // 같은 법령을 반복 조회하지 않도록 1시간 보관
const HOUR = 3600 * 1000;

function fail(reason, detail) {
  const e = new Error(detail || reason);
  e.reason = reason;
  return e;
}

const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const fmtDate = (d) => (/^\d{8}$/.test(String(d)) ? `${String(d).slice(0, 4)}-${String(d).slice(4, 6)}-${String(d).slice(6)}` : String(d || ''));

async function getJson(url) {
  const r = await fetchWithTimeout(url, {}, TIMEOUT);
  const text = await r.text();
  if (r.status === 401 || r.status === 403) throw fail('승인 안 됨', `HTTP ${r.status}`);
  if (!r.ok) throw fail('오류', `HTTP ${r.status}`);
  // 국가법령정보는 승인 전·IP/도메인 미등록이면 200 으로 안내 문구를 돌려준다
  const denied = /검증|등록|미신청|인증|권한/;
  const brief = () => text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 120);
  let data;
  try { data = JSON.parse(text); } catch {
    throw fail(denied.test(text) ? '승인 안 됨' : '오류', denied.test(text) ? brief() : '응답이 JSON 이 아님');
  }
  if (data && (data.result || data.msg) && denied.test(`${data.result || ''}${data.msg || ''}`)) throw fail('승인 안 됨', brief());
  return data;
}

function joCode(jo) {
  return `${String(jo).padStart(4, '0')}00`; // 제347조 → 034700
}

function flattenArticle(unit, ho) {
  const lines = [];
  // 조문내용 첫머리의 "제347조(사기)" 는 제목으로 따로 보여 주므로 뺀다
  const head = String(unit['조문내용'] || '').replace(/^제\d+조(의\d+)?(\([^)]*\))?\s*/, '').trim();
  if (!ho && head) lines.push(head);
  for (const hang of arr(unit['항'])) {
    if (!ho && hang['항내용']) lines.push(String(hang['항내용']).trim());
    for (const h of arr(hang['호'])) {
      const hText = String(h['호내용'] || '').trim();
      if (ho && !hText.startsWith(`${ho}.`)) continue;
      lines.push(hText);
      for (const m of arr(h['목'])) lines.push(`  ${String(m['목내용'] || '').trim()}`);
    }
  }
  return lines.join('\n').trim();
}

async function fetchLaw(oc, { name, jo, ho }) {
  // 1) 현행 법령 찾기
  const search = await getJson(`https://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(oc)}&target=law&type=JSON&display=20&query=${encodeURIComponent(name)}`);
  const item = arr(search?.LawSearch?.law).find((l) => l['법령명한글'] === name);
  if (!item) throw fail('오류', '현행 법령을 찾지 못함');
  const mst = item['법령일련번호'];

  // 2) 조문 본문
  const body = await getJson(`https://www.law.go.kr/DRF/lawService.do?OC=${encodeURIComponent(oc)}&target=law&type=JSON&MST=${mst}&JO=${joCode(jo)}`);
  const units = arr(body?.['법령']?.['조문']?.['조문단위']);
  const unit = units.find((u) => String(u['조문번호']) === String(jo) && u['조문여부'] !== '전문') || units[0];
  if (!unit) throw fail('오류', '조문을 찾지 못함');
  const title = unit['조문제목'] ? `제${jo}조(${unit['조문제목']})` : `제${jo}조`;
  const text = flattenArticle(unit, ho);
  const info = body?.['법령']?.['기본정보'] || {};

  // 3) 변경이력 — 시행일 기준 연혁 목록(최근 5건)
  let history = [];
  try {
    const hist = await getJson(`https://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(oc)}&target=eflaw&type=JSON&display=100&nw=1,2,3&query=${encodeURIComponent(name)}`);
    history = arr(hist?.LawSearch?.law)
      .filter((l) => l['법령명한글'] === name)
      .map((l) => ({ effective: fmtDate(l['시행일자']), promulgated: fmtDate(l['공포일자']), kind: `${l['제개정구분명'] || ''} ${l['공포번호'] ? `제${l['공포번호']}호` : ''}`.trim(), status: l['현행연혁코드'] || '' }))
      .sort((a, b) => b.effective.localeCompare(a.effective))
      .slice(0, 5);
  } catch { /* 변경이력만 실패하면 본문은 그대로 보여 준다 */ }

  return {
    name,
    article: ho ? `${title} 제${ho}호` : title,
    text,
    effective: `${fmtDate(info['시행일자'] || item['시행일자'])} 시행${info['공포번호'] || item['공포번호'] ? ` (공포번호 제${info['공포번호'] || item['공포번호']}호)` : ''}`,
    history,
    link: `https://www.law.go.kr/법령/${name.replace(/\s+/g, '')}`,
  };
}

async function lawEntry(oc, def) {
  const demo = { name: def.name, ...DEMO_LAWS[def.name], link: `https://www.law.go.kr/법령/${def.name.replace(/\s+/g, '')}` };
  if (!oc) return { live: false, reason: '키 비어 있음', ...demo };
  const key = `${def.name}|${def.jo}|${def.ho || ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < HOUR) return hit.data;
  try {
    const data = { live: true, ...(await fetchLaw(oc, def)) };
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    console.warn(`[법령] ${def.name} 실패: ${e.reason || '오류'} ${e.message}`);
    return { live: false, reason: e.reason || '오류', detail: e.message, ...demo };
  }
}

// 진행 중인 입법예고 — 국민참여입법센터. 응답 형식을 확정하지 못해 XML/JSON 둘 다 느슨하게 읽는다
async function lawmaking(oc) {
  const keyword = '전기통신금융사기';
  if (!oc) return { live: false, reason: '키 비어 있음', items: [], keyword };
  try {
    const r = await fetchWithTimeout(`https://www.lawmaking.go.kr/rest/ogLmPp.xml?OC=${encodeURIComponent(oc)}&lsNm=${encodeURIComponent(keyword)}`, {}, TIMEOUT);
    const text = await r.text();
    if (r.status === 401 || r.status === 403) throw fail('승인 안 됨', `HTTP ${r.status}`);
    if (!r.ok) throw fail('오류', `HTTP ${r.status}`);
    if (/인증|등록되지|권한|invalid/i.test(text) && !/<lsNm>/i.test(text)) throw fail('승인 안 됨', text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 120));
    const blocks = text.match(/<(item|ogLmPp|row)>[\s\S]*?<\/\1>/gi) || [];
    const tag = (b, ...names) => {
      for (const n of names) {
        const m = b.match(new RegExp(`<${n}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${n}>`, 'i'));
        if (m) return m[1].trim();
      }
      return '';
    };
    const items = blocks
      .map((b) => ({ title: tag(b, 'lsNm', 'title', '법령명'), org: tag(b, 'asndOfiNm', 'cptOfiOrgNm', '소관부처'), start: tag(b, 'stYdFmt', 'pntcStDt', 'stYd'), end: tag(b, 'edYdFmt', 'pntcEdDt', 'edYd'), link: tag(b, 'lnkUrl', 'link') }))
      .filter((it) => it.title.replace(/\s+/g, '').includes(keyword));
    return { live: true, items, keyword };
  } catch (e) {
    console.warn(`[입법예고] 실패: ${e.reason || '오류'} ${e.message}`);
    return { live: false, reason: e.reason || '오류', detail: e.message, items: [], keyword };
  }
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const result = url.searchParams.get('result');
  const defs = SETS[result];
  if (!defs) return send(res, 400, { error: 'result 는 fraud 또는 dispute' });
  const lawOc = readKey('LAW_OC').value;
  const laws = await Promise.all(defs.map((d) => lawEntry(lawOc, d)));
  const notice = result === 'fraud' ? await lawmaking(readKey('LAWMAKING_OC').value) : null;
  send(res, 200, { laws, notice, billNote: result === 'fraud' ? BILL_NOTE : null });
}
