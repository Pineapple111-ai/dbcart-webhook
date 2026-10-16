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

  const name = params.name || "-";
  const phone = params.phone || "-";
  const utm = clean(params.utm);
  const applyTime = formatApplyTime(params.date, params.time);

  const header = utm
    ? `📩 새 리드 접수`
    : `⚠️ 광고유입 아님\n📩 새 리드 접수`;

  const text =
    `${header}\n\n` +
    `이름: ${name}\n` +
    `연락처: ${phone}\n` +
    `신청시각: ${applyTime}`;

  try {
    await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: CHAT_ID, text }),
      }
    );
  } catch (err) {
    console.error("Telegram error:", err);
  }

  return { statusCode: 200, body: "OK" };
};
