exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const { title, name, phone, date, time } = params;

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    const SHEET_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbw4mqYB-e-MNYbwWxgE0kFqeppeqmyRKA6okDs5s2vB278dwMUgxMOwyhJilzU6CKwN/exec";

    const message = `📩 새 일수 신\n\n이름: ${name || "-"}\n연락처: ${phone || "-"}\n신청시각: ${date || ""} ${time || ""}`;

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
      }),
    });

    const referer = event.headers.referer || event.headers.referrer || "";

    await fetch(SHEET_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name || "",
        phone: phone || "",
        date: date || "",
        time: time || "",
        referer: referer,
      }),
    });

    return { statusCode: 200, body: "OK" };
  } catch (err) {
    return { statusCode: 500, body: String(err) };
  }
};
