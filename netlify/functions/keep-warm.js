exports.handler = async () => {
   await fetch("https://db-webhook-service.netlify.app/.netlify/functions/lead-webhook");
  return { statusCode: 200, body: "warm" };
};

exports.config = {
  schedule: "*/10 * * * *"
};
