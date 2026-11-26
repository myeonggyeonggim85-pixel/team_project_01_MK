// 길잡이 화면 동작 — 분류와 정리표는 rules.js(코드)가 하고, AI 는 /api 를 통해서만 부른다
import {
  FIELDS, UNKNOWN, RESULT_LABEL, CONTACTS,
  emptyFacts, detectCrisis, guessFacts, classify, nextQuestion,
  buildSheet, buildHandoff, isDirectPay, isRealSafePay, ATTACH_TYPES,
} from './rules.js';
import { makeZip } from './zip.js';

const $ = (sel) => document.querySelector(sel);
const logEl = $('#log');
const choicesEl = $('#choices');
const inputEl = $('#input');
const sendBtn = $('#send');

const state = {
  facts: emptyFacts(),
  asked: new Set(),
  stage: 'start', // start · asking · confirm · result
  result: null,
  vagueMistake: false,
  crisisShown: false,
  sheetInput: { timeline: [{ when: '', what: '' }] },
  history: [], // 물어본 질문마다 그때의 상태를 남겨 「이전 질문으로」에 쓴다
  busy: false,
  userActed: false, // 첫 화면에서는 포커스를 옮기지 않는다
  attachments: [], // 올린 캡처 — 브라우저 메모리에만 둔다(서버 · AI 로 보내지 않음)
  refreshSheet: null, // 결과 화면의 정리표 미리보기를 다시 그리는 함수
  askedQ: new Set(), // 이미 답해 준 추천 질문(같은 추천이 되풀이되지 않게)
  fillActive: false, // 정리표 채우기 중인지
  fillStepId: null,
  fillCard: null,
  closed: false, // 「안내 마칠게요」를 눌렀는지
};

// 화면 낭독기에는 짧은 안내만 읽어 준다(대화 전체를 읽지 않게)
function announce(text) {
  const live = $('#srStatus');
  live.textContent = '';
  setTimeout(() => { live.textContent = text; }, 50);
}

// ---------- 공통 그리기 ----------
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  return node;
}

function scrollToEnd(node) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  (node || logEl.lastElementChild)?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
}

function bubble(who, content, meta, opts = {}) {
  const body = el('div', { class: 'msg__body' }, content);
  const node = el('div', { class: `msg msg--${who}` }, body);
  if (meta) node.append(meta);
  logEl.append(node);
  if (!opts.noScroll) scrollToEnd(node);
  return node;
}

function wide(content, opts = {}) {
  const node = el('div', { class: 'msg msg--bot msg--wide' }, content);
  logEl.append(node);
  if (!opts.noScroll) scrollToEnd(node);
  return node;
}

function setChoices(list) {
  choicesEl.replaceChildren(...list.map((c) => el('button', { type: 'button', class: `choice${c.quiet ? ' choice--quiet' : ''}`, onclick: c.onClick }, c.text)));
}

// 어느 AI 가 답했는지 · 시연 값인지
// 이용자에게는 쉬운 말로, 실패 이유는 괄호 안에 짧게 남긴다(어느 AI 가 답했는지 · 시연 값 여부는 늘 표시)
const REASON_WORD = { '키 비어 있음': '키 없음', '승인 안 됨': '사용 승인 안 됨', '시간 초과': '응답이 늦음', '오류': '오류' };
function metaLine(resp) {
  if (resp.live) return el('div', { class: 'msg__meta' }, `AI 정리: ${resp.provider} (${resp.model}) · 실시간`);
  if (resp.noDoc) return el('div', { class: 'msg__meta' }, '안내 문서에서 찾지 못했어요');
  const why = (resp.tried || []).map((t) => `${t.provider} ${REASON_WORD[t.reason] || t.reason}`).join(', ');
  const node = el('div', { class: 'msg__meta msg__meta--demo' }, `지금은 AI를 쓸 수 없어 간단히 정리했어요 (${why || '서버 연결 안 됨'})`);
  node.title = (resp.tried || []).map((t) => `${t.provider}: ${t.reason}${t.detail ? ` — ${t.detail}` : ''}`).join('\n');
  return node;
}

async function postJson(url, data) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// 이해한 사실 항목(「이렇게 이해했어요」 카드에서 고칠 수 있는 칸)
const SHOWN = ['situation', 'product', 'payment', 'lure', 'receipt', 'contact', 'fakePost'];

function start() {
  state.attachments.forEach((a) => a.url && URL.revokeObjectURL(a.url));
  Object.assign(state, { facts: emptyFacts(), asked: new Set(), stage: 'start', result: null, vagueMistake: false, sheetInput: { timeline: [{ when: '', what: '' }] }, history: [], attachments: [], refreshSheet: null, askedQ: new Set(), fillActive: false, fillStepId: null, fillCard: null, closed: false });
  // 109 상자는 한번 뜨면 처음부터 다시 해도 남겨 둔다(안전 우선). 상담원 요약에도 위기 표현을 유지
  if (state.crisisShown) state.facts.crisis = '있음';
  logEl.replaceChildren();
  $('.print-area')?.remove();
  inputEl.placeholder = '직접 쓰셔도 돼요. 예: 이어폰 산다고 15만 원 보냈는데 판매자가 답이 없어요';
  bubble('bot', '많이 놀라셨죠. 차근차근 같이 정리해 볼게요.\n아래에서 비슷한 상황을 누르거나, 있었던 일을 편하게 써 주세요.');
  askField('situation');
}

// 늘 함께 보이는 이동 버튼
function navChoices() {
  const list = [];
  const canBack = state.stage === 'asking' ? state.history.length >= 2 : state.history.length >= 1;
  if (canBack) list.push({ text: '← 이전 질문으로', quiet: true, onClick: back });
  if (state.userActed) list.push({ text: '처음부터 다시', quiet: true, onClick: () => { state.userActed = true; start(); } });
  return list;
}

function askField(k) {
  state.stage = 'asking';
  state.history.push({ k, facts: { ...state.facts }, asked: new Set(state.asked), logCount: logEl.children.length });
  const def = FIELDS[k];
  const q = k === 'situation' && state.vagueMistake
    ? '계좌번호나 금액을 잘못 입력하셨나요, 거래 상대에게 보냈는데 문제가 생겼나요?'
    : def.question;
  state.lastQuestion = q;
  bubble('bot', q);
  setChoices([
    ...def.options.map((o) => ({ text: o.text, onClick: () => answer(k, o.value, o.text, o.set) })),
    { text: '잘 모르겠어요', quiet: true, onClick: () => answer(k, UNKNOWN, '잘 모르겠어요') },
    ...navChoices(),
  ]);
  if (state.userActed) {
    announce(q);
    choicesEl.querySelector('button')?.focus({ preventScroll: true });
  }
}

// 이전 질문으로: 그 질문을 물었을 때의 상태로 되돌리고 다시 묻는다
function back() {
  if (state.busy) return;
  if (state.stage === 'asking') state.history.pop(); // 지금 보고 있는 질문
  const prev = state.history.pop();
  if (!prev) return;
  state.facts = { ...prev.facts };
  state.asked = new Set(prev.asked);
  state.result = null;
  while (logEl.children.length > prev.logCount) logEl.lastElementChild.remove();
  inputEl.placeholder = '예: 이어폰 산다고 15만 원 보냈는데 판매자가 답이 없어요';
  askField(prev.k);
}

