// 디비알림봇 명령어 처리
// - 보고 방: /광고(기간·일별 가능), /상담(대출), /상담가전, /정산 (하루 또는 기간), /잔액, /메뉴 (+ 버튼)
// - 디비 (여성대출) 방: /삭제, /보고 (기간 가능)
// - 디비 (가전공구) 방: /삭제, /보고 (기간 가능), /상담 (+ 날짜)
// - DB (현금화) 방: /삭제, /보고 (기간 가능)
const LEAD_CHAT = "-5318830146";   // 디비 (여성대출) 방
const REPORT_CHAT = "-5391256412"; // 보고 방
const GAJEON_CHAT = "-5235472796"; // 디비 (가전공구) 방
const CASH_CHAT = "-5498536819";   // DB (현금화) 방

// 계정 C 광고비 기준일: 이 날짜부터는 현금화, 전날까지는 여성대출로 계산
const CASH_START = "2026-11-21";

// 일별 보고 최대 일수
const MAX_DAILY_DAYS = 62;

// 버튼 방식
// "both"     = 입력창 아래 버튼(A) + 고정 메시지 버튼(B)
// "pinned"   = 고정 메시지 버튼(B)만
// "keyboard" = 입력창 아래 버튼(A)만
const BUTTON_MODE = "both";

const BTN_ADS = "📊 광고";
const BTN_CONSULT = "💬 상담(대출)";
const BTN_CONSULT_G = "🛒 상담(가전)";
const BTN_SETTLE = "🧾 정산";
const BTN_CARD = "💳 잔액";

// 여성대출 광고계정 중 처음부터 여성대출인 계정 (환경변수가 없는 계정은 건너뜀)
const LOAN_ACCOUNTS = [
  { label: "계정A", id: process.env.META_ACCOUNT_A, token: process.env.META_TOKEN_A },
  { label: "계정B", id: process.env.META_ACCOUNT_B, token: process.env.META_TOKEN_B },
];

// 계정 C: CASH_START 전날까지는 여성대출, 그 날부터는 현금화
const ACCOUNT_C = { label: "계정C", id: process.env.META_ACCOUNT_C, token: process.env.META_TOKEN_C };

// 가전공구 광고계정 (계정 A와 같은 비즈니스 관리자 → A 토큰 사용)
const GAJEON_ACCOUNTS = [
  { label: "최저가공구", id: process.env.META_ACCOUNT_GAJEON, token: process.env.META_TOKEN_A },
];

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const BOT = process.env.TELEGRAM_BOT_TOKEN;

const sbHeaders = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

const useKeyboard = BUTTON_MODE === "keyboard" || BUTTON_MODE === "both";
const usePinned = BUTTON_MODE === "pinned" || BUTTON_MODE === "both";

