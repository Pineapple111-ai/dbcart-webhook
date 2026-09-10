exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const text = body.text;

    if (!text) {
      return { statusCode: 400, body: "메시지가 비어있습니다" };
    }

    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID_3 = "-5371906829";

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID_3,
        text: text,
      }),
    });

    return { statusCode: 200, body: "OK" };
  } catch (err) {
    return { statusCode: 500, body: String(err) };
  }
};
