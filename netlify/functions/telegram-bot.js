// 디비알림봇 명령어 처리
// - 보고 방: /광고(기간 가능), /상담(대출), /상담가전, /정산 (+ 날짜), /잔액, /메뉴 (+ 버튼)
// - 디비 (여성대출) 방: /삭제, /보고 (기간 가능)
// - 디비 (가전공구) 방: /삭제, /보고 (기간 가능), /상담 (+ 날짜)
// - DB (현금화) 방: /삭제, /보고 (기간 가능)
const LEAD_CHAT = "-5318830146";   // 디비 (여성대출) 방
const REPORT_CHAT = "-5391256412"; // 보고 방
const GAJEON_CHAT = "-5235472796"; // 디비 (가전공구) 방
const CASH_CHAT = "-5498536819";   // DB (현금화) 방

// 계정 C 광고비 기준일: 이 날짜부터는 현금화, 전날까지는 여성대출로 계산
const CASH_START = "2026-11-21";

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

// 기간 읽기 (광고 보고용). 형식이 틀리면 null
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

async function getLeads(date, table) {
  const url =
    `${SB_URL}/rest/v1/${table}` +
    `?select=kakao,kakao_reply,call_status,result&${leadRangeFilter(date, date)}`;
  const res = await fetch(url, { headers: sbHeaders });
  if (!res.ok) throw new Error("Supabase " + res.status);
  return res.json();
}

async function getSettleRows(from, to) {
  const url =
    `${process.env.SETTLE_URL}?key=${encodeURIComponent(process.env.SETTLE_KEY)}` +
    `&from=${from}&to=${to}`;
  const res = await fetch(url, { redirect: "follow" });
  const json = await res.json();
  if (json.error) throw new Error("정산 시트: " + json.error);
  return json.rows || [];
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

async function handleSettle(chatId, msgId, date) {
  const monthStart = date.slice(0, 8) + "01";
  const monthNum = Number(date.slice(5, 7));

  const all = await getSettleRows(monthStart, date);
  const rows = all.filter((r) => r.date === date);

  let manPerTr = null;
  let rateError = "";
  if (all.some((r) => r.unit === "tr")) {
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
        "정산: /정산 11/13\n" +
        "기간 광고비: /광고 3일, /광고 11/16~11/18, /광고 이번달\n" +
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
      if (cmd === "/광고") await runAdsReport(chatId, id, handleAllAds, arg);
      else if (cmd === "/상담" || cmd === "/상담대출") await runReport(chatId, id, handleConsult, arg);
      else if (cmd === "/상담가전") await runReport(chatId, id, handleConsultGajeon, arg);
      else if (cmd === "/정산") await runReport(chatId, id, handleSettle, arg);
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