// A: 입력창 아래 버튼
const REPLY_KEYBOARD = {
  keyboard: [
    [{ text: BTN_ADS }, { text: BTN_SETTLE }, { text: BTN_CARD }],
    [{ text: BTN_CONSULT }, { text: BTN_CONSULT_G }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

// B: 메시지에 붙는 버튼
const INLINE_MENU = {
  inline_keyboard: [
    [
      { text: BTN_ADS, callback_data: "ads" },
      { text: BTN_SETTLE, callback_data: "settle" },
      { text: BTN_CARD, callback_data: "card" },
    ],
    [
      { text: BTN_CONSULT, callback_data: "consult" },
      { text: BTN_CONSULT_G, callback_data: "consult_g" },
    ],
  ],
};

// 텔레그램 API 호출
async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// 굵게 표시(HTML)용: 시트에 입력한 글자 안전하게 바꾸기
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ===== 날짜 =====

function kstNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function ymd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function kstToday() {
  return ymd(kstNow());
}

function addDays(date, n) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}

function nextDay(date) {
  return addDays(date, 1);
}

// 두 날짜(YYYY-MM-DD) 사이 일수 (b - a)
function daysBetween(a, b) {
  return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);
}

function shortLabel(date) {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function kstTimeLabel() {
  const now = kstNow();
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// 날짜 하나 읽기. 없으면 오늘, 형식이 틀리면 null
function parseDateArg(arg) {
  const s = (arg || "").trim();
  if (!s || s === "오늘") return kstToday();
  if (s === "어제") return addDays(kstToday(), -1);

  let m = s.match(/^(\d{4})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;

  m = s.match(/^(\d{1,2})\s*[\/.\-]\s*(\d{1,2})$/);
  if (m) {
    const y = kstNow().getUTCFullYear();
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

// 기간 읽기 (광고·정산 보고용). 형식이 틀리면 null
function parseRangeArg(arg) {
  const s = (arg || "").trim().replace(/\s+/g, "");
  const today = kstToday();

  if (s === "이번달") return { from: today.slice(0, 8) + "01", to: today };

  let m = s.match(/^(\d{1,3})일$/);
  if (m) {
    const n = Number(m[1]);
    if (n < 1) return null;
    return { from: addDays(today, -(n - 1)), to: today };
  }

  if (s.includes("~")) {
    const [a, b] = s.split("~");
    const from = parseDateArg(a);
    const to = parseDateArg(b);
    if (!from || !to) return null;
    return from <= to ? { from, to } : { from: to, to: from };
  }

  const d = parseDateArg(s);
  return d ? { from: d, to: d } : null;
}

function titleSuffix(date) {
  return date === kstToday()
    ? `오늘 ${shortLabel(date)} ${kstTimeLabel()} 기준`
    : shortLabel(date);
}

function rangeSuffix(from, to) {
  if (from === to) return titleSuffix(from);
  const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  let t = `${shortLabel(from)}~${shortLabel(to)}, ${days}일`;
  if (to === kstToday()) t += ` · ${kstTimeLabel()} 기준`;
  return t;
}

// ===== 금액 표시 =====

function won(n) {
  const man = (n / 10000).toFixed(1).replace(/\.0$/, "");
  return `${man}만원 (${Math.round(n).toLocaleString("ko-KR")}원)`;
}

function man(n) {
  return `${Math.round(n).toLocaleString("ko-KR")}만원`;
}

// 광고비 짧게 (소수 1자리 만원)
function manShort(n) {
  return `${(n / 10000).toFixed(1).replace(/\.0$/, "")}만원`;
}

function trText(vnd) {
  return (vnd / 1000000).toFixed(1).replace(/\.0$/, "") + "tr";
}

function vndText(vnd) {
  return Math.round(vnd).toLocaleString("en-US") + " VND";
}

// ===== 데이터 조회 =====

async function getSpend(accountId, token, from, to) {
  const today = kstToday();
  const range =
    from === today && to === today
      ? "date_preset=today"
      : `time_range=${encodeURIComponent(JSON.stringify({ since: from, until: to }))}`;
  const url =
    `https://graph.facebook.com/v27.0/act_${accountId}/insights` +
    `?fields=spend&${range}&access_token=${token}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data && json.data[0] ? Number(json.data[0].spend) : 0;
}

// 날짜별 광고비 { "YYYY-MM-DD": 금액 }
async function getDailySpend(accountId, token, from, to) {
  const url =
    `https://graph.facebook.com/v27.0/act_${accountId}/insights` +
    `?fields=spend&time_increment=1&limit=500` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since: from, until: to }))}` +
    `&access_token=${token}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  const map = {};
  (json.data || []).forEach((r) => {
    map[r.date_start] = (map[r.date_start] || 0) + Number(r.spend || 0);
  });
  return map;
}

function leadRangeFilter(from, to) {
  const start = encodeURIComponent(`${from}T00:00:00+09:00`);
  const end = encodeURIComponent(`${nextDay(to)}T00:00:00+09:00`);
  return `deleted=eq.false&created_at=gte.${start}&created_at=lt.${end}`;
}

async function getLeadCount(from, to, table) {
  const url = `${SB_URL}/rest/v1/${table}?select=id&${leadRangeFilter(from, to)}`;
  const res = await fetch(url, {
    headers: { ...sbHeaders, Prefer: "count=exact", Range: "0-0" },
  });
  const range = res.headers.get("content-range") || "";
  return Number(range.split("/")[1] || 0);
}

// 날짜별 디비 개수 { "YYYY-MM-DD": 개수 } (한국시간 기준)
async function getLeadDays(table, from, to) {
  const map = {};
  let offset = 0;
  while (true) {
    const url = `${SB_URL}/rest/v1/${table}?select=created_at&${leadRangeFilter(from, to)}&order=id.asc`;
    const res = await fetch(url, {
      headers: { ...sbHeaders, Range: `${offset}-${offset + 999}` },
    });
    if (!res.ok) throw new Error("Supabase " + res.status);
    const rows = await res.json();
    rows.forEach((r) => {
      const d = ymd(new Date(new Date(r.created_at).getTime() + 9 * 60 * 60 * 1000));
      map[d] = (map[d] || 0) + 1;
    });
    if (rows.length < 1000) break;
    offset += 1000;
  }
  return map;
}

async function getLeads(date, table) {
  const url =
    `${SB_URL}/rest/v1/${table}` +
    `?select=kakao,kakao_reply,call_status,result&${leadRangeFilter(date, date)}`;
  const res = await fetch(url, { headers: sbHeaders });
  if (!res.ok) throw new Error("Supabase " + res.status);
  return res.json();
}

// 정산 시트 조회:
// rows = 기간 안의 수입·지출
// expected = 예상,미결제 탭에서 처리 "완료"가 아닌 줄 전체 (type: "예상" 또는 "미결제")
async function getSettle(from, to) {
  const url =
    `${process.env.SETTLE_URL}?key=${encodeURIComponent(process.env.SETTLE_KEY)}` +
    `&from=${from}&to=${to}`;
  const res = await fetch(url, { redirect: "follow" });
  const json = await res.json();
  if (json.error) throw new Error("정산 시트: " + json.error);
  return { rows: json.rows || [], expected: json.expected || [] };
}

async function getManPerTr() {
  const res = await fetch("https://open.er-api.com/v6/latest/VND");
  const json = await res.json();
  const krwPerVnd = json && json.rates && json.rates.KRW;
  if (!krwPerVnd) throw new Error("환율 조회 실패");
  return (krwPerVnd * 1000000) / 10000;
}

async function getCard() {
  const url = `${process.env.CARD_URL}?key=${encodeURIComponent(process.env.CARD_KEY)}`;
  const res = await fetch(url, { redirect: "follow" });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

async function reply(chatId, text, replyTo, withKeyboard, html) {
  const body = { chat_id: chatId, text };
  if (html) body.parse_mode = "HTML";
  if (replyTo && chatId !== REPORT_CHAT) body.reply_to_message_id = replyTo;
  if (withKeyboard && chatId === REPORT_CHAT && useKeyboard) {
    body.reply_markup = REPLY_KEYBOARD;
  }
  return tg("sendMessage", body);
}

// 긴 글은 줄 단위로 나눠서 여러 번 보내기 (텔레그램 글자 제한)
async function replyLong(chatId, text, replyTo) {
  const LIMIT = 3800;
  const chunks = [];
  let cur = "";
  text.split("\n").forEach((line) => {
    if ((cur + "\n" + line).length > LIMIT && cur) {
      chunks.push(cur);
      cur = line;
    } else {
      cur = cur ? cur + "\n" + line : line;
    }
  });
  if (cur) chunks.push(cur);

  for (let i = 0; i < chunks.length; i++) {
    await reply(chatId, chunks[i], i === 0 ? replyTo : null);
  }
}

// ===== 보고 =====

// 광고계정들의 기간 광고비 합계 (from이 to보다 늦으면 0)
async function sumSpend(accounts, from, to) {
  const errors = [];
  let spend = 0;
  if (from > to) return { spend, errors };

  const results = await Promise.all(
    accounts.filter((a) => a.id && a.token).map(async (a) => {
      try {
        return { a, spend: await getSpend(a.id, a.token, from, to) };
      } catch (e) {
        return { a, error: e.message };
      }
    })
  );

  results.forEach((r) => {
    if (r.error) errors.push(`${r.a.label} 조회 실패: ${r.error}`);
    else spend += r.spend;
  });

  return { spend, errors };
}

// 가전공구용
async function calcAds(from, to, accounts, table) {
  const { spend, errors } = await sumSpend(accounts, from, to);
  const count = table ? await getLeadCount(from, to, table) : 0;
  return { spend, count, errors };
}

// 여성대출: 계정 A·B 전체 기간 + 계정 C는 CASH_START 전날까지만
async function calcLoan(from, to) {
  const lastLoanDay = addDays(CASH_START, -1);
  const cTo = to < lastLoanDay ? to : lastLoanDay;

  const [fixed, cOld, count] = await Promise.all([
    sumSpend(LOAN_ACCOUNTS, from, to),
    sumSpend([ACCOUNT_C], from, cTo),
    getLeadCount(from, to, "report_leads"),
  ]);

  return {
    spend: fixed.spend + cOld.spend,
    count,
    errors: [...fixed.errors, ...cOld.errors],
  };
}

// 현금화: 계정 C의 CASH_START 이후 광고비
async function calcCash(from, to) {
  const cFrom = from > CASH_START ? from : CASH_START;

  const [c, count] = await Promise.all([
    sumSpend([ACCOUNT_C], cFrom, to),
    getLeadCount(from, to, "cash_leads"),
  ]);

  return { spend: c.spend, count, errors: c.errors };
}

function adsLines(r) {
  const cpl = r.count > 0 ? won(r.spend / r.count) : "-";
  return (
    `총 지출 광고비 : ${won(r.spend)}\n` +
    `총 유입 디비개수 : ${r.count}개\n` +
    `디비 개당 단가 : ${cpl}`
  );
}

async function cardBlock() {
  try {
    const card = await getCard();
    return `${trText(card.limit)} (${vndText(card.limit)})`;
  } catch (e) {
    return `⚠️ 카드 한도 조회 실패: ${e.message}`;
  }
}

async function handleAds(chatId, msgId, from, to) {
  const r = await calcLoan(from, to);
  let text = `📊 광고 보고 (${rangeSuffix(from, to)})\n\n${adsLines(r)}`;
  if (r.errors.length) text += `\n\n⚠️ ${r.errors.join("\n⚠️ ")}`;
  await reply(chatId, text, msgId);
}

async function handleGajeonAds(chatId, msgId, from, to) {
  const r = await calcAds(from, to, GAJEON_ACCOUNTS, "gajeon_leads");
  let text = `📊 가전공구 광고 보고 (${rangeSuffix(from, to)})\n\n${adsLines(r)}`;
  if (r.errors.length) text += `\n\n⚠️ ${r.errors.join("\n⚠️ ")}`;
  await reply(chatId, text, msgId);
}

async function handleCashAds(chatId, msgId, from, to) {
  const r = await calcCash(from, to);
  let text = `📊 현금화 광고 보고 (${rangeSuffix(from, to)})\n\n${adsLines(r)}`;
  if (r.errors.length) text += `\n\n⚠️ ${r.errors.join("\n⚠️ ")}`;
  await reply(chatId, text, msgId);
}

async function handleAllAds(chatId, msgId, from, to) {
  const [loan, gajeon, cash, card] = await Promise.all([
    calcLoan(from, to),
    calcAds(from, to, GAJEON_ACCOUNTS, "gajeon_leads"),
    calcCash(from, to),
    cardBlock(),
  ]);
  const errors = [...loan.errors, ...gajeon.errors, ...cash.errors];

  let text =
    `📊 광고 보고 (${rangeSuffix(from, to)})\n\n` +
    `[여성대출]\n${adsLines(loan)}\n\n` +
    `[가전공구]\n${adsLines(gajeon)}\n\n` +
    `[현금화]\n${adsLines(cash)}\n\n` +
    `[전체 합계]\n총 지출 광고비 : ${won(loan.spend + gajeon.spend + cash.spend)}\n\n` +
    `[카드 남은 한도]\n${card}`;

  if (errors.length) text += `\n\n⚠️ ${errors.join("\n⚠️ ")}`;
  await reply(chatId, text, msgId);
}

// 날짜별 광고비 (예: /광고 7일 일별, /광고 이번달 일별)
async function handleAdsDaily(chatId, msgId, from, to) {
  const days = daysBetween(from, to) + 1;
  if (days > MAX_DAILY_DAYS) {
    await reply(chatId, `일별 보고는 최대 ${MAX_DAILY_DAYS}일까지 볼 수 있어요. 기간을 줄여주세요.`, msgId);
    return;
  }

  const errors = [];
  const liveOf = (list) => list.filter((a) => a.id && a.token);
  const safeDaily = async (acc) => {
    try {
      return await getDailySpend(acc.id, acc.token, from, to);
    } catch (e) {
      errors.push(`${acc.label} 조회 실패: ${e.message}`);
      return {};
    }
  };
  const safeLeads = async (table, label) => {
    try {
      return await getLeadDays(table, from, to);
    } catch (e) {
      errors.push(`${label} 디비 조회 실패: ${e.message}`);
      return {};
    }
  };

  const [loanMaps, cMap, gajeonMaps, loanLeads, gajeonLeads, cashLeads] = await Promise.all([
    Promise.all(liveOf(LOAN_ACCOUNTS).map(safeDaily)),
    liveOf([ACCOUNT_C]).length ? safeDaily(ACCOUNT_C) : Promise.resolve({}),
    Promise.all(liveOf(GAJEON_ACCOUNTS).map(safeDaily)),
    safeLeads("report_leads", "여성대출"),
    safeLeads("gajeon_leads", "가전공구"),
    safeLeads("cash_leads", "현금화"),
  ]);

  const sumMaps = (maps, d) => maps.reduce((s, m) => s + (m[d] || 0), 0);

  const lines = [];
  let totalSpend = 0;
  let totalLeads = 0;

  for (let d = to; d >= from; d = addDays(d, -1)) {
    const loanSpend = sumMaps(loanMaps, d) + (d < CASH_START ? cMap[d] || 0 : 0);
    const cashSpend = d >= CASH_START ? cMap[d] || 0 : 0;
    const gajeonSpend = sumMaps(gajeonMaps, d);

    const segs = [
      { name: "여성대출", spend: loanSpend, count: loanLeads[d] || 0 },
      { name: "가전공구", spend: gajeonSpend, count: gajeonLeads[d] || 0 },
      { name: "현금화", spend: cashSpend, count: cashLeads[d] || 0 },
    ].filter((s) => s.spend > 0 || s.count > 0);

    const daySpend = loanSpend + gajeonSpend + cashSpend;
    totalSpend += daySpend;
    totalLeads += segs.reduce((s, x) => s + x.count, 0);

    if (!segs.length) {
      lines.push(`${shortLabel(d)} 광고 없음`);
    } else {
      lines.push(
        `${shortLabel(d)} 합계 ${manShort(daySpend)} — ` +
          segs.map((s) => `${s.name} ${manShort(s.spend)}(${s.count}개)`).join(" / ")
      );
    }
  }

  let text =
    `📊 광고 일별 (${rangeSuffix(from, to)})\n\n` +
    lines.join("\n") +
    `\n\n[기간 합계] 광고비 ${won(totalSpend)} · 디비 ${totalLeads}개`;

  if (errors.length) text += `\n\n⚠️ ${errors.join("\n⚠️ ")}`;
  await replyLong(chatId, text, msgId);
}

async function handleCard(chatId, msgId) {
  const card = await cardBlock();
  await reply(chatId, `💳 카드 남은 한도\n\n${card}`, msgId);
}

async function consultReport(chatId, msgId, date, table, title) {
  const rows = await getLeads(date, table);
  const cnt = (field, value) => rows.filter((r) => r[field] === value).length;
  const pending = (n) => (n > 0 ? `\n- 진행 전 : ${n}개` : "");

  const total = rows.length;
  const kakaoOk = cnt("kakao", "가능");
  const kakaoNo = cnt("kakao", "불가");
  const replied = cnt("kakao_reply", "답장");
  const kakaoAbsent = cnt("kakao_reply", "부재");
  const callDone = cnt("call_status", "통화 완료");
  const callLater = cnt("call_status", "나중 통화 요청");
  const callAbsent = cnt("call_status", "부재");
  const lineIn = cnt("result", "라인 인입");
  const rejected = cnt("result", "거절");

  const text =
    `${title} (${titleSuffix(date)})\n\n` +
    `1. DB 유입 현황\n` +
    `- 총 DB : ${total}개\n` +
    `- 카톡 친추 가능 : ${kakaoOk}개\n` +
    `- 카톡 친추 불가 : ${kakaoNo}개` +
    pending(total - kakaoOk - kakaoNo) +
    `\n\n2. 카톡 상담 진행\n` +
    `- 답장 : ${replied}개\n` +
    `- 부재 : ${kakaoAbsent}개` +
    pending(kakaoOk - replied - kakaoAbsent) +
    `\n\n3. 통화 진행 현황\n` +
    `- 통화 완료 : ${callDone}개\n` +
    `- 나중 통화 요청 : ${callLater}개\n` +
    `- 부재 : ${callAbsent}개` +
    pending(replied - callDone - callLater - callAbsent) +
    `\n\n4. 최종 성과\n` +
    `- 라인 인입 : ${lineIn}개\n` +
    `- 거절 : ${rejected}개` +
    pending(callDone - lineIn - rejected);

  await reply(chatId, text, msgId);
}

async function handleConsult(chatId, msgId, date) {
  await consultReport(chatId, msgId, date, "report_leads", "💬 상담 현황(대출)");
}

async function handleConsultGajeon(chatId, msgId, date) {
  await consultReport(chatId, msgId, date, "gajeon_leads", "🛒 상담 현황(가전)");
}

// 하루 정산
async function handleSettle(chatId, msgId, date) {
  const monthStart = date.slice(0, 8) + "01";
  const monthNum = Number(date.slice(5, 7));

  const { rows: all, expected } = await getSettle(monthStart, date);
  const rows = all.filter((r) => r.date === date);

  let manPerTr = null;
  let rateError = "";
  if (all.some((r) => r.unit === "tr") || expected.some((r) => r.unit === "tr")) {
    try {
      manPerTr = await getManPerTr();
    } catch (e) {
      rateError = e.message;
    }
  }

  const toMan = (r) => {
    if (r.unit === "tr") return manPerTr === null ? 0 : r.amount * manPerTr;
    return r.amount;
  };

  const amountText = (r) => {
    if (r.unit === "tr") {
      return manPerTr === null ? `${r.amount}tr` : `${r.amount}tr (${man(toMan(r))})`;
    }
    return man(r.amount);
  };

  const lineText = (r) => {
    let t = esc(r.item);
    if (r.name) t += ` (${esc(r.name)})`;
    if (r.note) t += ` ${esc(r.note)}`;
    return `${t} ${amountText(r)}`;
  };

  const income = rows.filter((r) => r.type === "수입");
  const expense = rows.filter((r) => r.type === "지출");

  const incomeTotal = income.reduce((s, r) => s + toMan(r), 0);
  const expenseTotal = expense.reduce((s, r) => s + toMan(r), 0);

  const monthProfit = all.reduce((s, r) => {
    if (r.type === "수입") return s + toMan(r);
    if (r.type === "지출") return s - toMan(r);
    return s;
  }, 0);

  let text = `* ${shortLabel(date)}\n\n`;

  if (!rows.length) {
    text += `입력된 정산이 없습니다.`;
  } else {
    text += `[수입] ${man(incomeTotal)}\n`;
    text += income.map((r, i) => `${i + 1}. ${lineText(r)}`).join("\n");
    text += `\n\n[지출] ${man(expenseTotal)}\n`;
    text += expense.map((r, i) => `${i + 1}. ${lineText(r)}`).join("\n");
    text += `\n\n<b>오늘 수익 ${man(incomeTotal - expenseTotal)}</b>`;
  }

  text += `\n\n<b>${monthNum}월 누적 ${man(monthProfit)}</b>`;

  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const today = kstToday();

  // 미결제 (판매는 됐는데 입금 전, 오래된 순)
  const unpaid = expected.filter((r) => r.type === "미결제").sort(byDate);
  if (unpaid.length) {
    const unpaidTotal = unpaid.reduce((s, r) => s + toMan(r), 0);
    text += `\n\n[미결제] ${unpaid.length}건 ${man(unpaidTotal)}\n`;
    text += unpaid
      .map((r, i) => {
        const late = daysBetween(r.date, today);
        return `${i + 1}. ${shortLabel(r.date)} ${lineText(r)}${late > 0 ? ` ⚠️ ${late}일 경과` : ""}`;
      })
      .join("\n");
  }

  // 예상 매출 (아직 입금 전인 예상, 판매 예정일 순)
  const planned = expected.filter((r) => r.type !== "미결제").sort(byDate);
  if (planned.length) {
    const plannedTotal = planned.reduce((s, r) => s + toMan(r), 0);
    text += `\n\n[예상 매출] ${planned.length}건 ${man(plannedTotal)}\n`;
    text += planned
      .map(
        (r, i) =>
          `${i + 1}. ${shortLabel(r.date)} ${lineText(r)}${r.date < today ? " ⚠️ 예정일 지남" : ""}`
      )
      .join("\n");
  }

  if (rateError) {
    text += `\n\n⚠️ ${esc(rateError)} — tr 금액은 합계에서 빠졌습니다.`;
  }

  await reply(chatId, text, msgId, false, true);
}

// 기간 정산 합계 (예: /정산 이번달, /정산 7일, /정산 11/1~11/15)
async function handleSettleRange(chatId, msgId, from, to) {
  const { rows, expected } = await getSettle(from, to);

  let manPerTr = null;
  let rateError = "";
  if (rows.some((r) => r.unit === "tr") || expected.some((r) => r.unit === "tr")) {
    try {
      manPerTr = await getManPerTr();
    } catch (e) {
      rateError = e.message;
    }
  }

  const toMan = (r) => {
    if (r.unit === "tr") return manPerTr === null ? 0 : r.amount * manPerTr;
    return r.amount;
  };

  const income = rows.filter((r) => r.type === "수입");
  const expense = rows.filter((r) => r.type === "지출");
  const incomeTotal = income.reduce((s, r) => s + toMan(r), 0);
  const expenseTotal = expense.reduce((s, r) => s + toMan(r), 0);

  let text = `* ${rangeSuffix(from, to)} 정산\n\n`;

  if (!rows.length) {
    text += `입력된 정산이 없습니다.`;
  } else {
    text += `[수입] ${income.length}건 ${man(incomeTotal)}\n`;
    text += `[지출] ${expense.length}건 ${man(expenseTotal)}\n\n`;
    text += `<b>기간 수익 ${man(incomeTotal - expenseTotal)}</b>`;

    // 날짜별
    const days = {};
    rows.forEach((r) => {
      if (!days[r.date]) days[r.date] = { inc: 0, exp: 0 };
      if (r.type === "수입") days[r.date].inc += toMan(r);
      else if (r.type === "지출") days[r.date].exp += toMan(r);
    });
    const dayLines = Object.keys(days)
      .sort()
      .map((d) => {
        const v = days[d];
        return `${shortLabel(d)} 수입 ${man(v.inc)} · 지출 ${man(v.exp)} → ${man(v.inc - v.exp)}`;
      });
    text += `\n\n[날짜별]\n${dayLines.join("\n")}`;
  }

  // 지금 남아 있는 미결제·예상 (기간과 상관없이 현재 기준)
  const unpaid = expected.filter((r) => r.type === "미결제");
  const planned = expected.filter((r) => r.type !== "미결제");
  if (unpaid.length) {
    text += `\n\n[미결제 현재] ${unpaid.length}건 ${man(unpaid.reduce((s, r) => s + toMan(r), 0))}`;
  }
  if (planned.length) {
    text += `\n[예상 매출 현재] ${planned.length}건 ${man(planned.reduce((s, r) => s + toMan(r), 0))}`;
  }

  if (rateError) {
    text += `\n\n⚠️ ${esc(rateError)} — tr 금액은 합계에서 빠졌습니다.`;
  }

  await reply(chatId, text, msgId, false, true);
}

async function handleMenu(chatId, msgId) {
  if (useKeyboard) {
    await reply(
      chatId,
      "아래 버튼으로 보고를 확인하세요.\n" +
        "상담: /상담 (대출), /상담가전 — 날짜 가능 (예: /상담가전 어제)\n" +
        "정산: /정산 11/13, /정산 이번달, /정산 7일, /정산 11/1~11/15\n" +
        "기간 광고비: /광고 3일, /광고 11/16~11/18, /광고 이번달\n" +
        "날짜별 광고비: /광고 7일 일별, /광고 이번달 일별\n" +
        "카드 한도: /잔액",
      msgId,
      true
    );
  } else {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "입력창 버튼을 정리했습니다.",
      reply_markup: { remove_keyboard: true },
    });
  }

  if (usePinned) {
    const sent = await tg("sendMessage", {
      chat_id: chatId,
      text: "📋 보고 메뉴",
      reply_markup: INLINE_MENU,
    });
    if (sent.ok) {
      await tg("pinChatMessage", {
        chat_id: chatId,
        message_id: sent.result.message_id,
        disable_notification: true,
      });
    }
  }
}

async function handleDelete(chatId, msg, table) {
  const target = msg.reply_to_message;
  if (!target) {
    await reply(chatId, "삭제할 디비 알림 메시지에 답장으로 /삭제 를 입력해주세요.", msg.message_id);
    return;
  }

  const res = await fetch(
    `${SB_URL}/rest/v1/${table}?tg_message_id=eq.${target.message_id}`,
    {
      method: "PATCH",
      headers: { ...sbHeaders, Prefer: "return=representation" },
      body: JSON.stringify({ deleted: true }),
    }
  );
  const rows = await res.json();

  if (Array.isArray(rows) && rows.length > 0) {
    await reply(chatId, `🗑 디비 개수에서 제외했습니다. (${rows[0].name || "-"})`, msg.message_id);
  } else {
    await reply(chatId, "이 메시지에 해당하는 디비를 찾지 못했습니다.", msg.message_id);
  }
}

async function handleButton(cq) {
  const chatId = String(cq.message.chat.id);
  await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "불러오는 중..." });

  if (chatId !== REPORT_CHAT) return;

  const today = kstToday();
  try {
    if (cq.data === "ads") await handleAllAds(chatId, null, today, today);
    else if (cq.data === "consult") await handleConsult(chatId, null, today);
    else if (cq.data === "consult_g") await handleConsultGajeon(chatId, null, today);
    else if (cq.data === "settle") await handleSettle(chatId, null, today);
    else if (cq.data === "card") await handleCard(chatId, null);
  } catch (err) {
    console.error("button error:", err);
    await reply(chatId, "⚠️ 처리 중 오류: " + err.message);
  }
}

