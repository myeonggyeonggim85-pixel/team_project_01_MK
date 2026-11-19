// 길잡이 규칙 — 사실 항목(기획서 〈표 5〉), 분류 규칙표(〈표 7〉), 위기 단어, 증거 정리표 양식.
// AI 없이 코드로만 판단한다. 화면(public/app.js)과 서버(api/extract.js)가 함께 쓴다.

export const UNKNOWN = '모름';

// 〈표 5〉 생성형 AI가 채우는 사실 항목
export const FIELDS = {
  crisis: { label: '위기 표현', values: ['있음', '없음'] },
  situation: {
    label: '상황 구분',
    values: ['중고거래 피해', '판매자 피해', '착오송금', '보이스피싱 등 다른 피해', UNKNOWN],
    question: '어떤 일인지 먼저 골라 주세요.',
    // 자주 겪는 상황은 바로 고를 수 있게 했다. set 은 이 버튼 하나로 함께 정해지는 사실 항목(규칙표는 그대로)
    options: [
      { value: '중고거래 피해', text: '돈을 보냈는데 물건이 안 와요', set: { receipt: '못 받음' } },
      { value: '중고거래 피해', text: '받은 물건이 설명과 달라요 · 고장 났어요', set: { product: '실물', receipt: '설명과 상태가 다름' } },
      { value: '중고거래 피해', text: '쿠폰 · 상품권 · 티켓이 안 돼요', set: { product: '비실물(쿠폰·상품권·티켓)', receipt: '쿠폰·번호가 이미 사용됨·없음' } },
      { value: '중고거래 피해', text: '결제 링크로 보냈더니 돈을 더 보내래요', set: { lure: '가짜 안전결제 링크·추가 입금 요구' } },
      { value: '중고거래 피해', text: '그 밖의 거래 문제 (하나씩 답할게요)' },
      { value: '판매자 피해', text: '물건을 팔았는데 돈을 못 받았어요' },
      { value: '착오송금', text: '계좌번호 · 금액을 잘못 입력해 보냈어요' },
      { value: '보이스피싱 등 다른 피해', text: '링크로 앱을 깔았거나 인증번호를 알려 줬어요' },
    ],
  },
  product: {
    label: '상품 종류',
    values: ['실물', '비실물(쿠폰·상품권·티켓)', UNKNOWN],
    question: '무엇을 사셨나요?',
    options: [
      { value: '실물', text: '실물(물건)' },
      { value: '비실물(쿠폰·상품권·티켓)', text: '쿠폰·상품권·티켓' },
    ],
  },
  payment: {
    label: '송금 방법',
    values: ['계좌이체', '플랫폼 안전결제', '직거래 현장 결제', UNKNOWN],
    question: '돈은 어떻게 보내셨나요?',
    options: [
      { value: '계좌이체', text: '계좌이체' },
      { value: '플랫폼 안전결제', text: '플랫폼 안전결제' },
      { value: '직거래 현장 결제', text: '직거래 현장 결제' },
    ],
  },
  receipt: {
    label: '수령 상태',
    values: ['못 받음', '배송 중이라고 함', '설명과 상태가 다름', '전혀 다른 물건이 옴', '배송 중 파손', '쿠폰·번호가 이미 사용됨·없음', '가품 의심', UNKNOWN],
    question: '물건은 받으셨나요?',
    options: [
      { value: '못 받음', text: '못 받음' },
      { value: '배송 중이라고 함', text: '아직 배송 중이라고 함' },
      { value: '설명과 상태가 다름', text: '받았는데 설명과 다름' },
      { value: '전혀 다른 물건이 옴', text: '전혀 다른 물건이 옴' },
      { value: '배송 중 파손', text: '배송 중 파손됨' },
      { value: '쿠폰·번호가 이미 사용됨·없음', text: '쿠폰·번호가 이미 사용됨·없음' },
      { value: '가품 의심', text: '가품(짝퉁)으로 의심됨' },
    ],
  },
  contact: {
    label: '연락 상태',
    values: ['연락됨', '답 없음·차단', '판매 글·계정 사라짐', UNKNOWN],
    question: '지금 판매자와 연락이 되나요?',
    options: [
      { value: '연락됨', text: '연락됨' },
      { value: '답 없음·차단', text: '답이 없거나 차단됨' },
      { value: '판매 글·계정 사라짐', text: '판매 글·계정이 사라짐' },
    ],
  },
  fakePost: {
    label: '가짜 판매 글 정황',
    values: ['남의 사진이었음', '다른 피해 글을 봄', '없음', UNKNOWN],
  },
  // 수법 구분용으로 더한 항목(기획서 〈표 5〉 확장). 근거: 2023 온라인피해상담사례집 사례07, 금융감독원 보이스피싱 대처방법
  lure: {
    label: '결제 링크·추가 요구',
    values: ['가짜 안전결제 링크·추가 입금 요구', '링크로 앱 설치·인증번호 제공', '없음', UNKNOWN],
    question: '판매자가 링크를 보내거나 돈을 더 보내라고 했나요?',
    options: [
      { value: '가짜 안전결제 링크·추가 입금 요구', text: '결제 링크로 보냈더니 돈을 더 보내래요' },
      { value: '링크로 앱 설치·인증번호 제공', text: '링크로 앱을 깔았거나 인증번호를 알려 줬어요' },
      { value: '없음', text: '그런 일 없음' },
    ],
  },
};