// set: 바로가기 버튼 하나로 함께 정해지는 다른 사실 항목(예: 「돈을 보냈는데 물건이 안 와요」 → 수령 상태 = 못 받음)
function answer(k, value, text, set = null) {
  if (state.busy) return;
  state.userActed = true;
  bubble('user', text);
  state.facts[k] = value;
  state.asked.add(k);
  for (const [fk, fv] of Object.entries(set || {})) {
    state.facts[fk] = fv;
    state.asked.add(fk);
  }
  state.result = null;
  if (k === 'situation') state.vagueMistake = false;
  proceed();
}

function proceed() {
  const k = nextQuestion(state.facts, state.asked);
  if (k) askField(k);
  else showResult();
}

// 처리 중에는 새 입력을 받지 않는다(Enter 두 번 · 추천 질문 연타로 AI 가 겹쳐 불리는 것 방지)
async function onFreeText(text) {
  if (state.busy) return;
  state.busy = true;
  sendBtn.disabled = true;
  inputEl.readOnly = true;
  choicesEl.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  try {
    await handleText(text);
  } finally {
    state.busy = false;
    sendBtn.disabled = false;
    inputEl.readOnly = false;
    choicesEl.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  }
}

async function handleText(text) {
  state.userActed = true;
  bubble('user', text);
  // 위기 표현은 모든 입력에서 가장 먼저 확인한다(결과 화면의 추가 질문 포함)
  const crisis = detectCrisis(text);
  if (crisis) showCrisis();
  if (state.stage === 'result') {
    if (crisis) {
      bubble('bot', '지금 많이 힘드시다면 먼저 ☎109 자살예방 상담전화에 연락해 주세요. 24시간 언제든 무료예요.\n피해 정리와 기관 안내는 위 결과에 그대로 남아 있어요.');
      return;
    }
    state.askedQ.add(text);
    await askQuestion(text);
    afterAnswer();
    return;
  }
  setChoices([]);
  state.vagueMistake = /잘못\s*(보냈|보낸|송금|이체)/.test(text) && !/계좌번호|금액/.test(text);

  const wait = bubble('bot', el('span', { class: 'typing' }, '말씀하신 내용을 사실 항목으로 정리하고 있어요…'));
  let resp;
  try {
    resp = await postJson('/api/extract', { text });
  } catch (e) {
    resp = { live: false, tried: [{ provider: '서버', reason: `연결 안 됨(${e.message})` }], facts: guessFacts(text) };
  }
  wait.remove();
  // 새로 알게 된 값만 채운다(이미 고른 값은 '모름'으로 덮지 않음)
  for (const [k, v] of Object.entries(resp.facts || {})) {
    if (k === 'crisis') continue;
    if (v !== UNKNOWN) state.facts[k] = v;
  }
  if (resp.facts?.crisis === '있음') showCrisis();
  showUnderstood(resp);
}

// 지나간 카드의 고칠 칸 · 버튼을 잠근다(예전 카드 값으로 지금 정리한 내용을 덮어쓰지 않게)
function lockOldCards() {
  logEl.querySelectorAll('.card select, .card button, .js-once').forEach((x) => { x.disabled = true; });
}

function showUnderstood(resp) {
  lockOldCards();
  state.stage = 'confirm';
  const grid = el('div', { class: 'understood' });
  const selects = {};
  for (const k of SHOWN) {
    const id = `u-${k}`;
    const sel = el('select', { id, class: state.facts[k] === UNKNOWN ? 'is-unknown' : '' },
      ...FIELDS[k].values.map((v) => el('option', { value: v, selected: v === state.facts[k] }, v)));
    sel.addEventListener('change', () => sel.classList.toggle('is-unknown', sel.value === UNKNOWN));
    selects[k] = sel;
    grid.append(el('label', { for: id }, FIELDS[k].label), sel);
  }
  const known = SHOWN.filter((k) => state.facts[k] && state.facts[k] !== UNKNOWN);
  const go = () => {
    if (state.busy) return;
    lockOldCards();
    for (const [k, sel] of Object.entries(selects)) {
      state.facts[k] = sel.value;
      if (sel.value !== UNKNOWN) state.asked.add(k);
    }
    state.result = null;
    bubble('user', '맞아요, 이어서 진행할게요');
    proceed();
  };
  const card = el('div', { class: 'card' },
    el('div', { class: 'card__head' }, '이렇게 이해했어요'),
    el('div', { class: 'card__body' },
      known.length
        ? el('ul', { class: 'understood-list' }, ...known.map((k) => el('li', {}, el('span', {}, FIELDS[k].label), el('b', {}, state.facts[k]))))
        : el('p', { class: 'disclaimer' }, '아직 파악된 내용이 없어요. 이어서 하나씩 여쭤볼게요.'),
      el('p', { class: 'disclaimer', style: 'margin-top:10px' }, '모르는 부분은 이어서 하나씩 여쭤볼게요.'),
      el('details', { class: 'more' }, el('summary', {}, '틀린 곳이 있어요 (고치기)'), grid)),
    el('div', { class: 'card__foot' }, el('button', { type: 'button', class: 'btn btn--navy', onclick: go }, state.crisisShown ? '이어서 피해 상황 정리하기' : '맞아요, 계속')));
  const node = wide(card);
  node.append(metaLine(resp));
  setChoices(navChoices());
  announce('이렇게 이해했어요. 틀린 칸을 고친 뒤 계속을 눌러 주세요.');
  card.querySelector('select')?.focus({ preventScroll: true });
}

// ---------- 결과 ----------
const TITLES = {
  fraud: '사기가 의심되는 상황이에요. 증거를 지키고 경찰에 신고하세요.',
  dispute: '판매자와의 거래 분쟁으로 보여요. 요청 기록을 남기고 조정을 신청하세요.',
  unclear: '길잡이만으로 가르기 어려운 상황이에요. 365센터 상담원과 확인하세요.',
  mistake: '착오송금은 이 길잡이가 다루는 범위 밖이에요. 송금한 은행부터 연락하세요.',
  phishing: '보이스피싱 연계 수법으로 보여요. 지금 바로 112에 신고하세요.',
  fakepay: '가짜 안전결제 링크 수법으로 보여요. 더 보내지 말고 경찰에 신고하세요.',
  coupon: '쿠폰·상품권 사기 수법으로 보여요. 발행처에서 사용 내역부터 확인하세요.',
  vanish: '물건 미발송·잠적 수법으로 보여요. 증거를 지키고 경찰에 신고하세요.',
  seller: '판매자 피해는 분류 기준표 밖이에요. 365센터 상담원과 함께 확인하세요.',
};

