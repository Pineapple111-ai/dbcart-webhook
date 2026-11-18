// 디비알림봇 명령어 처리
// - 보고 방: /광고(여성대출+가전공구+합계+카드한도, 기간 가능), /상담, /정산 (+ 날짜), /잔액, /메뉴 (+ 버튼)
// - 디비 (여성대출) 방: /삭제, /보고 (기간 가능)
// - 디비 (가전공구) 방: /삭제, /보고 (기간 가능)
const LEAD_CHAT = "-5318830146";   // 디비 (여성대출) 방
const REPORT_CHAT = "-5391256412"; // 보고 방
const GAJEON_CHAT = "-5235472796"; // 디비 (가전공구) 방

// 버튼 방식
// "both"     = 입력창 아래 버튼(A) + 고정 메시지 버튼(B)
// "pinned"   = 고정 메시지 버튼(B)만
// "keyboard" = 입력창 아래 버튼(A)만
const BUTTON_MODE = "both";

const BTN_ADS = "📊 광고";
const BTN_CONSULT = "💬 상담";
const BTN_SETTLE = "🧾 정산";
const BTN_CARD = "💳 잔액";

// 여성대출 광고비를 합산할 광고계정 (환경변수가 없는 계정은 건너뜀)
const AD_ACCOUNTS = [
  { label: "계정A", id: process.env.META_ACCOUNT_A, token: process.env.META_TOKEN_A },
  { label: "계정B", id: process.env.META_ACCOUNT_B, token: process.env.META_TOKEN_B },
  { label: "계정C", id: process.env.META_ACCOUNT_C, token: process.env.META_TOKEN_C },
];

// 가전공구 광고계정 (계정 A와 같은 비즈니스 관리자 → A 토큰 사용)
const GAJEON_ACCOUNTS = [
  { label: "최저가공구", id: process.env.META_ACCOUNT_GAJEON, token: process.env.META_TOKEN_A },
];