// 되묻는 순서. 가짜 판매 글 정황은 되묻지 않는다(〈표 5〉).
// 결제 링크·추가 요구는 물건·연락 질문 뒤에 묻는다. 직거래 현장 결제면 묻지 않고, 거래 분쟁으로 정해지면 묻지 않는다
export const ASK_ORDER = ['situation', 'product', 'payment', 'receipt', 'contact', 'lure'];

export function emptyFacts() {
  const f = {};
  for (const k of Object.keys(FIELDS)) f[k] = k === 'crisis' ? '없음' : UNKNOWN;
  return f;
}

// 목록에 없는 값은 버리고 '모름'으로 둔다
export function sanitizeFacts(obj) {
  const out = emptyFacts();
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, def] of Object.entries(FIELDS)) {
    const v = typeof obj[k] === 'string' ? obj[k].trim() : '';
    if (def.values.includes(v)) out[k] = v;
  }
  return out;
}

// 위기 단어 목록 — 공백을 지운 문장에서 찾는다. 팀 검토 뒤 4단계에서 고친다
export const CRISIS_WORDS = [
  '죽고싶', '죽고만싶', '죽을래', '죽어버리', '죽어야', '자살', '극단적선택', '극단선택',
  '살기싫', '살고싶지않', '사라지고싶', '뛰어내리', '목숨을끊', '목숨끊', '자해', '손목을긋',
  '삶을끝', '생을마감', '유서', '세상을떠나고싶', '없어지고싶',
];

export function detectCrisis(text) {
  const t = String(text || '').replace(/\s+/g, '');
  return CRISIS_WORDS.some((w) => t.includes(w));
}

// 〈표 7〉 분류 규칙표 — 위에서부터 처음 맞는 줄
const ANY = null;
export const RULES = [
  { no: 1, receipt: '전혀 다른 물건이 옴', contact: ANY, fakePost: ANY, result: 'fraud', reason: '전혀 다른 물건이 옴' },
  { no: 2, receipt: ANY, contact: ANY, fakePost: '남의 사진이었음', result: 'fraud', reason: '판매 사진이 남의 사진이었음' },
  { no: 3, receipt: ANY, contact: ANY, fakePost: '다른 피해 글을 봄', result: 'fraud', reason: '같은 판매자의 다른 피해 글을 봄' },
  { no: 4, receipt: '못 받음', contact: '답 없음·차단', fakePost: ANY, result: 'fraud', reason: '물건을 못 받았고 판매자가 답이 없거나 차단함' },
  { no: 5, receipt: '못 받음', contact: '판매 글·계정 사라짐', fakePost: ANY, result: 'fraud', reason: '물건을 못 받았고 판매 글·계정이 사라짐' },
  { no: 6, receipt: '쿠폰·번호가 이미 사용됨·없음', contact: ANY, fakePost: ANY, result: 'fraud', reason: '받은 쿠폰·번호가 이미 사용됐거나 없음' },
  { no: 10, receipt: ANY, contact: ANY, fakePost: ANY, lure: '가짜 안전결제 링크·추가 입금 요구', result: 'fraud', reason: '안전결제 링크로 입금한 뒤 수수료 등 추가 입금을 요구받음', added: true },
  { no: 7, receipt: '설명과 상태가 다름', contact: '연락됨', fakePost: ANY, result: 'dispute', reason: '물건이 설명과 다르지만 판매자와 연락이 됨' },
  { no: 8, receipt: '배송 중 파손', contact: '연락됨', fakePost: ANY, result: 'dispute', reason: '배송 중 파손됐고 판매자와 연락이 됨' },
  { no: 9, receipt: '가품 의심', contact: ANY, fakePost: ANY, result: 'unclear', reason: '가품이 의심됨 — 판매자가 알고 팔았는지는 길잡이가 가릴 수 없음' },
];