// 수법별 지금 할 일 — 근거: 2023 온라인피해상담사례집(사례02·07, 알아두기), 생활법령 더치트, 금융감독원 대처방법, 안내규칙메모
const SCHEME_TODO = {
  fakepay: [
    '수수료 · 보증금 명목으로 돈을 더 보내라고 해도 보내지 마세요.',
    '받은 결제 링크 주소, 결제 화면, 판매자와의 대화를 지금 바로 캡처해 두세요.',
    '경찰청 사이버범죄 신고시스템(ECRM)에 먼저 온라인 신고한 뒤 경찰서를 방문하세요. 미리 신고하면 방문 접수 시간이 줄어요.',
    '이체한 은행에 지급정지가 되는지 물어보세요. 중고거래 사기는 특별법상 지급정지 의무 대상이 아니어서 은행마다 판단이 달라요.',
    '거래한 플랫폼 고객센터에도 판매자를 신고하세요.',
    '알아 두세요: 진짜 안전결제는 비회원 결제가 안 되고, 가상계좌 예금주에 개인 이름이 없으며, 입금 은행을 고를 수 있어요.',
  ],
  coupon: [
    '쿠폰 · 상품권 발행처에 사용 내역을 확인하고, 그 결과를 증거로 남겨 두세요. 길잡이는 진위를 직접 조회할 수 없어요.',
    '판매자와의 대화, 판매 글, 받은 쿠폰 이미지를 캡처해 두세요.',
    '이체한 은행에 지급정지가 되는지 물어보세요(은행마다 판단이 달라요).',
    '경찰청 사이버범죄 신고시스템(ECRM)이나 경찰서에 신고하세요.',
    '쿠폰 · 상품권은 공공기관 안내 문서가 부족해, 더 궁금한 점은 온라인피해 365센터(☎142-235)에 물어보세요.',
  ],
  vanish: [
    '더 보내지 마세요. 판매자와의 대화, 판매 글, 프로필을 지금 바로 캡처해 두세요.',
    '더치트(thecheat.co.kr)나 경찰청 사이버캅 앱에서 판매자 계좌 · 전화번호의 피해 이력을 조회하고, 결과 화면도 증거로 남기세요.',
    '이체한 은행에 지급정지가 되는지 물어보세요. 중고거래 사기는 특별법상 지급정지 의무 대상이 아니어서 은행마다 판단이 달라요.',
    '경찰청 사이버범죄 신고시스템(ECRM)에 온라인 신고한 뒤 경찰서를 방문하세요. 같은 계좌로 피해자가 여럿이면, 한 명이 경찰서 조사를 받은 경우 다른 피해자는 온라인 신고만으로 수사가 진행될 수 있어요.',
    '가해자가 기소되면 형사재판에서 배상을 함께 명하는 형사배상명령제도를 쓸 수 있고, 민사 절차는 대한법률구조공단(☎132)에서 상담할 수 있어요.',
  ],
  phishing: [
    '지금 바로 112에 신고하세요.',
    '송금한 은행 고객센터에 지급정지를 요청하세요. 보이스피싱은 특별법에 따라 금융회사가 지급정지를 해야 하는 대상이에요.',
    '설치한 앱이 의심되면 휴대전화를 초기화하거나 앱을 지우세요. 그 전까지는 전원을 끄거나 비행기 모드로 두세요.',
    '금융감독원 개인정보 노출자 사고예방시스템(pd.fss.or.kr)에 등록하면 내 이름으로 새 계좌 · 카드가 만들어지는 것을 막을 수 있어요(다른 기기로 접속 권장).',
    '도움이 더 필요하면 금융감독원(☎1332)에 문의하세요.',
  ],
};

// 송금 방법에 맞게 은행 안내를 바꾼다(정리표의 byPayment 와 같은 기준)
function todoList(f, r) {
  const list = baseTodo(f, r);
  const isBank = (t) => t.includes('이체한 은행');
  if (isDirectPay(f)) {
    return [...list.filter((t) => !isBank(t)), '현장에서 만난 날짜 · 시간 · 장소를 적어 두고, 받은 물건 사진을 남겨 두세요.'];
  }
  if (isRealSafePay(f, r) && r.type === 'fraud') {
    const safe = '거래한 플랫폼 고객센터에 결제 취소 · 환불을 바로 요청하세요. 안전결제 대금은 플랫폼에 맡겨져 있어요.';
    const rest = list.filter((t) => !isBank(t) && !t.startsWith('거래한 플랫폼 고객센터에도'));
    return [rest[0], safe, ...rest.slice(1)];
  }
  return list;
}

function baseTodo(f, r) {
  if (r.scheme && SCHEME_TODO[r.scheme.id]) return SCHEME_TODO[r.scheme.id];
  if (r.type === 'fraud') {
    const list = [
      '더 보내지 마세요. 추가 입금이나 수수료를 요구해도 응하지 않아요.',
      '판매자와의 대화, 판매 글, 상대방 프로필을 지금 바로 캡처해 두세요(날짜 · 시간이 보이게).',
      '이체한 은행에 지급정지가 되는지 물어보세요. 중고거래 사기는 특별법상 지급정지 의무 대상이 아니어서 은행마다 판단이 달라요.',
      '경찰청 사이버범죄 신고시스템(ECRM)이나 가까운 경찰서에 신고하세요. 아래 증거 정리표를 함께 내면 돼요.',
    ];
    if (f.product === '비실물(쿠폰·상품권·티켓)') list.splice(2, 0, '쿠폰 · 상품권 발행처에서 사용 내역을 확인해 증거로 남겨 두세요. 길잡이는 진위를 직접 조회할 수 없어요.');
    if (f.payment === '플랫폼 안전결제') list.push('거래한 플랫폼 고객센터에도 바로 신고하세요.');
    return list;
  }
  if (r.type === 'dispute') {
    return [
      '판매자에게 환불 · 교환을 요청하는 메시지를 보내고 기록을 남기세요(아래 초안을 쓸 수 있어요).',
      '합의가 안 되면 거래 플랫폼 고객센터에 1차 조정을 요청하세요.',
      '그래도 안 되면 전자문서 · 전자거래분쟁조정위원회(☎118)에 조정을 신청하세요.',
      '돈을 돌려받는 것이 목적인데 상대가 조정에 응하지 않으면 대한법률구조공단(☎132)에서 지급명령을 상담하세요.',
    ];
  }
  if (r.sub === 'seller') {
    return [
      '온라인피해 365센터 상담원과 상황을 함께 확인하세요(☎142-235). 정리한 내용은 그대로 넘길 수 있어요.',
      '구매자와의 대화, 내가 올린 판매 글, 상대방 프로필을 캡처해 두세요.',
      '물건을 보낸 운송장 · 발송 기록을 보관하세요.',
      '사기 정황이 확인되면 경찰청 사이버범죄 신고시스템(ECRM)이나 경찰서에 신고하세요.',
    ];
  }
  if (r.type === 'unclear') {
    const list = [
      '온라인피해 365센터 상담원과 상황을 함께 확인하세요(☎142-235). 정리한 내용은 그대로 넘길 수 있어요.',
      '그동안 대화 내역 · 판매 글 · 입금 내역을 캡처해 두세요.',
    ];
    if (r.rule === 9) list.push('가품은 판매자가 알고 팔았는지에 따라 사기가 될 수도, 거래 분쟁이 될 수도 있어 상담원이 함께 판단해요.');
    return list;
  }
  if (r.sub === 'mistake') {
    return [
      '송금한 은행에 착오송금 반환을 요청하세요.',
      '반환되지 않으면 예금보험공사 착오송금 반환지원을 신청할 수 있어요. 금액과 절차는 예금보험공사(☎1588-0037)에 문의하세요.',
      '거래 상대에게 돈을 보냈는데 물건을 못 받은 경우는 착오송금이 아니에요. 사기 피해금은 착오송금 반환지원으로 돌려받을 수 없어요.',
    ];
  }
  return [
    '지금 바로 112에 신고하세요.',
    '송금한 은행 고객센터에 지급정지를 요청하세요. 보이스피싱은 특별법에 따라 금융회사가 지급정지를 해야 하는 대상이에요.',
    '도움이 더 필요하면 금융감독원(☎1332)에 문의하세요.',
  ];
}

