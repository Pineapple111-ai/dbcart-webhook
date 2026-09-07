exports.handler = async () => {
  await fetch("https://genuine-crostata-ce0a64.netlify.app/.netlify/functions/lead-webhook");
  return { statusCode: 200, body: "warm" };
};

exports.config = {
  schedule: "*/10 * * * *"
};