function ruleMatch(rule, f) {
  return ['receipt', 'contact', 'fakePost', 'lure'].every((k) => rule[k] == null || rule[k] === f[k]);
}

export function matchRule(f) {
  return RULES.find((r) => ruleMatch(r, f)) || null;
}

// 〈수법표〉 — 사기 의심으로 분류된 뒤 위에서부터 처음 맞는 수법. 수법마다 기관 안내가 다르다
export const SCHEMES = [
  { id: 'fakepay', name: '가짜 안전결제 링크', when: (f) => f.lure === '가짜 안전결제 링크·추가 입금 요구', basis: '결제 링크로 입금한 뒤 추가 입금을 요구받음' },
  { id: 'coupon', name: '쿠폰·상품권 사기', when: (f) => f.receipt === '쿠폰·번호가 이미 사용됨·없음' || f.product === '비실물(쿠폰·상품권·티켓)', basis: '쿠폰·상품권·티켓 같은 비실물 거래' },
  { id: 'vanish', name: '물건 미발송·잠적', when: (f) => f.receipt === '못 받음' && ['답 없음·차단', '판매 글·계정 사라짐'].includes(f.contact), basis: '돈을 보낸 뒤 물건이 오지 않고 연락이 끊김' },
];
export const PHISHING_SCHEME = { id: 'phishing', name: '보이스피싱 연계', basis: '링크로 앱을 설치했거나 인증번호·비밀번호를 알려 줌' };

export function matchScheme(f) {
  return SCHEMES.find((s) => s.when(f)) || null;
}

const isPhishing = (f) => f.situation === '보이스피싱 등 다른 피해' || f.lure === '링크로 앱 설치·인증번호 제공';

// 결과: fraud(사기 의심) · dispute(거래 분쟁) · out(범위 밖) · unclear(판단 어려움). scheme 은 수법(있으면)
export function classify(f) {
  if (f.situation === '착오송금') return { type: 'out', sub: 'mistake', rule: null, scheme: null, reason: '계좌번호나 금액을 잘못 입력해 송금함(착오송금)' };
  // 판매자 피해는 규칙표(구매자 피해 기준) 밖이라 상담원과 확인하도록 안내한다
  if (f.situation === '판매자 피해') return { type: 'unclear', sub: 'seller', rule: null, scheme: null, reason: '물건을 판 쪽의 피해(판매자 피해)는 분류 기준표 밖이라 상담원과 함께 확인해야 함' };
  // 보이스피싱 연계는 규칙표보다 먼저 가린다(즉시 112·지급정지가 필요해서)
  if (isPhishing(f)) return { type: 'out', sub: 'phishing', rule: null, scheme: PHISHING_SCHEME, reason: PHISHING_SCHEME.basis };
  const r = matchRule(f);
  if (r) return { type: r.result, rule: r.no, reason: r.reason, scheme: r.result === 'fraud' ? matchScheme(f) : null };
  return { type: 'unclear', rule: null, scheme: null, reason: '규칙표의 어느 줄에도 분명히 들어가지 않음' };
}