function agencyLinks(r) {
  const c = CONTACTS;
  const map = {
    fraud: [c.ecrm, c.center365],
    dispute: [c.ecmc, c.klac],
    unclear: [c.center365],
    mistake: [c.kdic],
    phishing: [{ name: '긴급신고', tel: '112' }, { name: '금융감독원', tel: '1332', url: 'https://pd.fss.or.kr' }],
    fakepay: [c.ecrm, c.center365],
    coupon: [c.ecrm, c.center365],
    vanish: [c.ecrm, { name: '더치트 피해 이력 조회', url: 'https://thecheat.co.kr' }, c.klac],
    seller: [c.center365, c.ecrm],
  };
  const key = map[r.scheme?.id] ? r.scheme.id : (map[r.sub] ? r.sub : r.type);
  const telLink = (tel, label) => el('a', { class: 'btn btn--line', href: `tel:${tel.replace(/-/g, '')}` }, `☎ ${tel} ${label}`.trim());
  return map[key].flatMap((a) => [
    a.url ? el('a', { class: 'btn btn--line', href: a.url, target: '_blank', rel: 'noopener' }, `${a.name} 바로가기`) : null,
    // 경찰은 급하지 않은 신고를 112로 걸지 않게: 182 민원상담 + 112 긴급할 때(문의처_경찰청_사이버범죄신고)
    ...(a.tels || []).map(([tel, label]) => telLink(tel, label)),
    a.tel ? telLink(a.tel, a.url ? '' : a.name) : null,
  ]);
}

function disputeDraft(f) {
  const what = f.receipt === '배송 중 파손' ? '배송 중 파손된 상태로 도착했어요' : '판매 글의 설명과 상태가 달라요';
  return `안녕하세요. ○월 ○일에 거래한 (상품 이름)을 받았는데 ${what}.\n받은 물건 사진과 판매 글 화면을 함께 보내 드려요.\n환불(또는 교환)을 요청드리며, ○월 ○일까지 답변 부탁드립니다.\n답변이 없으면 거래 플랫폼과 분쟁조정위원회에 조정을 신청하려고 합니다.`;
}

function sec(title, ...content) {
  return el('div', { class: 'result__sec' }, title ? el('h3', { class: 'result__h' }, title) : null, ...content);
}

function showResult() {
  lockOldCards();
  state.stage = 'result';
  const f = state.facts;
  const r = classify(f);
  state.result = r;

  const key = TITLES[r.scheme?.id] ? r.scheme.id : (TITLES[r.sub] ? r.sub : r.type);
  const why = r.rule
    ? el('p', { class: 'result__why' }, `${r.reason}.`)
    : el('p', { class: 'result__why' }, `${r.reason}.`);
  const schemeWhy = r.scheme
    ? el('p', { class: 'result__why', style: 'margin-top:4px' }, '수법 구분: ', el('b', {}, r.scheme.name), ` — ${r.scheme.basis}. 수법은 안내를 고르기 위한 구분이며, 사기인지는 수사기관이 판단해요.`)
    : null;
  const badge = r.scheme ? `${RESULT_LABEL[r.type]} · ${r.scheme.name}` : RESULT_LABEL[r.type];
  const isFraudLike = r.type === 'fraud' || r.scheme?.id === 'phishing';

  // 당황한 이용자가 먼저 볼 것부터: 제목 → 지금 할 일 → 기관 → 상담원·다시 시작 → 정리표 → 근거(접힘)
  const todos = todoList(f, r);
  const TOP = 3;
  const todoEl = el('ol', { class: 'todo' }, ...todos.slice(0, TOP).map((t) => el('li', {}, t)));
  const moreTodo = todos.length > TOP
    ? el('details', { class: 'more' }, el('summary', {}, `할 일 ${todos.length - TOP}개 더 보기`),
      el('ol', { class: 'todo', start: TOP + 1 }, ...todos.slice(TOP).map((t) => el('li', {}, t))))
    : null;
  const title = el('h2', { class: 'result__title', tabindex: '-1' }, TITLES[key]);
  const hasSheet = r.type !== 'out' || r.sub === 'phishing';

  const box = el('article', { class: `result result--${isFraudLike ? 'fraud' : r.type}`, 'aria-label': `진단 결과: ${badge}` },
    el('div', { class: 'result__head' }, el('span', { class: 'result__badge' }, badge), title),
    sec('지금 할 일', todoEl, moreTodo),
    sec('기관 바로가기', el('div', { class: 'agencies' }, ...agencyLinks(r))),
    sec(null, el('div', { class: 'row-actions', style: 'margin-top:0' },
      hasSheet ? el('button', { type: 'button', class: 'btn btn--navy', onclick: () => state.fillAnchor?.scrollIntoView({ block: 'start' }) }, '정리표 채우기 (날짜 · 계좌 · 캡처)') : null,
      el('button', { type: 'button', class: hasSheet ? 'btn btn--line' : 'btn btn--navy', onclick: openHandoff }, '365센터 상담원에게 넘길 요약'),
      el('button', { type: 'button', class: 'btn btn--line', onclick: back }, '← 답 고치기'),
      el('button', { type: 'button', class: 'btn btn--line', onclick: start }, '처음부터 다시'))));

  if (r.type === 'out' && r.sub === 'mistake') {
    box.append(sec(null, el('button', { type: 'button', class: 'btn btn--line js-once', onclick: (e) => { e.currentTarget.disabled = true; state.facts.situation = '중고거래 피해'; state.asked.add('situation'); bubble('user', '거래 상대에게 보낸 거예요'); proceed(); } }, '거래 상대에게 보낸 거예요 — 다시 진단')));
  }
  if (r.type === 'dispute') {
    const draft = disputeDraft(f);
    box.append(sec('판매자에게 보낼 요청 메시지 초안',
      el('pre', { class: 'draft' }, draft),
      el('div', { class: 'row-actions' }, copyButton('초안 복사', () => draft))));
  }
  if (hasSheet) box.append(sheetSection(f, r));
  box.append(sec(null, el('details', {}, el('summary', {}, '왜 이렇게 안내했나요'), why, schemeWhy)));
  if (r.type === 'fraud' || r.type === 'dispute') box.append(lawSection(r.type));
  box.append(sec(null,
    el('p', { class: 'disclaimer' }, '※ 이 안내는 법적 판단이 아닙니다. 사기 여부는 수사기관이, 분쟁은 조정 기관이 판단합니다.'),
    el('p', { class: 'disclaimer', style: 'margin-top:4px' }, '죽고 싶은 생각이 들면 ', el('a', { href: 'tel:109' }, '☎ 109 자살예방 상담전화'), '(24시간)로 연락하세요.')));

  wide(box);
  title.focus({ preventScroll: true });
  box.scrollIntoView({ block: 'start' });
  announce(`진단 결과: ${badge}. ${TITLES[key]}`);
  inputEl.placeholder = '궁금한 점을 직접 물어보셔도 돼요';
  renderFollowChoices();
  // 결과를 먼저 읽게 두고(화면을 옮기지 않음), 그 아래에서 정리표 채우기 질문을 이어서 한다
  if (hasSheet) startFill(f, r);
  else askClosing();
}

