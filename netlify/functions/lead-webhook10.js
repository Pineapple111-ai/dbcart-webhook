// 디비 (가전공구) 그룹 알림용 — LG / 삼성 공용
const CHAT_ID = "-5235472796";

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

// Supabase에 디비 1건 기록 (/보고 집계용)
async function saveLead(row) {
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/gajeon_leads`, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
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
  const brand = params.brand || "LG";
  const name = params.name || "-";
  const phone = params.phone || "-";
  const option = (params.option || "")
    .split(/[,|\/]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ") || "-";
  const applyTime = formatApplyTime(params.date, params.time);

  const text =
    `📥 신규 DB 접수 [${brand}]\n\n` +
    `이름: ${name}\n` +
    `연락처: ${phone}\n` +
    `패키지 옵션: ${option}\n` +
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

  const saved = await saveLead({
    brand,
    name,
    phone,
    option: option === "-" ? null : option,
    tg_message_id: messageId,
  });

  if (debug) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: `telegram: ${result}\n\ndb: ${saved}`,
    };
  }

  return { statusCode: 200, body: "OK" };
};