// 다음에 되물을 항목. 이미 규칙이 맞거나 범위 밖이면 null
export function nextQuestion(f, asked) {
  if (f.situation === '착오송금' || f.situation === '판매자 피해' || isPhishing(f)) return null;
  const needLure = f.lure === UNKNOWN && !asked.has('lure') && f.payment !== '직거래 현장 결제';
  // 규칙이 맞으면 멈춘다. 단, 사기 의심이면 수법(가짜 결제 링크·보이스피싱 연계)을 가리려고 링크 질문 하나는 더 묻는다
  const check = () => {
    if (f.situation === UNKNOWN) return null;
    const r = matchRule(f);
    if (!r) return null;
    if (!(r.result === 'fraud' && needLure)) return 'stop';
    // 링크 질문은 송금 방법을 알아야 의미가 있다(직거래면 묻지 않음) — 송금 방법부터 묻는다
    return f.payment === UNKNOWN && !asked.has('payment') ? 'payment' : 'lure';
  };
  let c = check();
  if (c) return c === 'stop' ? null : c;
  for (const k of ASK_ORDER) {
    if (k === 'lure' && !needLure) continue;
    if (f[k] === UNKNOWN && !asked.has(k)) return k;
    c = check();
    if (c) return c === 'stop' ? null : c;
  }
  return null;
}

export const RESULT_LABEL = {
  fraud: '사기 의심',
  dispute: '거래 분쟁',
  out: '범위 밖',
  unclear: '판단 어려움',
};

// AI 를 하나도 못 쓸 때 쓰는 낱말 기반 정리(시연 값)
const KW = {
  mistake: ['잘못입력', '계좌번호를잘못', '금액을잘못', '착오송금', '착오'],
  mistakeVague: ['잘못보낸', '잘못보냈', '잘못송금'],
  phishing: ['인증번호', '비밀번호를알려', '비번알려', '앱설치', '링크를눌', '링크눌', '검찰', '금감원', '대출'],
  trade: ['중고', '당근', '번개장터', '중고나라', '판매자', '입금', '송금', '사기', '택배', '물건', '거래', '샀', '구매', '보냈'],
  transfer: ['입금', '이체', '계좌', '송금', '보냈', '보냄'],
  safePay: ['안전결제', '번개페이', '당근페이', '안전거래'],
  direct: ['직거래', '만나서', '현장결제'],
  notRecv: ['안옴', '안와', '안오', '못받', '안보내', '오지않', '안왔', '못받았'],
  shipping: ['배송중', '보냈다고', '발송했다'],
  otherItem: ['다른물건', '벽돌', '엉뚱한'],
  broken: ['파손', '깨져', '부서', '박살'],
  usedCoupon: ['이미사용', '사용된', '사용완료', '번호가없', '조회가안'],
  fake: ['가품', '짝퉁', '정품아닌', '가짜상품', '이미테이션'],
  differ: ['설명과다', '하자', '고장', '상태가', '사진과다', '얘기와다'],
  blocked: ['차단', '답이없', '답없', '연락안', '연락이안', '잠수', '읽씹', '연락두절', '답장이없'],
  gone: ['글삭제', '글이지워', '글도지워', '글지워', '탈퇴', '계정이사라', '계정삭제', '글도사라', '글이사라'],
  contactOk: ['연락은되', '연락이되', '답장은', '환불해준다', '환불하겠'],
  otherPhoto: ['남의사진', '도용', '퍼온사진'],
  otherVictim: ['다른피해', '피해글', '더치트', '피해자가또'],
  seller: ['팔았는데', '판매했는데', '보내줬는데돈', '보냈는데입금이안', '구매자가돈', '구매자가입금'],
  fakePayLink: ['안전결제링크', '결제링크', '페이링크', '수수료', '추가입금', '다시입금', '재입금', '한번더입금'],
  appInstall: ['앱설치', '앱을설치', '원격', '인증번호를알려', '인증번호알려', '인증번호보내', '비밀번호를알려'],
  nonPhysical: ['기프티콘', '쿠폰', '상품권', '티켓', '교환권', '바코드'],
  physical: ['이어폰', '폰', '노트북', '옷', '가방', '신발', '카메라', '책', '시계', '태블릿', '물건'],
};
const has = (t, list) => list.some((w) => t.includes(w));

