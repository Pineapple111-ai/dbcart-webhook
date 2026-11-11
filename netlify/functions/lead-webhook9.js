// 여성전용 1금융권 대출 랜딩 알림용
const CHAT_ID = "-5318830146";

function formatApplyTime(date, time) {
  let y, m, d, hh, mm;
  const dm = (date || "").match(/(\d{4})\D*(\d{1,2})\D*(\d{1,2})/);
  const tm = (time || "").match(/(\d{1,2}):(\d{1,2})/);
  if (dm && tm) {
    [, y, m, d] = dm.map(Number);
    [, hh, mm] = tm.map(Number);
  } else {
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // KST
    y = now.getUTCFullYear();
    m = now.getUTCMonth() + 1;
    d = now.getUTCDate();
    hh = now.getUTCHours();
    mm = now.getUTCMinutes();
  }
  const ampm = hh < 12 ? "am" : "pm";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${y}. ${m}. ${d} ${ampm} ${h12}:${String(mm).padStart(2, "0")}`;
}

function clean(v) {
  const s = (v || "").trim();
  // 값이 없어서 예약어가 그대로 넘어온 경우도 빈 값으로 처리
  return s.startsWith("{#") ? "" : s;
}

// 인스타그램·페이스북 앱 안에서 열린 경우
function isMetaApp(agent) {
  return /Instagram|FBAN|FBAV|FB_IAB/i.test(agent);
}

// Supabase에 디비 1건 기록 (/보고 집계용)
async function saveLead(name, phone, messageId) {
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/report_leads`, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        name,
        phone,
        tg_message_id: messageId,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error("Supabase rejected:", t);
      return "supabase error: " + t;
    }
    return "saved";
  } catch (err) {
    console.error("Supabase error:", err);
    return "supabase fetch error: " + err.message;
  }
}

exports.handler = async (event) => {
  let params = { ...(event.queryStringParameters || {}) };

  if (event.body) {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    try {
      Object.assign(params, JSON.parse(raw));
    } catch {
      Object.assign(params, Object.fromEntries(new URLSearchParams(raw)));
    }
  }

  const debug = params.debug === "1";
  const name = params.name || "-";
  const phone = params.phone || "-";
  const utm = clean(params.utm);
  const agent = clean(params.agent);
  const applyTime = formatApplyTime(params.date, params.time);

  const fromAd = utm || isMetaApp(agent);

  const header = fromAd
    ? `📩 새 리드 접수`
    : `⚠️ 광고유입 아님\n📩 새 리드 접수`;

  const text =
    `${header}\n\n` +
    `이름: ${name}\n` +
    `연락처: ${phone}\n` +
    `신청시각: ${applyTime}`;

  let result = "";
  let messageId = null;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: CHAT_ID, text }),
      }
    );
    result = await res.text();
    if (!res.ok) {
      console.error("Telegram rejected:", result);
    } else {
      try {
        messageId = JSON.parse(result).result.message_id;
      } catch {}
    }
  } catch (err) {
    result = "fetch error: " + err.message;
    console.error("Telegram error:", err);
  }

  const saved = await saveLead(name, phone, messageId);

  if (debug) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body:
        `fromAd: ${fromAd ? "yes" : "no"}\n` +
        `agent: ${agent}\n\n` +
        `telegram: ${result}\n\n` +
        `db: ${saved}`,
    };
  }

  return { statusCode: 200, body: "OK" };
};
