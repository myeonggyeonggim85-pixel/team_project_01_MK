// 결과 화면의 추가 질문 → 근거 조각 검색 + AI 답. 분류·판정에는 쓰지 않는다(기획서 Ⅳ-1)
import { readJson, send, rateLimited } from './_lib/http.js';
import { askAI } from './_lib/ai.js';
import { maskPersonal } from './_lib/mask.js';
import { searchChunks, contactChunks } from './_lib/chunks.js';

// docs/안내규칙메모.md 의 규칙을 옮겨 쓴 지시문
const RULES = `너는 「중고거래 피해 대응 길잡이」의 추가 질문 답변 도우미다.
- 아래 [근거 문서]에 있는 내용으로만 답한다. 문서에 없는 내용은 "제공된 안내 문서에 없는 내용이에요"라고 말하고 [문의처]를 안내한다.
- 사기 여부, 자격, 처분, 돌려받을 금액을 단정하지 않는다. 안내만 한다.
- 문의처는 [문의처]의 값만 쓴다. 보건복지부 사무실 번호(044)는 안내하지 않는다.
- 지급정지: 중고거래·쇼핑몰처럼 물건이나 서비스를 주겠다고 속인 사기(B유형)는 「전기통신금융사기 피해 방지 및 피해자산 환급에 관한 특별법」상 지급정지 의무 대상이 아니다(제2조제2호 단서). B유형에 "은행이 반드시 지급정지한다"고 말하지 않는다. 은행마다 판단이 다르고, 경찰 신고 후 수사기관이 요청할 수 있지만 거절될 수 있다고 안내한다. 보이스피싱·대출 사기(A유형)일 때만 금융회사의 지급정지 의무(제4조제1항)를 안내한다. 유형이 불분명하면 "무엇을 받기로 하고 돈을 보냈는지"를 먼저 묻는다.
- 국회에 발의만 된 법안(예: 2026. 7. 발의된 중고거래 지급정지 개정안)은 "발의된 법안이며 현재 시행 중인 법은 아님"이라고 구분한다.
- 품목별 분쟁해결기준의 금액·비율을 말할 때는 "참고 기준이며 최종 판단은 전자문서·전자거래분쟁조정위원회가 합니다"를 붙이고 판정처럼 말하지 않는다.
- 쿠폰·상품권·티켓(비실물)에 대한 질문에 근거 문서가 없으면 "문서에 없음 + 365센터 문의"로 답한다.
- 착오송금은 금액·절차를 단정하지 말고 예금보험공사(1588-0037) 문의로 안내한다. 사기 피해금은 착오송금 반환지원 대상이 아니다.
- 쉬운 말로 5문장 이내로 답한다. 마지막 줄에 "근거: 문서 이름"을 적는다.
- 화면에 글자 그대로 나오므로 **, #, - 같은 마크다운 기호를 쓰지 않는다.`;

function contactText() {
  return contactChunks().map((c) => c.text.split(/\r?\n/).filter((l) => l.startsWith('- ')).slice(0, 4).join('\n')).join('\n');
}

const CENTER = '온라인피해 365센터 ☎142-235 (평일 09:00~18:00), 누리집 www.helpos.kr 온라인 상담(24시간 신청)';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST 만 받습니다' });
  const body = await readJson(req);
  const question = String(body.question || '').slice(0, 500).trim();
  if (!question) return send(res, 400, { error: '질문이 비어 있습니다' });

  const found = searchChunks(question, 4);
  if (!found.length) {
    return send(res, 200, { live: false, noDoc: true, answer: `제공된 안내 문서에 없는 내용이에요. ${CENTER}로 문의해 주세요.`, sources: [] });
  }
  if (rateLimited(req)) {
    return send(res, 200, { live: false, tried: [{ provider: 'AI', reason: '요청이 많아 잠시 쉼' }], answer: `질문이 많아 잠시 AI 답변을 쉬고 있어요. 몇 분 뒤 다시 물어보시거나 ${CENTER}로 문의해 주세요.`, sources: [] });
  }
  const sources = [...new Map(found.map((c) => [c.docName, { name: c.docName, url: c.url }])).values()];
  const docs = found.map((c, i) => `[근거 문서 ${i + 1}] ${c.docName}\n${c.text}`).join('\n\n');
  const user = `[근거 문서]\n${docs}\n\n[문의처]\n${contactText()}\n\n[질문]\n${maskPersonal(question)}`;

  const ai = await askAI({ system: RULES, user, json: false });
  if (ai.ok) return send(res, 200, { live: true, provider: ai.provider, model: ai.model, tried: ai.tried, answer: ai.text.replace(/\*\*|^#+\s*/gm, '').trim(), sources });

  // AI 를 모두 못 썼을 때: 가장 가까운 조각을 그대로 보여 준다(시연 값)
  const top = found[0];
  const excerpt = top.text.split(/\r?\n/).filter((l) => l && !l.startsWith('출처:') && !l.startsWith('키워드:') && !l.startsWith('관련 문의처')).join('\n').slice(0, 600);
  return send(res, 200, { live: false, tried: ai.tried, answer: `가장 가까운 안내 문서 내용을 그대로 보여 드려요.\n\n${excerpt}`, sources: [{ name: top.docName, url: top.url }] });
}
