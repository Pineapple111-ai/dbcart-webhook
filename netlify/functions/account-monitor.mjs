// 광고계정 감시: 계정 상태 이상 + 광고 켜짐 상태에서 지출 멈춤 감지
// 15분마다 자동 실행, 상태가 바뀔 때만 텔레그램 알림
const CHAT_ID = "-5318830146";
const STALL_MINUTES = 60; // 지출 멈춤 판단 기준 (분)

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const BOT = process.env.TELEGRAM_BOT_TOKEN;

const sbHeaders = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

const ACCOUNTS = [
  { key: "A", id: process.env.META_ACCOUNT_A, token: process.env.META_TOKEN_A },
  { key: "B", id: process.env.META_ACCOUNT_B, token: process.env.META_TOKEN_B },
];

const STATUS_LABEL = {
  1: "정상",
  2: "계정 비활성화",
  3: "미결제 잔액 (결제 실패)",
  7: "위험 검토 대기",
  8: "정산 대기",
  9: "유예 기간",
  100: "폐쇄 대기",
  101: "계정 폐쇄",
  error: "조회 실패 (토큰/권한 확인 필요)",
};

const REASON_LABEL = {
  1: "광고 정책 위반",
  2: "IP 검토",
  3: "결제 위험",
  4: "계정 종료",
  5: "광고 검토",
  6: "비즈니스 무결성 검토",
  7: "영구 폐쇄",
};

const API = "https://graph.facebook.com/v27.0";

async function getJson(url) {
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}

async function checkAccount(acc) {
  const info = await getJson(
    `${API}/act_${acc.id}?fields=name,account_status,disable_reason&access_token=${acc.token}`
  );
  const insights = await getJson(
    `${API}/act_${acc.id}/insights?fields=spend&date_preset=today&access_token=${acc.token}`
  );
  const ads = await getJson(
    `${API}/act_${acc.id}/ads?fields=id&limit=1` +
      `&effective_status=${encodeURIComponent('["ACTIVE"]')}&access_token=${acc.token}`
  );

  return {
    name: info.name,
    status: String(info.account_status),
    reason: info.disable_reason,
    spend: insights.data && insights.data[0] ? Number(insights.data[0].spend) : 0,
    active: Array.isArray(ads.data) && ads.data.length > 0,
  };
}

async function getRow(key) {
  const res = await fetch(`${SB_URL}/rest/v1/account_monitor?account=eq.${key}`, {
    headers: sbHeaders,
  });
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function saveRow(row) {
  await fetch(`${SB_URL}/rest/v1/account_monitor`, {
    method: "POST",
    headers: { ...sbHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
}

async function send(text) {
  await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text }),
  });
}

function won(n) {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

async function runAccount(acc) {
  const now = new Date();
  const row = await getRow(acc.key);

  let cur;
  try {
    cur = await checkAccount(acc);
  } catch (e) {
    cur = { name: `계정${acc.key}`, status: "error", error: e.message };
  }

  const label = `[${cur.name}]`;
  const statusText = STATUS_LABEL[cur.status] || `상태코드 ${cur.status}`;
  const next = {
    account: acc.key,
    status: cur.status,
    last_spend: row ? Number(row.last_spend) : 0,
    last_change: row ? row.last_change : now.toISOString(),
    spend_alerted: row ? row.spend_alerted : false,
  };

  // 1) 계정 상태 변화
  const prevStatus = row ? row.status : "1";
  if (cur.status !== prevStatus) {
    if (cur.status === "1") {
      await send(`✅ ${label} 계정 정상으로 복구되었습니다.`);
    } else {
      let msg = `🚨 ${label} 광고계정 상태 이상\n\n상태: ${statusText}`;
      if (cur.reason && REASON_LABEL[cur.reason]) msg += `\n사유: ${REASON_LABEL[cur.reason]}`;
      if (cur.error) msg += `\n내용: ${cur.error}`;
      msg += `\n\n광고관리자에서 확인해주세요.`;
      await send(msg);
    }
  }

  // 2) 지출 멈춤 (계정 정상 + 켜진 광고 있을 때만)
  if (cur.status !== "1" || !cur.active) {
    next.last_spend = cur.spend || 0;
    next.last_change = now.toISOString();
    next.spend_alerted = false;
  } else if (cur.spend !== next.last_spend) {
    if (next.spend_alerted) {
      await send(`✅ ${label} 광고 지출이 다시 시작되었습니다.`);
    }
    next.last_spend = cur.spend;
    next.last_change = now.toISOString();
    next.spend_alerted = false;
  } else {
    const minutes = (now - new Date(next.last_change)) / 60000;
    if (minutes >= STALL_MINUTES && !next.spend_alerted) {
      await send(
        `⚠️ ${label} 광고가 켜져 있는데 ${STALL_MINUTES}분 동안 지출이 없습니다.\n\n` +
          `오늘 지출: ${won(cur.spend)}\n` +
          `결제 수단, 광고 거부, 일 예산 소진 여부를 확인해주세요.`
      );
      next.spend_alerted = true;
    }
  }

  await saveRow(next);
}

export default async () => {
  for (const acc of ACCOUNTS) {
    try {
      await runAccount(acc);
    } catch (e) {
      console.error(`account ${acc.key} error:`, e);
    }
  }
  return new Response("OK");
};

export const config = {
  schedule: "*/15 * * * *",
};
