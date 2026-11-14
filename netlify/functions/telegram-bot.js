// 디비알림봇 명령어 처리
// - 보고 방: /광고, /상담, /메뉴 (+ 버튼)
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
  keyboard: [[{ text: BTN_ADS }, { text: BTN_CONSULT }]],
  resize_keyboard: true,
  is_persistent: true,
};

// B: 메시지에 붙는 버튼
const INLINE_MENU = {
  inline_keyboard: [[
    { text: BTN_ADS, callback_data: "ads" },
    { text: BTN_CONSULT, callback_data: "consult" },
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

// 한국시간 기준 오늘 자정 (ISO)
function kstTodayStart() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}T00:00:00+09:00`;
}

// 한국시간 현재 시각 표시용 (11/11 15:20)
function kstNowLabel() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const m = now.getUTCMonth() + 1;
  const d = now.getUTCDate();
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  return `${m}/${d} ${hh}:${mm}`;
}

// 원 → "136.1만원 (1,360,841원)"
function won(n) {
  const man = (n / 10000).toFixed(1).replace(/\.0$/, "");
  return `${man}만원 (${Math.round(n).toLocaleString("ko-KR")}원)`;
}

// 메타 광고계정 오늘 지출
async function getSpend(accountId, token) {
  const url =
    `https://graph.facebook.com/v27.0/act_${accountId}/insights` +
    `?fields=spend&date_preset=today&access_token=${token}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.data && json.data[0] ? Number(json.data[0].spend) : 0;
}

// 오늘 디비 개수 (삭제 처리된 건 제외)
async function getLeadCount() {
  const since = encodeURIComponent(kstTodayStart());
  const url =
    `${SB_URL}/rest/v1/report_leads` +
    `?select=id&deleted=eq.false&created_at=gte.${since}`;
  const res = await fetch(url, {
    headers: { ...sbHeaders, Prefer: "count=exact", Range: "0-0" },
  });
  const range = res.headers.get("content-range") || "";
  return Number(range.split("/")[1] || 0);
}

// 오늘 디비 상태 목록 (삭제 처리된 건 제외)
async function getTodayLeads() {
  const since = encodeURIComponent(kstTodayStart());
  const url =
    `${SB_URL}/rest/v1/report_leads` +
    `?select=kakao,kakao_reply,call_status,result` +
    `&deleted=eq.false&created_at=gte.${since}`;
  const res = await fetch(url, { headers: sbHeaders });
  if (!res.ok) throw new Error("Supabase " + res.status);
  return res.json();
}

// 메시지 보내기 (입력창 버튼 사용 시 보고 방에 같이 표시)
async function reply(chatId, text, replyTo) {
  const body = { chat_id: chatId, text };
  if (replyTo) body.reply_to_message_id = replyTo;
  if (chatId === REPORT_CHAT && useKeyboard) {
    body.reply_markup = REPLY_KEYBOARD;
  }
  return tg("sendMessage", body);
}

// 📊 광고 보고
async function handleAds(chatId, msgId) {
  let spendA = 0;
  let spendB = 0;
  const errors = [];

  try {
    spendA = await getSpend(process.env.META_ACCOUNT_A, process.env.META_TOKEN_A);
  } catch (e) {
    errors.push("계정A 조회 실패: " + e.message);
  }
  try {
    spendB = await getSpend(process.env.META_ACCOUNT_B, process.env.META_TOKEN_B);
  } catch (e) {
    errors.push("계정B 조회 실패: " + e.message);
  }

  const total = spendA + spendB;
  const count = await getLeadCount();
  const cpl = count > 0 ? won(total / count) : "-";

  let text =
    `📊 오늘 광고 보고 (${kstNowLabel()} 기준)\n\n` +
    `오늘 총 지출 광고비 : ${won(total)}\n` +
    `오늘 총 유입 디비개수 : ${count}개\n` +
    `디비 개당 단가 : ${cpl}`;

  if (errors.length) text += `\n\n⚠️ ${errors.join("\n⚠️ ")}`;

  await reply(chatId, text, msgId);
}

// 💬 상담 보고
async function handleConsult(chatId, msgId) {
  const rows = await getTodayLeads();
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
    `💬 오늘 상담 현황 (${kstNowLabel()} 기준)\n\n` +
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

// /메뉴
async function handleMenu(chatId, msgId) {
  // 입력창 버튼: 켜거나 끄기
  if (useKeyboard) {
    await reply(chatId, "아래 버튼으로 보고를 확인하세요.", msgId);
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

// 고정 메뉴 버튼을 눌렀을 때
async function handleButton(cq) {
  const chatId = String(cq.message.chat.id);
  await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "불러오는 중..." });

  if (chatId !== REPORT_CHAT) return;

  try {
    if (cq.data === "ads") await handleAds(chatId);
    else if (cq.data === "consult") await handleConsult(chatId);
  } catch (err) {
    console.error("button error:", err);
    await reply(chatId, "⚠️ 처리 중 오류: " + err.message);
  }
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

  // "/광고@WomanDB3bot" 같은 형태도 처리
  const text = msg.text.trim().replace(/@\w+/, "");

  try {
    if (chatId === REPORT_CHAT) {
      if (text.startsWith("/광고") || text === BTN_ADS) {
        await handleAds(chatId, msg.message_id);
      } else if (text.startsWith("/상담") || text === BTN_CONSULT) {
        await handleConsult(chatId, msg.message_id);
      } else if (text.startsWith("/메뉴") || text.startsWith("/start")) {
        await handleMenu(chatId, msg.message_id);
      }
    } else {
      if (text.startsWith("/보고")) {
        await handleAds(chatId, msg.message_id);
      } else if (text.startsWith("/삭제")) {
        await handleDelete(chatId, msg);
      }
    }
  } catch (err) {
    console.error("bot error:", err);
    await reply(chatId, "⚠️ 처리 중 오류: " + err.message, msg.message_id);
  }

  return { statusCode: 200, body: "OK" };
};