export function guessFacts(text) {
  const t = String(text || '').replace(/\s+/g, '');
  const f = emptyFacts();
  f.crisis = detectCrisis(text) ? '있음' : '없음';
  if (has(t, KW.transfer)) f.payment = '계좌이체';
  if (has(t, KW.safePay)) f.payment = '플랫폼 안전결제';
  if (has(t, KW.direct)) f.payment = '직거래 현장 결제';
  if (has(t, KW.notRecv)) f.receipt = '못 받음';
  else if (has(t, KW.shipping)) f.receipt = '배송 중이라고 함';
  if (has(t, KW.differ)) f.receipt = '설명과 상태가 다름';
  if (has(t, KW.broken)) f.receipt = '배송 중 파손';
  if (has(t, KW.otherItem)) f.receipt = '전혀 다른 물건이 옴';
  if (has(t, KW.fake)) f.receipt = '가품 의심';
  if (has(t, KW.usedCoupon)) f.receipt = '쿠폰·번호가 이미 사용됨·없음';
  if (has(t, KW.contactOk)) f.contact = '연락됨';
  if (has(t, KW.blocked)) f.contact = '답 없음·차단';
  if (has(t, KW.gone)) f.contact = '판매 글·계정 사라짐';
  if (has(t, KW.otherPhoto)) f.fakePost = '남의 사진이었음';
  else if (has(t, KW.otherVictim)) f.fakePost = '다른 피해 글을 봄';
  if (has(t, KW.fakePayLink)) f.lure = '가짜 안전결제 링크·추가 입금 요구';
  if (has(t, KW.appInstall)) f.lure = '링크로 앱 설치·인증번호 제공';
  if (has(t, KW.nonPhysical)) f.product = '비실물(쿠폰·상품권·티켓)';
  else if (has(t, KW.physical)) f.product = '실물';
  if (has(t, KW.seller)) f.situation = '판매자 피해';
  else if (has(t, KW.mistake)) f.situation = '착오송금';
  else if (has(t, KW.phishing)) f.situation = '보이스피싱 등 다른 피해';
  else if (has(t, KW.mistakeVague)) f.situation = UNKNOWN; // 착오송금인지 거래 문제인지 되묻는다
  else if (has(t, KW.trade) || f.receipt !== UNKNOWN || f.contact !== UNKNOWN) f.situation = '중고거래 피해';
  return f;
}

// 문의처(답변참고문서 문의처 마스터 조각 값)
export const CONTACTS = {
  center365: { name: '온라인피해 365센터', tel: '142-235', url: 'https://www.helpos.kr' },
  ecrm: { name: '경찰청 사이버범죄 신고시스템(ECRM)', url: 'https://ecrm.police.go.kr', tels: [['182', '민원상담'], ['112', '긴급할 때']] },
  ecmc: { name: '전자문서·전자거래분쟁조정위원회', tel: '118', url: 'https://usr.ecmc.or.kr' },
  klac: { name: '대한법률구조공단', tel: '132', url: 'https://www.klac.or.kr' },
  kdic: { name: '예금보험공사 착오송금 반환지원', tel: '1588-0037', url: 'https://kdic.or.kr' },
  crisis: { name: '자살예방 상담전화', tel: '109' },
};

// ===== 증거 정리표 (기획서 Ⅵ-3 양식, 6칸·순서 고정) =====
const LINE = '==================================================';
const DASH = '--------------------------------------------------';

const CHECKLIST = {
  fraud: ['판매자와의 대화 내역 전체 캡처 (날짜·시간이 보이게)', '판매 글 캡처와 글 주소 (지워지기 전)', '상대방 프로필 화면 (닉네임·ID)', '입금확인서(이체 확인증)'],
  fraudCoupon: ['발행처에서 확인한 쿠폰·상품권 사용 내역'],
  fakepay: ['받은 결제 링크 주소와 결제 화면 캡처', '추가 입금(수수료)을 요구한 메시지 캡처'],
  vanish: ['더치트·사이버캅에서 판매자 계좌·전화번호를 조회한 결과 화면'],
  phishing: ['받은 문자·링크 화면 캡처', '송금 내역(이체 확인증)'],
  dispute: ['판매 글의 상품 설명 캡처', '받은 물건 사진 (설명과 다른 부분·파손 부분)', '판매자와의 대화 내역 전체 캡처 (날짜·시간이 보이게)', '판매자에게 환불·교환을 요청한 기록', '입금확인서(이체 확인증)'],
  other: ['판매자와의 대화 내역 전체 캡처 (날짜·시간이 보이게)', '판매 글 캡처와 글 주소', '상대방 프로필 화면 (닉네임·ID)', '입금확인서(이체 확인증)'],
  seller: ['구매자와의 대화 내역 전체 캡처 (날짜·시간이 보이게)', '내가 올린 판매 글 캡처와 글 주소', '상대방 프로필 화면 (닉네임·ID)', '물건을 보낸 운송장·발송 기록'],
};