async function runReport(chatId, msgId, handler, arg) {
  const date = parseDateArg(arg);
  if (!date) {
    await reply(chatId, "날짜 형식을 확인해주세요. 예: /정산 11/13, /상담 어제", msgId);
    return;
  }
  await handler(chatId, msgId, date);
}

async function runAdsReport(chatId, msgId, handler, arg) {
  const r = parseRangeArg(arg);
  if (!r) {
    await reply(
      chatId,
      "기간 형식을 확인해주세요.\n예: 3일, 11/16~11/18, 이번달, 어제, 11/13",
      msgId
    );
    return;
  }
  await handler(chatId, msgId, r.from, r.to);
}

// 보고 방 /광고: "일별"이 붙으면 날짜별, 아니면 기간 합계
async function runAllAdsReport(chatId, msgId, arg) {
  const daily = /일별/.test(arg);
  const cleaned = arg.replace(/일별/g, "").trim();
  const range = daily && !cleaned ? "7일" : cleaned;

  const r = parseRangeArg(range);
  if (!r) {
    await reply(
      chatId,
      "기간 형식을 확인해주세요.\n예: 3일, 11/16~11/18, 이번달, 어제, 11/13\n날짜별: 7일 일별, 이번달 일별",
      msgId
    );
    return;
  }
  if (daily) await handleAdsDaily(chatId, msgId, r.from, r.to);
  else await handleAllAds(chatId, msgId, r.from, r.to);
}