// 결과 종류에 맞는 추천 질문 — 모두 안내 문서(docs/답변참고문서/청킹)에서 근거를 찾을 수 있는 문장이다
function suggestions(r) {
  const id = r.scheme?.id;
  if (id === 'phishing') return ['악성앱 설치가 의심될 때는 어떻게 해야 하나요?', '보이스피싱 지급정지는 어떻게 해요?'];
  if (id === 'fakepay') return ['진짜 안전결제는 어떻게 구별해요?', '경찰서에 신고하는 방법을 알려 주세요'];
  if (r.type === 'fraud') return ['경찰서에 신고하는 방법을 알려 주세요', '은행에 지급정지를 요청할 수 있나요?'];
  if (r.type === 'dispute') return ['분쟁조정은 어떻게 신청해요?', '지급명령이 뭐예요?'];
  if (r.sub === 'mistake') return ['착오송금 반환지원은 어떻게 신청해요?'];
  return ['365센터 상담은 어떻게 받아요?', '경찰서에 신고하는 방법을 알려 주세요'];
}

// 어느 결과에서나 이어서 물어볼 만한 질문(결과별 추천이 떨어지면 이쪽에서 채운다)
const MORE_QUESTIONS = [
  '보낸 돈을 돌려받을 수 있나요?',
  '소액인데 빨리 돌려받는 방법이 있나요?',
  '온라인피해 365센터는 어떤 곳이에요?',
  '더치트에 피해 사례를 등록해도 되나요?',
  '중고거래 플랫폼에는 어떻게 신고하나요?',
  '거래를 취소하고 손해배상을 받을 수 있나요?',
];

// 정리표 채우기 단계마다 그 순간 궁금할 만한 질문
const FILL_QUESTIONS = {
  when: ['경찰서에 신고하는 방법을 알려 주세요', '보낸 돈을 돌려받을 수 있나요?'],
  account: ['은행에 지급정지를 요청할 수 있나요?', '보낸 돈을 돌려받을 수 있나요?'],
  who: ['더치트에 피해 사례를 등록해도 되나요?', '중고거래 플랫폼에는 어떻게 신고하나요?'],
  item: ['중고거래 플랫폼에는 어떻게 신고하나요?', '거래를 취소하고 손해배상을 받을 수 있나요?'],
  files: ['경찰서에 신고하는 방법을 알려 주세요', '소액인데 빨리 돌려받는 방법이 있나요?'],
};

function pickSuggestions(n = 3) {
  const pool = state.fillActive
    ? (FILL_QUESTIONS[state.fillStepId] || [])
    : [...suggestions(state.result || {}), ...MORE_QUESTIONS];
  return [...new Set(pool)].filter((q) => !state.askedQ.has(q)).slice(0, n);
}

// 답을 해 준 뒤·결과를 보여 준 뒤마다 「다음에 누를 만한 것」을 바닥 선택지로 다시 깐다
function renderFollowChoices() {
  const asks = pickSuggestions().map((q) => ({ text: q, onClick: () => onFreeText(q) }));
  if (state.fillActive) {
    setChoices([
      ...asks,
      { text: '↑ 정리표 채우기로 돌아가기', quiet: true, onClick: () => state.fillCard?.scrollIntoView({ block: 'center', behavior: 'smooth' }) },
    ]);
    return;
  }
  if (state.closed) {
    setChoices([
      { text: '궁금한 점이 더 생겼어요', onClick: reopenGuide },
      { text: '처음부터 다시', quiet: true, onClick: start },
    ]);
    return;
  }
  setChoices([
    ...asks,
    { text: '괜찮아요 · 안내 마칠게요', onClick: endGuide },
    { text: '처음부터 다시', quiet: true, onClick: start },
  ]);
}

// 정리표(또는 결과)까지 본 뒤: 더 궁금한 점이 없는지 먼저 묻고, 대답을 들은 뒤에 마친다
function askClosing() {
  bubble('bot', '여기까지 정리해 드렸어요. 혹시 더 궁금한 점이나, 막막한 부분은 없으세요?\n아래 추천 질문을 누르거나 직접 물어봐 주세요. 괜찮으시면 안내를 마칠게요.');
  announce('더 궁금한 점이 없는지 확인해요.');
  renderFollowChoices();
}

function endGuide() {
  if (state.busy) return;
  state.userActed = true;
  state.closed = true;
  bubble('user', '괜찮아요, 안내 마칠게요');
  const f = state.facts;
  const r = state.result || classify(f);
  const todos = todoList(f, r).slice(0, 3);
  const lines = [
    '끝까지 읽어 주셔서 고마워요. 마지막으로 꼭 챙길 것만 다시 정리해 드릴게요.',
    ...(todos.length ? ['', '지금 하실 일', ...todos.map((t, i) => `${i + 1}. ${t}`)] : []),
    '',
    '도움받을 곳',
    '· 온라인피해 365센터 ☎142-235 (평일 09:00~18:00), 누리집 www.helpos.kr 온라인 상담(24시간 신청)',
    '· 경찰 신고: 사이버범죄 신고시스템(ECRM), 급하면 ☎112',
    '',
    '혼자 감당하지 않으셔도 돼요. 많이 힘드시면 ☎109 자살예방 상담전화(24시간)도 있어요.',
    '궁금한 점이 생기면 아래 입력칸에 언제든 물어보세요.',
  ];
  bubble('bot', lines.join('\n'));
  announce('안내를 마쳤어요. 궁금한 점이 생기면 언제든 물어보세요.');
  renderFollowChoices();
}

function reopenGuide() {
  state.closed = false;
  bubble('user', '궁금한 점이 더 생겼어요');
  bubble('bot', '네, 편하게 물어보세요. 아래 추천 질문을 누르거나 직접 써 주셔도 돼요.');
  renderFollowChoices();
}

// 질문에 답한 뒤 이어서 할 일을 안내한다
function afterAnswer() {
  if (state.fillActive) bubble('bot', '정리표는 위 카드에서 이어서 채우시면 돼요. 더 궁금한 건 계속 물어보세요.');
  else if (!state.closed) bubble('bot', '다른 궁금한 점은 없으세요? 괜찮으시면 안내를 마칠게요.');
  renderFollowChoices();
}

function copyButton(label, getText) {
  const btn = el('button', { type: 'button', class: 'btn btn--line' }, label);
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getText());
      btn.textContent = '복사했어요';
    } catch {
      btn.textContent = '복사하지 못했어요 — 직접 선택해 복사하세요';
    }
    setTimeout(() => { btn.textContent = label; }, 2000);
  });
  return btn;
}

