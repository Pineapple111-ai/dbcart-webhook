// 디비알림봇 명령어 처리 (/보고, /삭제)
// 여성전용 1금융권 대출 방에서만 동작
const CHAT_ID = "-5318830146";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const BOT = process.env.TELEGRAM_BOT_TOKEN;

const sbHeaders = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

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

// 텔레그램 메시지 보내기
async function reply(text, replyTo) {
  await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      reply_to_message_id: replyTo,
    }),
  });
}

async function handleReport(msgId) {
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

  await reply(text, msgId);
}

async function handleDelete(msg) {
  const target = msg.reply_to_message;
  if (!target) {
    await reply("삭제할 디비 알림 메시지에 답장으로 /삭제 를 입력해주세요.", msg.message_id);
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
    await reply(`🗑 디비 개수에서 제외했습니다. (${rows[0].name || "-"})`, msg.message_id);
  } else {
    await reply("이 메시지에 해당하는 디비를 찾지 못했습니다.", msg.message_id);
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

  const msg = update.message;
  if (!msg || !msg.text || String(msg.chat.id) !== CHAT_ID) {
    return { statusCode: 200, body: "OK" };
  }

  const text = msg.text.trim();

  try {
    if (text.startsWith("/보고")) {
      await handleReport(msg.message_id);
    } else if (text.startsWith("/삭제")) {
      await handleDelete(msg);
    }
  } catch (err) {
    console.error("bot error:", err);
    await reply("⚠️ 처리 중 오류: " + err.message, msg.message_id);
  }

  return { statusCode: 200, body: "OK" };
};
