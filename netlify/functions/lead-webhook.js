function formatApplyTime(dateStr, timeStr) {
  const parts = (dateStr || "").replace(/\./g, "-").split("-");
  const year = parts[0];
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  const [hourStr, minStr] = (timeStr || "0:00").split(":");
  let hour = parseInt(hourStr, 10);
  const ampm = hour < 12 ? "am" : "pm";
  let hour12 = hour % 12;
  if (hour12 === 0) hour12 = 12;

  return `${year}. ${month}. ${day} ${ampm} ${hour12}:${minStr}`;
}

exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const { title, name, phone, date, time, referer } = params;

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const SHEET_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbw4mqYB-e-MNYbwWxgE0kFqeppeqmyRKA6okDs5s2vB278dwMUgxMOwyhJilzU6CKwN/exec";

    const rawReferer = referer || "";
    let source = rawReferer;
    if (rawReferer.includes("instagram")) {
      source = "ig";
    } else if (rawReferer.includes("facebook") || rawReferer.includes("fb.")) {
      source = "fb";
    }

    const applyTime = formatApplyTime(date, time);
    const message = `📩 새 리드 접수\n\n이름: ${name || "-"}\n연락처: ${phone || "-"}\n신청시각: ${applyTime}`;

    await Promise.all([
      fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: CHAT_ID, text: message }),
      }),
      fetch(SHEET_WEBAPP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || "",
          phone: phone || "",
          date: date || "",
          time: time || "",
          referer: source,
        }),
      }),
    ]);

    return { statusCode: 200, body: "OK" };
  } catch (err) {
    return { statusCode: 500, body: String(err) };
  }
};