// ---------- 증거 정리표 ----------
// 정리표에 넣을 값 = 입력한 칸 + 올린 캡처(이름 · 종류만)
function sheetData() {
  return { ...state.sheetInput, attachments: state.attachments.map((a) => ({ zipName: a.zipName, type: a.type })) };
}

// 같은 칸이 챗봇 질문과 정리표 입력 상자 두 곳에 있으므로 값을 서로 맞춘다
function setSheetValue(key, value, from) {
  state.sheetInput[key] = value;
  document.querySelectorAll(`[data-key="${key}"]`).forEach((inp) => { if (inp !== from) inp.value = value; });
  state.refreshSheet?.();
}

function fieldInput(key, label, type = 'text', placeholder = '') {
  const inputmode = type === 'tel' ? 'numeric' : null;
  const input = el('input', { type, value: state.sheetInput[key] || '', placeholder, inputmode, 'data-key': key });
  input.addEventListener('input', () => setSheetValue(key, input.value, input));
  return el('label', {}, label, input);
}

// ---------- 캡처 올리기 (브라우저 안에서만) ----------
const MAX_FILES = 10;
const MAX_SIZE = 10 * 1024 * 1024;
const attachLists = new Set();

function renumberAttachments() {
  state.attachments.forEach((a, i) => {
    const t = ATTACH_TYPES.find((x) => x.id === a.type) || ATTACH_TYPES.at(-1);
    const ext = (a.file.name.match(/\.([a-z0-9]{2,5})$/i)?.[1] || (a.file.type === 'application/pdf' ? 'pdf' : 'jpg')).toLowerCase();
    a.zipName = `${String(i + 1).padStart(2, '0')}_${t.file}.${ext}`;
  });
}

function attachChanged(message) {
  renumberAttachments();
  attachLists.forEach((list) => { if (list.isConnected) renderAttachList(list, message); else attachLists.delete(list); });
  state.refreshSheet?.();
}

function addFiles(fileList) {
  const notes = [];
  for (const file of fileList) {
    if (state.attachments.length >= MAX_FILES) { notes.push(`최대 ${MAX_FILES}개까지 올릴 수 있어요.`); break; }
    const ok = file.type.startsWith('image/') || file.type === 'application/pdf';
    if (!ok) { notes.push(`${file.name}: 사진이나 PDF만 올릴 수 있어요.`); continue; }
    if (file.size > MAX_SIZE) { notes.push(`${file.name}: 10MB보다 커서 뺐어요.`); continue; }
    const type = state.attachments.length === 0 ? 'chat' : 'etc';
    state.attachments.push({ id: crypto.randomUUID(), file, type, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null, zipName: '' });
  }
  attachChanged(notes.join(' '));
  announce(`캡처 ${state.attachments.length}개가 준비됐어요.${notes.length ? ` ${notes.join(' ')}` : ''}`);
}

function renderAttachList(list, message = '') {
  const items = state.attachments.map((a) => {
    const sel = el('select', { 'aria-label': `${a.file.name} 종류` }, ...ATTACH_TYPES.map((t) => el('option', { value: t.id, selected: t.id === a.type }, t.label)));
    sel.addEventListener('change', () => { a.type = sel.value; attachChanged(); });
    const del = el('button', { type: 'button', class: 'btn btn--line attach__del', 'aria-label': `${a.file.name} 빼기` }, '빼기');
    del.addEventListener('click', () => {
      if (a.url) URL.revokeObjectURL(a.url);
      state.attachments = state.attachments.filter((x) => x !== a);
      attachChanged();
    });
    const thumb = a.url ? el('img', { class: 'attach__thumb', src: a.url, alt: '' }) : el('span', { class: 'attach__thumb attach__thumb--pdf' }, 'PDF');
    return el('li', { class: 'attach__item' }, thumb,
      el('div', { class: 'attach__meta' }, el('span', { class: 'attach__name' }, a.zipName), el('span', { class: 'attach__orig' }, a.file.name), sel),
      del);
  });
  list.replaceChildren(
    ...(message ? [el('li', { class: 'attach__msg', role: 'alert' }, message)] : []),
    ...(items.length ? items : [el('li', { class: 'attach__empty' }, '아직 올린 캡처가 없어요.')]),
  );
}