// 올린 캡처의 종류 — 정리표 체크리스트에 [x] 로 표시하고, ZIP 안 파일 이름에 쓴다
export const ATTACH_TYPES = [
  { id: 'chat', label: '대화 내역', file: '대화내역', match: ['대화 내역'] },
  { id: 'post', label: '판매 글', file: '판매글', match: ['판매 글'] },
  { id: 'profile', label: '상대방 프로필', file: '상대프로필', match: ['프로필'] },
  { id: 'pay', label: '입금 · 결제 확인증', file: '입금확인증', match: ['입금확인서', '결제 내역', '송금 내역', '이체 확인증'] },
  { id: 'item', label: '받은 물건 사진', file: '받은물건', match: ['받은 물건 사진', '만난 날짜'] },
  { id: 'link', label: '결제 링크 · 문자 화면', file: '링크문자', match: ['결제 링크', '추가 입금', '문자·링크'] },
  { id: 'etc', label: '그 밖의 자료', file: '기타', match: [] },
];

const AGENCIES = {
  fraud: ['이체한 은행 : 지급정지 문의 (은행마다 판단이 다름)', '경찰청 사이버범죄 신고시스템 ecrm.police.go.kr 또는 경찰서', '도움이 더 필요하면 온라인피해 365센터 ☎142-235'],
  fakepay: ['경찰청 사이버범죄 신고시스템 ecrm.police.go.kr 에 온라인 신고 후 경찰서 방문', '이체한 은행 : 지급정지 문의 (은행마다 판단이 다름)', '거래 플랫폼 고객센터 : 판매자 신고', '도움이 더 필요하면 온라인피해 365센터 ☎142-235'],
  coupon: ['쿠폰·상품권 발행처 : 사용 내역 확인', '경찰청 사이버범죄 신고시스템 ecrm.police.go.kr 또는 경찰서', '도움이 더 필요하면 온라인피해 365센터 ☎142-235'],
  vanish: ['이체한 은행 : 지급정지 문의 (은행마다 판단이 다름)', '경찰청 사이버범죄 신고시스템 ecrm.police.go.kr 에 온라인 신고 후 경찰서 방문', '피해금 회수 상담이 필요하면 대한법률구조공단 ☎132'],
  dispute: ['거래 플랫폼 고객센터 : 1차 조정 요청', '전자문서·전자거래분쟁조정위원회 usr.ecmc.or.kr (☎118) : 2차 조정 신청', '돈을 돌려받는 것이 목적이면 대한법률구조공단 ☎132 (지급명령 상담)'],
  unclear: ['온라인피해 365센터 ☎142-235 : 상담원 상담', '사기 정황이 확인되면 경찰청 사이버범죄 신고시스템 ecrm.police.go.kr'],
  mistake: ['송금한 은행 : 착오송금 반환 요청', '반환되지 않으면 예금보험공사 착오송금 반환지원 ☎1588-0037'],
  phishing: ['즉시 112 신고', '송금한 은행 : 지급정지 요청'],
  seller: ['온라인피해 365센터 ☎142-235 : 상담원 상담', '사기 정황이 확인되면 경찰청 사이버범죄 신고시스템 ecrm.police.go.kr'],
};

// 송금 방법에 맞게 은행 안내를 바꾼다
// - 직거래 현장 결제: 이체가 없으므로 은행 지급정지 · 이체 확인증을 빼고 현장 기록을 넣는다
// - 플랫폼 안전결제: 대금이 플랫폼에 맡겨져 있으므로(결제대금 예치) 플랫폼 결제 취소 · 환불 요청을 먼저 둔다.
//   단, 가짜 안전결제 링크는 실제로는 가짜 계좌로 이체한 것이라 은행 안내를 그대로 둔다
export const PAYMENT_NOTE = {
  directBank: '이체한 은행',
  safePayFirst: '거래 플랫폼 고객센터 : 결제 취소·환불 요청 (안전결제 대금은 플랫폼에 맡겨져 있음)',
  directProof: '만난 날짜·시간·장소 기록과 받은 물건 사진',
  safePayProof: '플랫폼 결제 내역 화면',
};
export function isDirectPay(f) { return f.payment === '직거래 현장 결제'; }
export function isRealSafePay(f, r) { return f.payment === '플랫폼 안전결제' && r?.scheme?.id !== 'fakepay'; }

