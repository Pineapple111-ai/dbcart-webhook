exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const { title, name, phone, date, time } = params;

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    const message = `📩 새 리드 접수\n\n이름: ${name || "-"}\n연락처: ${phone || "-"}\n신청시각: ${date || ""} ${time || ""}`;

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
      }),
    });

    return { statusCode: 200, body: "OK" };
  } catch (err) {
    return { statusCode: 500, body: String(err) };
  }
};