// 카드 한도 며칠치 계산에 쓰는 평균 기간 (어제까지 N일)
const CARD_AVG_DAYS = 3;

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
    [{ text: BTN_ADS }, { text: BTN_CONSULT }],
    [{ text: BTN_SETTLE }, { text: BTN_CARD }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

// B: 메시지에 붙는 버튼
const INLINE_MENU = {
  inline_keyboard: [
    [
      { text: BTN_ADS, callback_data: "ads" },
      { text: BTN_CONSULT, callback_data: "consult" },
    ],
    [
      { text: BTN_SETTLE, callback_data: "settle" },
      { text: BTN_CARD, callback_data: "card" },
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

// 한국시간 현재
function kstNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

// Date → "2026-11-14"
function ymd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// 한국시간 오늘 "2026-11-14"
function kstToday() {
  return ymd(kstNow());
}

// "2026-11-14"에서 n일 더하기/빼기
function addDays(date, n) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}

// "2026-11-14" → 다음날 "2026-11-15"
function nextDay(date) {
  return addDays(date, 1);
}

// "2026-11-14" → "11/14"
function shortLabel(date) {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

// 한국시간 현재 시각 "15:20"
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
// - 없음/오늘/어제/11/13 → 하루
// - 3일 → 오늘 포함 최근 3일
// - 이번달 → 이번 달 1일 ~ 오늘
// - 11/16~11/18 → 지정 기간
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

// 보고 제목 뒤에 붙는 날짜 표시 (하루)
function titleSuffix(date) {
  return date === kstToday()
    ? `오늘 ${shortLabel(date)} ${kstTimeLabel()} 기준`
    : shortLabel(date);
}

// 보고 제목 뒤에 붙는 기간 표시
function rangeSuffix(from, to) {
  if (from === to) return titleSuffix(from);
  const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  let t = `${shortLabel(from)}~${shortLabel(to)}, ${days}일`;
  if (to === kstToday()) t += ` · ${kstTimeLabel()} 기준`;
  return t;
}

// ===== 금액 표시 =====

// 원 → "136.1만원 (1,360,841원)"
function won(n) {
  const man = (n / 10000).toFixed(1).replace(/\.0$/, "");
  return `${man}만원 (${Math.round(n).toLocaleString("ko-KR")}원)`;
}

// 만원 숫자 표시 (반올림, 천 단위 콤마)
function man(n) {
  return `${Math.round(n).toLocaleString("ko-KR")}만원`;
}

// 동 → "5.9tr"
function trText(vnd) {
  return (vnd / 1000000).toFixed(1).replace(/\.0$/, "") + "tr";
}

// 동 → "5,907,025 VND"
function vndText(vnd) {
  return Math.round(vnd).toLocaleString("en-US") + " VND";
}

// "18/11/2026 19:05:08" → "11/18 19:05"
function cardTimeLabel(t) {
  const m = String(t || "").match(/(\d{2})\/(\d{2})\/\d{4}\s+(\d{2}:\d{2})/);
  return m ? `${Number(m[2])}/${Number(m[1])} ${m[3]}` : "";
}

// ===== 데이터 조회 =====

// 메타 광고계정 지출 (기간 합계)
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

// 기간 디비 조건 (삭제 처리된 건 제외)
function leadRangeFilter(from, to) {
  const start = encodeURIComponent(`${from}T00:00:00+09:00`);
  const end = encodeURIComponent(`${nextDay(to)}T00:00:00+09:00`);
  return `deleted=eq.false&created_at=gte.${start}&created_at=lt.${end}`;
}

// 기간 디비 개수 (table: report_leads 또는 gajeon_leads)
async function getLeadCount(from, to, table) {
  const url = `${SB_URL}/rest/v1/${table}?select=id&${leadRangeFilter(from, to)}`;
  const res = await fetch(url, {
    headers: { ...sbHeaders, Prefer: "count=exact", Range: "0-0" },
  });
  const range = res.headers.get("content-range") || "";
  return Number(range.split("/")[1] || 0);
}

// 해당 날짜 디비 상태 목록 (여성대출)
async function getLeads(date) {
  const url =
    `${SB_URL}/rest/v1/report_leads` +
    `?select=kakao,kakao_reply,call_status,result&${leadRangeFilter(date, date)}`;
  const res = await fetch(url, { headers: sbHeaders });
  if (!res.ok) throw new Error("Supabase " + res.status);
  return res.json();
}

// 정산 시트에서 기간 데이터 (from ~ to)
async function getSettleRows(from, to) {
  const url =
    `${process.env.SETTLE_URL}?key=${encodeURIComponent(process.env.SETTLE_KEY)}` +
    `&from=${from}&to=${to}`;
  const res = await fetch(url, { redirect: "follow" });
  const json = await res.json();
  if (json.error) throw new Error("정산 시트: " + json.error);
  return json.rows || [];
}

// 1tr(백만 동)이 몇 만원인지
async function getManPerTr() {
  const res = await fetch("https://open.er-api.com/v6/latest/VND");
  const json = await res.json();
  const krwPerVnd = json && json.rates && json.rates.KRW;
  if (!krwPerVnd) throw new Error("환율 조회 실패");
  return (krwPerVnd * 1000000) / 10000;
}

// 1원이 몇 동인지
async function getVndPerKrw() {
  const res = await fetch("https://open.er-api.com/v6/latest/KRW");
  const json = await res.json();
  const v = json && json.rates && json.rates.VND;
  if (!v) throw new Error("환율 조회 실패");
  return v;
}

// 카드 남은 한도 (메일 기준)
async function getCard() {
  const url = `${process.env.CARD_URL}?key=${encodeURIComponent(process.env.CARD_KEY)}`;
  const res = await fetch(url, { redirect: "follow" });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

// 메시지 보내기
// - 보고 방: 답장 형태 없이 일반 메시지로
// - 입력창 버튼은 withKeyboard일 때만(/메뉴) 붙임
// - html이 true면 굵게 표시 가능
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

// 광고비·디비 수 계산 (기간, 광고계정 목록, 디비 테이블)
async function calcAds(from, to, accounts, table) {
  let spend = 0;
  const errors = [];

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

  const count = table ? await getLeadCount(from, to, table) : 0;
  return { spend, count, errors };
}

// 광고비·디비 수·단가 3줄
function adsLines(r) {
  const cpl = r.count > 0 ? won(r.spend / r.count) : "-";
  return (
    `총 지출 광고비 : ${won(r.spend)}\n` +
    `총 유입 디비개수 : ${r.count}개\n` +
    `디비 개당 단가 : ${cpl}`
  );
}

// 💳 카드 한도 블록 (남은 한도 + 며칠치)
async function cardBlock() {
  try {
    const today = kstToday();
    const from = addDays(today, -CARD_AVG_DAYS);
    const to = addDays(today, -1);

    const [card, vndPerKrw, avg] = await Promise.all([
      getCard(),
      getVndPerKrw().catch(() => null),
      calcAds(from, to, [...AD_ACCOUNTS, ...GAJEON_ACCOUNTS], null),
    ]);

    let text = `${trText(card.limit)} (${vndText(card.limit)})`;

    const dailyKrw = avg.spend / CARD_AVG_DAYS;
    let days = "";
    if (vndPerKrw && dailyKrw > 0) {
      const d = card.limit / (dailyKrw * vndPerKrw);
      days = `약 ${d.toFixed(1)}일치 · `;
    }
    text += `\n${days}${cardTimeLabel(card.time)} 기준`;
    return text;
  } catch (e) {
    return `⚠️ 카드 한도 조회 실패: ${e.message}`;
  }
}

// 📊 여성대출 광고 보고 (디비 (여성대출) 방 /보고)
async function handleAds(chatId, msgId, from, to) {
  const r = await calcAds(from, to, AD_ACCOUNTS, "report_leads");
  let text = `📊 광고 보고 (${rangeSuffix(from, to)})\n\n${adsLines(r)}`;
  if (r.errors.length) text += `\n\n⚠️ ${r.errors.join("\n⚠️ ")}`;
  await reply(chatId, text, msgId);
}

// 📊 가전공구 광고 보고 (디비 (가전공구) 방 /보고)
async function handleGajeonAds(chatId, msgId, from, to) {
  const r = await calcAds(from, to, GAJEON_ACCOUNTS, "gajeon_leads");
  let text = `📊 가전공구 광고 보고 (${rangeSuffix(from, to)})\n\n${adsLines(r)}`;
  if (r.errors.length) text += `\n\n⚠️ ${r.errors.join("\n⚠️ ")}`;
  await reply(chatId, text, msgId);
}

// 📊 전체 광고 보고 (보고 방: 여성대출 + 가전공구 + 광고비 합계 + 카드 한도)
async function handleAllAds(chatId, msgId, from, to) {
  const [loan, gajeon, card] = await Promise.all([
    calcAds(from, to, AD_ACCOUNTS, "report_leads"),
    calcAds(from, to, GAJEON_ACCOUNTS, "gajeon_leads"),
    cardBlock(),
  ]);
  const errors = [...loan.errors, ...gajeon.errors];

  let text =
    `📊 광고 보고 (${rangeSuffix(from, to)})\n\n` +
    `[여성대출]\n${adsLines(loan)}\n\n` +
    `[가전공구]\n${adsLines(gajeon)}\n\n` +
    `[전체 합계]\n총 지출 광고비 : ${won(loan.spend + gajeon.spend)}\n\n` +
    `[카드 남은 한도]\n${card}`;

  if (errors.length) text += `\n\n⚠️ ${errors.join("\n⚠️ ")}`;
  await reply(chatId, text, msgId);
}

// 💳 /잔액
async function handleCard(chatId, msgId) {
  const card = await cardBlock();
  await reply(chatId, `💳 카드 남은 한도\n\n${card}`, msgId);
}

// 💬 상담 보고
async function handleConsult(chatId, msgId, date) {
  const rows = await getLeads(date);
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
    `💬 상담 현황 (${titleSuffix(date)})\n\n` +
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

// 🧾 정산 보고 (간단 버전 + 이번 달 누적)
async function handleSettle(chatId, msgId, date) {
  const monthStart = date.slice(0, 8) + "01";
  const monthNum = Number(date.slice(5, 7));

  // 이번 달 1일 ~ 보고 날짜까지 한 번에 가져오기
  const all = await getSettleRows(monthStart, date);
  const rows = all.filter((r) => r.date === date);

  // tr이 있을 때만 환율 조회
  let manPerTr = null;
  let rateError = "";
  if (all.some((r) => r.unit === "tr")) {
    try {
      manPerTr = await getManPerTr();
    } catch (e) {
      rateError = e.message;
    }
  }

  // 만원 환산 (환율 실패한 tr은 0)
  const toMan = (r) => {
    if (r.unit === "tr") return manPerTr === null ? 0 : r.amount * manPerTr;
    return r.amount;
  };

  // 한 줄 금액 표시
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

  // 이번 달 누적 수익
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
    text += expense.map((r) => lineText(r)).join("\n");
    text += `\n\n<b>오늘 수익 ${man(incomeTotal - expenseTotal)}</b>`;
  }

  text += `\n\n<b>${monthNum}월 누적 ${man(monthProfit)}</b>`;

  if (rateError) {
    text += `\n\n⚠️ ${esc(rateError)} — tr 금액은 합계에서 빠졌습니다.`;
  }

  await reply(chatId, text, msgId, false, true);
}

// /메뉴
async function handleMenu(chatId, msgId) {
  // 입력창 버튼: 켜거나 끄기
  if (useKeyboard) {
    await reply(
      chatId,
      "아래 버튼으로 보고를 확인하세요.\n" +
        "날짜별 보기: /정산 11/13, /상담 어제\n" +
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

  // 고정 메뉴: 보내고 상단에 고정
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

// /삭제 (디비 알림 메시지에 답장) — table: report_leads 또는 gajeon_leads
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

// 고정 메뉴 버튼을 눌렀을 때 (항상 오늘)
async function handleButton(cq) {
  const chatId = String(cq.message.chat.id);
  await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "불러오는 중..." });

  if (chatId !== REPORT_CHAT) return;

  const today = kstToday();
  try {
    if (cq.data === "ads") await handleAllAds(chatId, null, today, today);
    else if (cq.data === "consult") await handleConsult(chatId, null, today);
    else if (cq.data === "settle") await handleSettle(chatId, null, today);
    else if (cq.data === "card") await handleCard(chatId, null);
  } catch (err) {
    console.error("button error:", err);
    await reply(chatId, "⚠️ 처리 중 오류: " + err.message);
  }
}

// 하루 단위 보고 명령어 처리 (/상담, /정산)
async function runReport(chatId, msgId, handler, arg) {
  const date = parseDateArg(arg);
  if (!date) {
    await reply(chatId, "날짜 형식을 확인해주세요. 예: /정산 11/13, /상담 어제", msgId);
    return;
  }
  await handler(chatId, msgId, date);
}

// 기간 가능한 광고 보고 명령어 처리 (/광고, /보고)
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
  // 텔레그램에서 온 요청인지 확인
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

  // 고정 메뉴 버튼 클릭
  if (update.callback_query) {
    await handleButton(update.callback_query);
    return { statusCode: 200, body: "OK" };
  }

  const msg = update.message;
  if (!msg || !msg.text) return { statusCode: 200, body: "OK" };

  const chatId = String(msg.chat.id);
  if (chatId !== LEAD_CHAT && chatId !== REPORT_CHAT && chatId !== GAJEON_CHAT) {
    return { statusCode: 200, body: "OK" };
  }

  // "/광고@WomanDB3bot 3일" 같은 형태도 처리
  const text = msg.text.trim().replace(/@\w+/, "");
  const arg = text.replace(/^\/\S+/, "").trim(); // 명령어 뒤 날짜·기간 부분
  const id = msg.message_id;
  const today = kstToday();

  try {
    if (chatId === REPORT_CHAT) {
      if (text.startsWith("/광고")) await runAdsReport(chatId, id, handleAllAds, arg);
      else if (text.startsWith("/상담")) await runReport(chatId, id, handleConsult, arg);
      else if (text.startsWith("/정산")) await runReport(chatId, id, handleSettle, arg);
      else if (text.startsWith("/잔액")) await handleCard(chatId, id);
      else if (text === BTN_ADS) await handleAllAds(chatId, id, today, today);
      else if (text === BTN_CONSULT) await handleConsult(chatId, id, today);
      else if (text === BTN_SETTLE) await handleSettle(chatId, id, today);
      else if (text === BTN_CARD) await handleCard(chatId, id);
      else if (text.startsWith("/메뉴") || text.startsWith("/start")) await handleMenu(chatId, id);
    } else if (chatId === GAJEON_CHAT) {
      if (text.startsWith("/보고")) await runAdsReport(chatId, id, handleGajeonAds, arg);
      else if (text.startsWith("/삭제")) await handleDelete(chatId, msg, "gajeon_leads");
    } else {
      if (text.startsWith("/보고")) await runAdsReport(chatId, id, handleAds, arg);
      else if (text.startsWith("/삭제")) await handleDelete(chatId, msg, "report_leads");
    }
  } catch (err) {
    console.error("bot error:", err);
    await reply(chatId, "⚠️ 처리 중 오류: " + err.message, id);
  }

  return { statusCode: 200, body: "OK" };
};