function byPayment(f, r, checklist, agencies) {
  const isBankLine = (a) => a.includes(PAYMENT_NOTE.directBank);
  const isTransferProof = (c) => c.startsWith('입금확인서');
  if (isDirectPay(f)) {
    return {
      checklist: checklist.map((c) => (isTransferProof(c) ? PAYMENT_NOTE.directProof : c)),
      agencies: agencies.filter((a) => !isBankLine(a)),
    };
  }
  if (isRealSafePay(f, r) && r.type !== 'dispute') {
    return {
      checklist: checklist.map((c) => (isTransferProof(c) ? PAYMENT_NOTE.safePayProof : c)),
      agencies: [PAYMENT_NOTE.safePayFirst, ...agencies.filter((a) => !isBankLine(a))],
    };
  }
  return { checklist, agencies };
}

const v = (s) => (s && String(s).trim() ? String(s).trim() : UNKNOWN);
const digits = (s) => String(s || '').replace(/[^\d]/g, '');
const money = (s) => (digits(s) ? `${Number(digits(s)).toLocaleString('ko-KR')}원` : '');

// 챗봇에서 물은 거래·송금 날짜와 시간 → 타임라인 첫 줄 (예: 2026-10-02 14:10 150,000원 계좌이체로 보냄)
function paidLine(f, input, seller) {
  if (!input.paidDate && !input.paidTime) return [];
  const when = [input.paidDate || '날짜 모름', input.paidTime].filter(Boolean).join(' ');
  if (seller) return [`- ${when} 거래(물건 발송)${money(input.amount) ? ` · 받기로 한 금액 ${money(input.amount)}` : ''}`];
  const how = f.payment !== UNKNOWN ? f.payment : '송금';
  return [`- ${when} ${money(input.amount) ? `${money(input.amount)} ` : ''}${how}${f.payment === '직거래 현장 결제' ? '로 거래' : '로 보냄'}`];
}
const pad = (n) => String(n).padStart(2, '0');
export function formatNow(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function buildSheet(facts, result, input = {}, now = new Date()) {
  const label = RESULT_LABEL[result.type] + (result.scheme ? ` · ${result.scheme.name} 수법으로 보임` : '');
  const head = result.rule ? `${label} (규칙 ${result.rule}: ${result.reason})` : `${label} (${result.reason})`;
  const sid = result.scheme?.id;
  const key = AGENCIES[sid] ? sid : (result.sub || result.type);
  let checklist = CHECKLIST[result.sub === 'seller' ? 'seller' : result.type] || CHECKLIST.other;
  if (result.type === 'fraud' && facts.product === '비실물(쿠폰·상품권·티켓)') checklist = [...checklist, ...CHECKLIST.fraudCoupon];
  if (CHECKLIST[sid] && sid !== 'phishing') checklist = [...checklist, ...CHECKLIST[sid]];
  if (sid === 'phishing') checklist = CHECKLIST.phishing;
  let agencies = AGENCIES[key] || AGENCIES.unclear;
  ({ checklist, agencies } = byPayment(facts, result, checklist, agencies));
  const seller = result.sub === 'seller';
  const timeline = [
    ...paidLine(facts, input, seller),
    ...(input.timeline || []).filter((t) => t && (t.when || t.what)).map((t) => `- ${v(t.when)} ${v(t.what)}`),
  ];
  const amount = money(input.amount) || UNKNOWN;
  const payWay = facts.payment !== UNKNOWN ? facts.payment : '송금 방법 모름';
  const count = digits(input.count) ? ` ${digits(input.count)}회` : '';
  const account = [input.bank, input.account].filter((x) => x && String(x).trim()).join(' ');
  // 올린 캡처: 체크리스트에 [x], 아래에 파일 목록
  const files = input.attachments || [];
  const attached = (c) => files.some((a) => (ATTACH_TYPES.find((t) => t.id === a.type)?.match || []).some((m) => c.includes(m)));
  const fileLines = files.length
    ? [`  첨부 파일 ${files.length}개 (함께 내려받은 원본)`, ...files.map((a) => `  - ${a.zipName} : ${ATTACH_TYPES.find((t) => t.id === a.type)?.label || '자료'}`)]
    : [];

  const lines = [
    LINE,
    '[온라인피해365센터] 중고거래 피해 제출용 증거 정리표',
    LINE,
    `작성일시 : ${formatNow(now)} (중고거래 피해 대응 길잡이)`,
    `1. 진단 결과 : ${head}`,
    '2. 사건 타임라인',
    ...(timeline.length ? timeline : [`- ${UNKNOWN}`]),
    `3. ${seller ? '받지 못한 금액' : '피해 금액'} : ${amount} (${seller ? '판매 대금' : `${payWay}${count}`})${input.item && String(input.item).trim() ? ` — 물건: ${String(input.item).trim()}` : ''}`,
    '4. 상대방 정보',
    `- 거래 앱 / 닉네임 / 프로필 ID : ${v(input.app)} / ${v(input.nickname)} / ${v(input.profileId)}`,
    ...(seller ? [] : [`- 입금 계좌 : ${v(account)} (예금주 ${v(input.holder)})`]),
    `- 연락처 : ${v(input.phone)}`,
    `- 판매 글 주소 : ${v(input.postUrl)}`,
    '5. 필수 첨부 증거 체크리스트',
    ...checklist.map((c) => `[${attached(c) ? 'x' : ' '}] ${c}`),
    ...fileLines,
    '6. 우선 제출 기관 (순서)',
    ...agencies.map((a, i) => `${'①②③④⑤'[i]} ${a}`),
    DASH,
    '※ 위 내용은 피해자가 확인·수정한 것입니다. 원본 캡처 파일을 함께 내세요.',
    '※ 본 정리표는 안내용이며 법적 효력을 갖지 않습니다.',
    LINE,
  ];
  return lines.join('\n');
}

// 상담원에게 넘길 요약 — 정리표에 입력한 내용도 함께 넘겨 같은 질문을 반복하지 않게 한다
export function buildHandoff(facts, result, input = {}) {
  const rows = Object.entries(FIELDS).map(([k, d]) => `- ${d.label} : ${facts[k]}`);
  const r = result ? `${RESULT_LABEL[result.type]}${result.scheme ? ` · ${result.scheme.name} 수법으로 보임` : ''}${result.rule ? ` (규칙 ${result.rule})` : ''} — ${result.reason}` : '아직 분류 전';
  const head = facts.crisis === '있음' ? ['※ 위기 표현 있음 — 109 자살예방 상담전화를 안내함'] : [];
  const filled = (s) => s && String(s).trim();
  const timeline = [
    ...paidLine(facts, input, result?.sub === 'seller'),
    ...(input.timeline || []).filter((t) => filled(t.when) || filled(t.what)).map((t) => `- ${v(t.when)} ${v(t.what)}`),
  ];
  const files = input.attachments || [];
  const extra = [
    filled(input.amount) && `- 금액 : ${money(input.amount)}${digits(input.count) ? ` (${digits(input.count)}회)` : ''}`,
    filled(input.item) && `- 물건 : ${input.item}`,
    (filled(input.app) || filled(input.nickname) || filled(input.profileId)) && `- 거래 앱 / 닉네임 / 프로필 ID : ${v(input.app)} / ${v(input.nickname)} / ${v(input.profileId)}`,
    (filled(input.bank) || filled(input.account)) && `- 입금 계좌 : ${v([input.bank, input.account].filter(filled).join(' '))} (예금주 ${v(input.holder)})`,
    filled(input.phone) && `- 연락처 : ${input.phone}`,
    filled(input.postUrl) && `- 판매 글 주소 : ${input.postUrl}`,
    files.length && `- 준비한 캡처 ${files.length}개 : ${files.map((a) => a.zipName).join(', ')}`,
  ].filter(Boolean);
  const sheet = timeline.length || extra.length ? ['정리표에 입력한 내용', ...(timeline.length ? ['- 타임라인', ...timeline.map((t) => `  ${t}`)] : []), ...extra] : [];
  return ['[길잡이 정리 요약]', ...head, `작성일시 : ${formatNow()}`, `진단 결과 : ${r}`, '사실 항목', ...rows, ...sheet].join('\n');
}
