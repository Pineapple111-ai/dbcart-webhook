// 디비알림봇 명령어 처리
// - 보고 방: /광고, /상담, /정산 (+ 날짜), /메뉴 (+ 버튼)
// - 디비 (여성대출) 방: /삭제, /보고
const LEAD_CHAT = "-5318830146";   // 디비 (여성대출) 방
const REPORT_CHAT = "-5391256412"; // 보고 방

// 버튼 방식
// "both"     = 입력창 아래 버튼(A) + 고정 메시지 버튼(B)
// "pinned"   = 고정 메시지 버튼(B)만
// "keyboard" = 입력창 아래 버튼(A)만
const BUTTON_MODE = "both";

const BTN_ADS = "📊 광고";
const BTN_CONSULT = "💬 상담";
const BTN_SETTLE = "🧾 정산";

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
  keyboard: [[{ text: BTN_ADS }, { text: BTN_CONSULT }, { text: BTN_SETTLE }]],
  resize_keyboard: true,
  is_persistent: true,
};

// B: 메시지에 붙는 버튼
const INLINE_MENU = {
  inline_keyboard: [[
    { text: BTN_ADS, callback_data: "ads" },
    { text: BTN_CONSULT, callback_data: "consult" },
    { text: BTN_SETTLE, callback_data: "settle" },
  ]],
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

// "2026-11-14" → 다음날 "2026-11-15"
function nextDay(date) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return ymd(d);
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

// 명령어 뒤의 날짜 읽기. 없으면 오늘, 형식이 틀리면 null
function parseDateArg(arg) {
  const s = (arg || "").trim();
  if (!s || s === "오늘") return kstToday();
  if (s === "어제") {
    const d = kstNow();
    d.setUTCDate(d.getUTCDate() - 1);
    return ymd(d);
  }

  let m = s.match(/(\d{4})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;

  m = s.match(/(\d{1,2})\s*[\/.\-]\s*(\d{1,2})/);
  if (m) {
    const y = kstNow().getUTCFullYear();
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

// 보고 제목 뒤에 붙는 날짜 표시
function titleSuffix(date) {
  return date === kstToday()
    ? `오늘 ${shortLabel(date)} ${kstTimeLabel()} 기준`
    : shortLabel(date);
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

// ===== 데이터 조회 =====

// 메타 광고계정 지출 (해당 날짜)
async function getSpend(accountId, token, date) {
  const range =
    date === kstToday()
      ? "date_preset=today"
      : `time_range=${encodeURIComponent(JSON.stringify({ since: date, until: date }))}`;
  const url =
    `https://graph.facebook.com/v27.0/act_${accountId}/insights` +
    `?fields=spend&${range}&access_token=${token}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data && json.data[0] ? Number(json.data[0].spend) : 0;
}

// 해당 날짜 디비 조건 (삭제 처리된 건 제외)
function leadDateFilter(date) {
  const start = encodeURIComponent(`${date}T00:00:00+09:00`);
  const end = encodeURIComponent(`${nextDay(date)}T00:00:00+09:00`);
  return `deleted=eq.false&created_at=gte.${start}&created_at=lt.${end}`;
}

// 해당 날짜 디비 개수
async function getLeadCount(date) {
  const url = `${SB_URL}/rest/v1/report_leads?select=id&${leadDateFilter(date)}`;
  const res = await fetch(url, {
    headers: { ...sbHeaders, Prefer: "count=exact", Range: "0-0" },
  });
  const range = res.headers.get("content-range") || "";
  return Number(range.split("/")[1] || 0);
}

// 해당 날짜 디비 상태 목록
async function getLeads(date) {
  const url =
    `${SB_URL}/rest/v1/report_leads` +
    `?select=kakao,kakao_reply,call_status,result&${leadDateFilter(date)}`;
  const res = await fetch(url, { headers: sbHeaders });
  if (!res.ok) throw new Error("Supabase " + res.status);
  return res.json();
}

// 정산 시트에서 해당 날짜 데이터
async function getSettleRows(date) {
  const url =
    `${process.env.SETTLE_URL}?key=${encodeURIComponent(process.env.SETTLE_KEY)}` +
    `&date=${date}`;
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

// 메시지 보내기
// - 보고 방: 답장 형태 없이 일반 메시지로
// - 입력창 버튼은 withKeyboard일 때만(/메뉴) 붙임
async function reply(chatId, text, replyTo, withKeyboard) {
  const body = { chat_id: chatId, text };
  if (replyTo && chatId !== REPORT_CHAT) body.reply_to_message_id = replyTo;
  if (withKeyboard && chatId === REPORT_CHAT && useKeyboard) {
    body.reply_markup = REPLY_KEYBOARD;
  }
  return tg("sendMessage", body);
}

// ===== 보고 =====

// 📊 광고 보고
async function handleAds(chatId, msgId, date) {
  let spendA = 0;
  let spendB = 0;
  const errors = [];

  try {
    spendA = await getSpend(process.env.META_ACCOUNT_A, process.env.META_TOKEN_A, date);
  } catch (e) {
    errors.push("계정A 조회 실패: " + e.message);
  }
  try {
    spendB = await getSpend(process.env.META_ACCOUNT_B, process.env.META_TOKEN_B, date);
  } catch (e) {
    errors.push("계정B 조회 실패: " + e.message);
  }

  const total = spendA + spendB;
  const count = await getLeadCount(date);
  const cpl = count > 0 ? won(total / count) : "-";

  let text =
    `📊 광고 보고 (${titleSuffix(date)})\n\n` +
    `총 지출 광고비 : ${won(total)}\n` +
    `총 유입 디비개수 : ${count}개\n` +
    `디비 개당 단가 : ${cpl}`;

  if (errors.length) text += `\n\n⚠️ ${errors.join("\n⚠️ ")}`;

  await reply(chatId, text, msgId);
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

// 🧾 정산 보고
async function handleSettle(chatId, msgId, date) {
  const label = `* ${shortLabel(date)}`;

  const rows = await getSettleRows(date);
  if (!rows.length) {
    await reply(chatId, `${label}\n\n입력된 정산이 없습니다.`, msgId);
    return;
  }

  // tr이 있을 때만 환율 조회
  let manPerTr = null;
  let rateError = "";
  if (rows.some((r) => r.unit === "tr")) {
    try {
      manPerTr = await getManPerTr();
    } catch (e) {
      rateError = e.message;
    }
  }

  // 한 줄 금액 표시 + 만원 환산값
  const amountOf = (r) => {
    if (r.unit === "tr") {
      if (manPerTr === null) return { text: `${r.amount}tr`, man: 0 };
      const m = r.amount * manPerTr;
      return { text: `${r.amount}tr (약 ${man(m)})`, man: m };
    }
    return { text: man(r.amount), man: r.amount };
  };

  const lineOf = (r) => {
    const a = amountOf(r);
    let t = r.item;
    if (r.name) t += ` (${r.name})`;
    if (r.note) t += ` ${r.note}`;
    return { text: `${t} - ${a.text}`, man: a.man };
  };

  const income = rows.filter((r) => r.type === "수입").map(lineOf);
  const expense = rows.filter((r) => r.type === "지출").map(lineOf);

  const incomeTotal = income.reduce((s, l) => s + l.man, 0);
  const expenseTotal = expense.reduce((s, l) => s + l.man, 0);

  let text = `${label}\n\n수입\n\n`;
  text += income.length
    ? income.map((l, i) => `${i + 1}. ${l.text}`).join("\n")
    : "없음";
  text += `\n\n수입 총 ${man(incomeTotal)}\n\n지출\n\n`;
  text += expense.length ? expense.map((l) => l.text).join("\n") : "없음";
  text += `\n\n지출 총 ${man(expenseTotal)}\n\n총 ${man(incomeTotal - expenseTotal)}`;

  if (manPerTr !== null) {
    text += `\n\n(환율 1tr ≈ ${manPerTr.toFixed(1)}만원, 현재 환율 기준)`;
  } else if (rateError) {
    text += `\n\n⚠️ ${rateError} — tr 금액은 합계에서 빠졌습니다.`;
  }

  await reply(chatId, text, msgId);
}

// /메뉴
async function handleMenu(chatId, msgId) {
  // 입력창 버튼: 켜거나 끄기
  if (useKeyboard) {
    await reply(chatId, "아래 버튼으로 보고를 확인하세요.\n날짜별 보기: /정산 11/13, /상담 어제", msgId, true);
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

// /삭제 (디비 알림 메시지에 답장)
async function handleDelete(chatId, msg) {
  const target = msg.reply_to_message;
  if (!target) {
    await reply(chatId, "삭제할 디비 알림 메시지에 답장으로 /삭제 를 입력해주세요.", msg.message_id);
    return;
  }

  const res = await fetch(
    `${SB_URL}/rest/v1/report_leads?tg_message_id=eq.${target.message_id}`,
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
    if (cq.data === "ads") await handleAds(chatId, null, today);
    else if (cq.data === "consult") await handleConsult(chatId, null, today);
    else if (cq.data === "settle") await handleSettle(chatId, null, today);
  } catch (err) {
    console.error("button error:", err);
    await reply(chatId, "⚠️ 처리 중 오류: " + err.message);
  }
}

// 보고 명령어 처리 (날짜 붙은 것 포함)
async function runReport(chatId, msgId, handler, arg) {
  const date = parseDateArg(arg);
  if (!date) {
    await reply(chatId, "날짜 형식을 확인해주세요. 예: /정산 11/13, /상담 어제", msgId);
    return;
  }
  await handler(chatId, msgId, date);
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
  if (chatId !== LEAD_CHAT && chatId !== REPORT_CHAT) {
    return { statusCode: 200, body: "OK" };
  }

  // "/광고@WomanDB3bot 11/13" 같은 형태도 처리
  const text = msg.text.trim().replace(/@\w+/, "");
  const arg = text.replace(/^\/\S+/, "").trim(); // 명령어 뒤 날짜 부분
  const id = msg.message_id;

  try {
    if (chatId === REPORT_CHAT) {
      if (text.startsWith("/광고")) await runReport(chatId, id, handleAds, arg);
      else if (text.startsWith("/상담")) await runReport(chatId, id, handleConsult, arg);
      else if (text.startsWith("/정산")) await runReport(chatId, id, handleSettle, arg);
      else if (text === BTN_ADS) await handleAds(chatId, id, kstToday());
      else if (text === BTN_CONSULT) await handleConsult(chatId, id, kstToday());
      else if (text === BTN_SETTLE) await handleSettle(chatId, id, kstToday());
      else if (text.startsWith("/메뉴") || text.startsWith("/start")) await handleMenu(chatId, id);
    } else {
      if (text.startsWith("/보고")) await runReport(chatId, id, handleAds, arg);
      else if (text.startsWith("/삭제")) await handleDelete(chatId, msg);
    }
  } catch (err) {
    console.error("bot error:", err);
    await reply(chatId, "⚠️ 처리 중 오류: " + err.message, id);
  }

  return { statusCode: 200, body: "OK" };
};