// 정산: 하루면 하루 보고, 기간이면 기간 합계
async function runSettleReport(chatId, msgId, arg) {
  const r = parseRangeArg(arg);
  if (!r) {
    await reply(
      chatId,
      "날짜 형식을 확인해주세요.\n예: /정산 11/13, /정산 이번달, /정산 7일, /정산 11/1~11/15",
      msgId
    );
    return;
  }
  if (r.from === r.to) await handleSettle(chatId, msgId, r.from);
  else await handleSettleRange(chatId, msgId, r.from, r.to);
}

exports.handler = async (event) => {
  const secret = event.headers["x-telegram-bot-api-secret-token"];
  if (secret !== process.env.TG_WEBHOOK_SECRET) {
    return { statusCode: 401, body: "unauthorized" };
  }

  let update;
  try {
    update = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 200, body: "OK" };
  }

  if (update.callback_query) {
    await handleButton(update.callback_query);
    return { statusCode: 200, body: "OK" };
  }

  const msg = update.message;
  if (!msg || !msg.text) return { statusCode: 200, body: "OK" };

  const chatId = String(msg.chat.id);
  if (
    chatId !== LEAD_CHAT &&
    chatId !== REPORT_CHAT &&
    chatId !== GAJEON_CHAT &&
    chatId !== CASH_CHAT
  ) {
    return { statusCode: 200, body: "OK" };
  }

  const text = msg.text.trim().replace(/@\w+/, "");
  const cmd = (text.match(/^\/\S+/) || [""])[0];
  const arg = text.slice(cmd.length).trim();
  const id = msg.message_id;
  const today = kstToday();

  try {
    if (chatId === REPORT_CHAT) {
      if (cmd === "/광고") await runAllAdsReport(chatId, id, arg);
      else if (cmd === "/상담" || cmd === "/상담대출") await runReport(chatId, id, handleConsult, arg);
      else if (cmd === "/상담가전") await runReport(chatId, id, handleConsultGajeon, arg);
      else if (cmd === "/정산") await runSettleReport(chatId, id, arg);
      else if (cmd === "/잔액") await handleCard(chatId, id);
      else if (cmd === "/메뉴" || cmd === "/start") await handleMenu(chatId, id);
      else if (text === BTN_ADS) await handleAllAds(chatId, id, today, today);
      else if (text === BTN_CONSULT) await handleConsult(chatId, id, today);
      else if (text === BTN_CONSULT_G) await handleConsultGajeon(chatId, id, today);
      else if (text === BTN_SETTLE) await handleSettle(chatId, id, today);
      else if (text === BTN_CARD) await handleCard(chatId, id);
    } else if (chatId === GAJEON_CHAT) {
      if (cmd === "/보고") await runAdsReport(chatId, id, handleGajeonAds, arg);
      else if (cmd === "/상담") await runReport(chatId, id, handleConsultGajeon, arg);
      else if (cmd === "/삭제") await handleDelete(chatId, msg, "gajeon_leads");
    } else if (chatId === CASH_CHAT) {
      if (cmd === "/보고") await runAdsReport(chatId, id, handleCashAds, arg);
      else if (cmd === "/삭제") await handleDelete(chatId, msg, "cash_leads");
    } else {
      if (cmd === "/보고") await runAdsReport(chatId, id, handleAds, arg);
      else if (cmd === "/삭제") await handleDelete(chatId, msg, "report_leads");
    }
  } catch (err) {
    console.error("bot error:", err);
    await reply(chatId, "⚠️ 처리 중 오류: " + err.message, id);
  }

  return { statusCode: 200, body: "OK" };
};
