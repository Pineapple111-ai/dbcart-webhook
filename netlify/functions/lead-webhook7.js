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
    const { name, phone, date, time } = params;

    if (!name && !phone) {
      return { statusCode: 200, body: "OK (ping)" };
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID_7 = "-5375256472";

    const applyTime = formatApplyTime(date, time);
    const message = `📩 새 리드 접수\n\n이름: ${name || "-"}\n연락처: ${phone || "-"}\n신청시각: ${applyTime}`;

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID_7, text: message }),
    });

    return { statusCode: 200, body: "OK" };
  } catch (err) {
    return { statusCode: 500, body: String(err) };
  }
};