function attachPanel() {
  const input = el('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, hidden: true });
  input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
  const pick = el('button', { type: 'button', class: 'btn btn--line' }, '파일 · 사진 고르기');
  pick.addEventListener('click', () => input.click());
  const list = el('ul', { class: 'attach__list' });
  attachLists.add(list);
  renderAttachList(list);
  return el('div', { class: 'attach' },
    el('div', { class: 'row-actions', style: 'margin-top:0;align-items:center' }, pick, el('span', { class: 'attach__hint' }, `사진 · PDF, ${MAX_FILES}개까지 · 한 개 10MB까지`)),
    input, list);
}

function download(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function sheetSection(f, r) {
  const pre = el('pre', { class: 'sheet', id: 'sheetPreview' });
  const s = state.sheetInput;
  const downloadBtn = el('button', { type: 'button', class: 'btn btn--green' });
  const refresh = () => {
    pre.textContent = buildSheet(f, r, sheetData());
    const n = state.attachments.length;
    downloadBtn.textContent = n ? `정리표 + 캡처 ${n}개 내려받기 (.zip)` : '정리표 내려받기 (.txt)';
  };
  state.refreshSheet = refresh;
  const field = (key, label, placeholder, type = 'text') => fieldInput(key, label, type, placeholder);

  const timeline = el('div', { class: 'timeline' }, el('span', { style: 'font-size:13px;color:var(--fg-3)' }, '사건 타임라인 (시간순 · 날짜는 "10/02 14:10"처럼)'));
  const rowsWrap = el('div', { style: 'display:flex;flex-direction:column;gap:6px' });
  const addRow = (t) => {
    const when = el('input', { type: 'text', value: t.when, placeholder: '10/02 14:10', 'aria-label': '날짜와 시간' });
    const what = el('input', { type: 'text', value: t.what, placeholder: '150,000원 계좌이체', 'aria-label': '있었던 일' });
    when.addEventListener('input', () => { t.when = when.value; refresh(); });
    what.addEventListener('input', () => { t.what = what.value; refresh(); });
    const row = el('div', { class: 'timeline__row' }, when, what);
    const del = el('button', { type: 'button', class: 'btn btn--line timeline__del', 'aria-label': '이 줄 지우기' }, '지우기');
    del.addEventListener('click', () => {
      const i = s.timeline.indexOf(t);
      if (i >= 0) s.timeline.splice(i, 1);
      row.remove();
      refresh();
    });
    row.append(del);
    rowsWrap.append(row);
  };
  s.timeline.forEach(addRow);
  timeline.append(rowsWrap, el('button', { type: 'button', class: 'btn btn--line', style: 'align-self:flex-start', onclick: () => { const t = { when: '', what: '' }; s.timeline.push(t); addRow(t); rowsWrap.lastElementChild.querySelector('input').focus(); } }, '+ 한 줄 더'));

  const seller = r.sub === 'seller';
  const form = el('div', { class: 'sheet-form' },
    field('paidDate', seller ? '거래 날짜' : '송금 · 거래 날짜', '', 'date'),
    field('paidTime', '시간', '', 'time'),
    field('amount', seller ? '받기로 한 금액(원)' : '피해 금액(원)', '150000', 'tel'),
    seller ? null : field('count', '송금 횟수', '1', 'tel'),
    field('item', '물건 이름', '예: 무선 이어폰'),
    field('postUrl', '판매 글 주소', 'https://', 'url'),
    field('app', '거래 앱', '중고거래 앱 이름'),
    field('nickname', '상대방 닉네임', ''),
    field('profileId', '프로필 ID', '#ab12cd'),
    seller ? null : field('bank', '입금 은행', 'OO은행'),
    seller ? null : field('account', '입금 계좌번호', '123-456-7890'),
    seller ? null : field('holder', '예금주', '홍OO'),
    field('phone', '상대방 연락처', '모르면 비워 두세요'),
    timeline);

  // 내려받기: 캡처가 있으면 정리표.txt + 원본 캡처를 ZIP 하나로, 없으면 정리표.txt
  downloadBtn.addEventListener('click', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const text = '﻿' + buildSheet(f, r, sheetData()).replace(/\n/g, '\r\n');
    if (!state.attachments.length) {
      download(new Blob([text], { type: 'text/plain;charset=utf-8' }), `증거정리표_${day}.txt`);
      return;
    }
    downloadBtn.disabled = true;
    try {
      const entries = [{ name: '00_증거정리표.txt', data: new TextEncoder().encode(text) }];
      for (const a of state.attachments) entries.push({ name: a.zipName, data: new Uint8Array(await a.file.arrayBuffer()) });
      download(makeZip(entries), `증거정리표_${day}.zip`);
      announce('정리표와 캡처를 ZIP 파일 하나로 내려받았어요.');
    } finally {
      downloadBtn.disabled = false;
    }
  });

  // 인쇄 · PDF: 정리표 다음에 올린 사진을 이름 · 종류와 함께 붙인다(PDF 파일은 이름만 적힘)
  const print = el('button', { type: 'button', class: 'btn btn--line' }, '인쇄 · PDF로 저장');
  print.addEventListener('click', () => {
    $('.print-area')?.remove();
    const figures = state.attachments.filter((a) => a.url).map((a) => el('figure', { class: 'print-fig' },
      el('img', { src: a.url, alt: a.zipName }),
      el('figcaption', {}, `${a.zipName} · ${ATTACH_TYPES.find((t) => t.id === a.type)?.label || ''}`)));
    const area = el('div', { class: 'print-area' }, el('pre', {}, buildSheet(f, r, sheetData())), ...figures);
    document.body.append(area);
    document.body.classList.add('print-sheet');
    window.addEventListener('afterprint', () => area.remove(), { once: true }); // 인쇄 뒤 화면에 남기지 않는다
    window.print();
    document.body.classList.remove('print-sheet');
  });

  refresh();
  return sec('증거 정리표',
    el('p', { class: 'disclaimer' }, '항상 같은 6칸 양식으로 만들어요. 모르는 칸은 "모름"으로 남겨요. 입력한 내용과 캡처는 이 화면에서만 쓰이고 서버로 보내거나 저장하지 않아요.'),
    el('div', { class: 'row-actions', style: 'margin-top:8px' }, downloadBtn, print, copyButton('정리표 복사', () => buildSheet(f, r, sheetData()))),
    el('details', { class: 'more' }, el('summary', {}, '캡처 · 사진 올리기'), attachPanel()),
    el('details', { class: 'more' }, el('summary', {}, '정리표에 넣을 내용 직접 고치기'), form),
    el('details', { class: 'more' }, el('summary', {}, '정리표 미리보기'), pre),
    el('p', { class: 'disclaimer', style: 'margin-top:8px' }, '제출은 직접 하세요. ZIP 안의 캡처 원본을 함께 내면 경찰 · 상담원이 바로 알아볼 수 있어요.'));
}

// ---------- 결과 뒤 정리표 채우기 (한 단계씩, 건너뛰기 가능) ----------
const FILL_STEPS = [
  {
    id: 'when',
    title: (f, r) => (r.sub === 'seller' ? '언제 거래했나요?' : isDirectPay(f) ? '언제 만나서 거래했나요?' : '언제 돈을 보냈나요?'),
    note: '경찰 신고에 꼭 필요한 내용이에요. 정확히 모르면 대략 적어도 돼요.',
    fields: (f, r) => [
      ['paidDate', '날짜', 'date'],
      ['paidTime', '시간', 'time'],
      ['amount', r.sub === 'seller' ? '받기로 한 금액(원)' : '금액(원)', 'tel', '150000'],
      ...(r.sub === 'seller' ? [] : [['count', '보낸 횟수', 'tel', '1']]),
    ],
  },
  {
    id: 'account',
    skip: (f, r) => r.sub === 'seller' || isDirectPay(f) || isRealSafePay(f, r),
    title: () => '어느 계좌로 보냈나요?',
    note: '입금 확인증에 나온 그대로 적어 주세요. 경찰 신고에 꼭 필요한 내용이에요.',
    fields: () => [['bank', '은행', 'text', 'OO은행'], ['account', '계좌번호', 'text', '123-456-7890'], ['holder', '예금주', 'text', '홍OO']],
  },
  {
    id: 'who',
    title: () => '상대방은 누구인가요?',
    note: '모르는 칸은 비워 두세요.',
    fields: () => [['app', '거래 앱', 'text', '중고거래 앱 이름'], ['nickname', '닉네임', 'text', ''], ['profileId', '프로필 ID', 'text', '#ab12cd'], ['phone', '연락처', 'tel', '모르면 비워 두세요']],
  },
  {
    id: 'item',
    title: () => '무엇을 거래했나요?',
    note: '판매 글 주소는 글이 지워지기 전에 남겨 두면 좋아요.',
    fields: () => [['item', '물건 이름', 'text', '예: 무선 이어폰'], ['postUrl', '판매 글 주소', 'url', 'https://']],
  },
  {
    id: 'files',
    title: () => '캡처나 사진을 올려 주세요',
    note: '대화 내역 · 판매 글 · 입금 확인증 등을 파일이나 갤러리에서 고르세요. 종류를 고르면 정리표 체크리스트에 표시돼요.',
    attach: true,
  },
];

function startFill(f, r) {
  const intro = bubble('bot', '정리표를 같이 채워 볼까요? 몇 가지만 답하면 경찰 · 상담원이 바로 알아볼 수 있게 돼요.\n이 내용은 서버나 AI로 보내지 않고, 모르면 건너뛰어도 돼요.', null, { noScroll: true });
  state.fillAnchor = intro;
  state.fillActive = true;
  runFill(f, r, 0, true);
}

function runFill(f, r, i, first = false) {
  while (i < FILL_STEPS.length && FILL_STEPS[i].skip?.(f, r)) i++;
  if (i >= FILL_STEPS.length) { finishFill(); return; }
  const step = FILL_STEPS[i];
  state.fillStepId = step.id;
  const total = FILL_STEPS.filter((s) => !s.skip?.(f, r)).length;
  const no = FILL_STEPS.slice(0, i + 1).filter((s) => !s.skip?.(f, r)).length;
  const body = step.attach
    ? attachPanel()
    : el('div', { class: 'sheet-form', style: 'margin:0' }, ...step.fields(f, r).map(([key, label, type, ph]) => fieldInput(key, label, type, ph)));
  const next = el('button', { type: 'button', class: 'btn btn--navy' }, no === total ? '정리표 완성' : '다음');
  const skip = el('button', { type: 'button', class: 'btn btn--line' }, '건너뛰기');
  const go = () => { next.disabled = true; skip.disabled = true; runFill(f, r, i + 1); };
  next.addEventListener('click', go);
  skip.addEventListener('click', go);
  const card = el('div', { class: 'card fill' },
    el('div', { class: 'card__head' }, `정리표 채우기 ${no}/${total} · ${step.title(f, r)}`),
    el('div', { class: 'card__body' }, el('p', { class: 'disclaimer', style: 'margin-bottom:10px' }, step.note), body),
    el('div', { class: 'card__foot' }, next, skip));
  wide(card, { noScroll: first });
  state.fillCard = card;
  renderFollowChoices();
  if (!first) card.querySelector('input, button')?.focus({ preventScroll: true });
}

function finishFill() {
  const toSheet = el('button', { type: 'button', class: 'btn btn--line' }, '정리표 보러 가기');
  toSheet.addEventListener('click', () => {
    const preview = $('#sheetPreview');
    preview?.closest('details')?.setAttribute('open', '');
    preview?.closest('.result__sec')?.scrollIntoView({ block: 'start' });
  });
  const n = state.attachments.length;
  bubble('bot', el('span', {}, `정리표에 반영했어요. 결과의 「${n ? `정리표 + 캡처 ${n}개 내려받기` : '정리표 내려받기'}」를 누르면 ${n ? '정리표와 캡처 원본을 ZIP 파일 하나로' : '정리표를'} 받을 수 있어요.\n상담원 요약에도 함께 들어가요. `, toSheet));
  announce('정리표 채우기를 마쳤어요.');
  state.fillActive = false;
  state.fillCard = null;
  askClosing();
}

// ---------- 근거 법령 ----------
function lawSection(type) {
  const body = el('div', {}, el('p', { class: 'typing' }, '법령 정보를 불러오는 중…'));
  const details = el('details', {}, el('summary', {}, '근거 법령 보기 (현행 조문 · 시행일 · 변경이력)'), body);
  let loaded = false;
  details.addEventListener('toggle', async () => {
    if (!details.open || loaded) return;
    loaded = true;
    try {
      const r = await fetch(`/api/law?result=${type}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      renderLaw(body, await r.json());
    } catch (e) {
      body.replaceChildren(el('p', { class: 'disclaimer' }, `법령 정보를 불러오지 못했어요(${e.message}). 국가법령정보센터 law.go.kr 에서 확인하세요.`));
    }
  });
  return sec(null, details);
}

function liveTag(item) {
  return item.live
    ? el('span', { class: 'tag tag--live' }, '실시간')
    : el('span', { class: 'tag', title: item.detail || '' }, `시연 값 · 실시간 조회 안 됨(${REASON_WORD[item.reason] || item.reason})`);
}

function renderLaw(body, data) {
  const nodes = data.laws.map((l) => el('div', { class: 'law' },
    el('p', {}, el('span', { class: 'law__name' }, `「${l.name}」 ${l.article}`), liveTag(l)),
    el('p', { class: 'law__meta' }, `시행일: ${l.effective}`),
    el('p', { class: 'law__text' }, l.text || '(조문을 불러오지 못했어요)'),
    l.history?.length ? el('ul', { class: 'law__hist' }, ...l.history.map((h) => el('li', {}, `${h.effective} 시행 · ${h.kind || ''}${h.note ? ` (${h.note})` : ''}`))) : null,
    el('p', { class: 'law__meta' }, el('a', { href: l.link, target: '_blank', rel: 'noopener' }, '국가법령정보센터에서 원문 보기'))));
  if (data.notice) {
    const n = data.notice;
    const list = n.items.length
      ? el('ul', { class: 'law__hist' }, ...n.items.map((it) => el('li', {}, `${it.title}${it.org ? ` · ${it.org}` : ''}${it.start ? ` · ${it.start} ~ ${it.end}` : ''}`)))
      : el('p', { class: 'law__meta' }, n.live ? `'${n.keyword}' 관련 진행 중인 입법예고가 없어요.` : '입법예고를 확인하지 못했어요. 국민참여입법센터(opinion.lawmaking.go.kr)에서 확인하세요.');
    nodes.push(el('div', { class: 'law' }, el('p', {}, el('span', { class: 'law__name' }, '진행 중인 입법예고'), liveTag(n)), list));
  }
  if (data.billNote) nodes.push(el('div', { class: 'law' }, el('p', { class: 'law__name' }, '국회 발의 법안'), el('p', { class: 'law__meta' }, data.billNote)));
  body.replaceChildren(...nodes);
}

// ---------- 추가 질문 ----------
async function askQuestion(q) {
  const wait = bubble('bot', el('span', { class: 'typing' }, '안내 문서에서 찾고 있어요…'));
  let resp;
  try {
    resp = await postJson('/api/ask', { question: q });
  } catch (e) {
    resp = { live: false, tried: [{ provider: '서버', reason: `연결 안 됨(${e.message})` }], answer: '지금은 답을 찾지 못했어요. 온라인피해 365센터(☎142-235)로 문의해 주세요.', sources: [] };
  }
  wait.remove();
  const node = bubble('bot', resp.answer, metaLine(resp));
  if (resp.sources?.length) {
    node.append(el('div', { class: 'msg__sources' }, '근거 문서: ',
      ...resp.sources.flatMap((s, i) => [i ? ' · ' : '', s.url ? el('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.name) : s.name])));
  }
}

// ---------- 상담원 연결 ----------
function openHandoff() {
  $('#handoffText').textContent = buildHandoff(state.facts, state.result, sheetData());
  $('#handoff').showModal();
}
$('#handoffBtn').addEventListener('click', openHandoff);
const handoffCopy = $('#handoffCopy');
handoffCopy.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#handoffText').textContent); handoffCopy.textContent = '복사했어요'; } catch { handoffCopy.textContent = '직접 선택해 복사하세요'; }
  setTimeout(() => { handoffCopy.textContent = '요약 복사'; }, 2000);
});

// ---------- 입력칸 ----------
$('#composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (state.busy) return; // 정리 중 Enter 를 또 눌러도 다시 보내지 않는다
  if (!text) { inputEl.focus(); return; }
  inputEl.value = '';
  await onFreeText(text);
  inputEl.focus();
});
const countEl = $('#count');
const updateCount = () => { countEl.textContent = `${inputEl.value.length} / 1000자`; };
inputEl.addEventListener('input', updateCount);
$('#composer').addEventListener('submit', () => setTimeout(updateCount, 0));
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); }
});

start();
