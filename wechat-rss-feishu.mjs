#!/usr/bin/env node
// wechat-rss-feishu: follow WeChat Official Accounts as an RSS file and/or Feishu (Lark) group messages.
//
//   node wechat-rss-feishu.mjs resolve "https://mp.weixin.qq.com/s/xxxx"     # an article link -> the account's gh_ id (12 credits)
//   node wechat-rss-feishu.mjs hosted gh_xxxxxxxxxxxx --name "某公众号"       # we run it daily; RSS address + optional Feishu push
//   node wechat-rss-feishu.mjs sync                                          # you run it: reads accounts.json, writes feed.xml, pushes to Feishu
//
// The API key comes only from the environment variable SOCIALTOAI_API_KEY and only goes in a request header.
// The Feishu address and its signing secret come only from FEISHU_WEBHOOK_URL and FEISHU_SECRET.
// Zero dependencies, Node 18+. MIT licence. Published by the SocialToAI team.

import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_API = "https://api.socialtoai.com/v1";
const CREDITS_USER_POSTS = 12; // wechat.user_posts on 2026-11-05: a page of about 10 pushes, each of which can hold several articles
const CREDITS_DETAIL = 12; // wechat.detail on 2026-11-05
const USD_PER_CREDIT = 10 / 3000; // the $10 pack
const FEISHU_HOSTS = ["open.feishu.cn", "open.larksuite.com"];
const SEEN_LIMIT = 500;

export function isAccountId(s) {
  return /^gh_[0-9a-zA-Z]+$/.test(String(s));
}

export function escapeXml(s) {
  return String(s ?? "")
    // XML 1.0 forbids most control characters, and article titles sometimes carry them.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** RSS 2.0 from the entries the state keeps, newest first. Title, digest and link only: the article stays with its author. */
export function renderRss(entries, { title = "WeChat Official Accounts", now = new Date() } = {}) {
  const items = [...entries]
    .sort((a, b) => String(b.published_at ?? "").localeCompare(String(a.published_at ?? "")))
    .map((e) => {
      const date = e.published_at ? new Date(e.published_at) : null;
      return [
        "    <item>",
        `      <title>${escapeXml(e.title ?? "(no title)")}</title>`,
        `      <link>${escapeXml(e.url)}</link>`,
        `      <guid isPermaLink="false">${escapeXml(e.key)}</guid>`,
        date && !Number.isNaN(date.getTime()) ? `      <pubDate>${date.toUTCString()}</pubDate>` : null,
        `      <category>${escapeXml(e.account)}</category>`,
        e.digest ? `      <description>${escapeXml(e.digest)}</description>` : null,
        "    </item>",
      ].filter(Boolean).join("\n");
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>${escapeXml(title)}</title>\n    <link>https://mp.weixin.qq.com/</link>\n    <description>New articles, read from public WeChat Official Accounts.</description>\n    <lastBuildDate>${now.toUTCString()}</lastBuildDate>\n${items}\n  </channel>\n</rss>\n`;
}

/** Feishu's signature for a custom bot: base64 of HMAC-SHA256 over nothing, keyed by "timestamp\nsecret". */
export function feishuSign(timestamp, secret) {
  return createHmac("sha256", `${timestamp}\n${secret}`).update("").digest("base64");
}

export function feishuMessage(entries, { timestamp, secret } = {}) {
  const lines = entries.slice(0, 10).map((e) => [{ tag: "a", text: e.title ?? e.url, href: e.url }, { tag: "text", text: `  (${e.account})` }]);
  if (entries.length > 10) lines.push([{ tag: "text", text: `And ${entries.length - 10} more in the feed.` }]);
  const body = { msg_type: "post", content: { post: { zh_cn: { title: `公众号新文章 ${entries.length} 篇`, content: lines } } } };
  if (secret) {
    body.timestamp = String(timestamp);
    body.sign = feishuSign(timestamp, secret);
  }
  return body;
}

export function checkFeishuUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return "FEISHU_WEBHOOK_URL is not an address.";
  }
  if (u.protocol !== "https:" || !FEISHU_HOSTS.includes(u.hostname) || !u.pathname.startsWith("/open-apis/bot/v2/hook/")) {
    return "FEISHU_WEBHOOK_URL must be a Feishu or Lark custom bot address (https://open.feishu.cn/open-apis/bot/v2/hook/...).";
  }
  return null;
}

/** WeChat hands out http links; the same host answers https. */
export function secureLink(url) {
  return String(url).replace(/^http:\/\/mp\.weixin\.qq\.com\//i, "https://mp.weixin.qq.com/");
}

/** The articles in this answer that the state has not seen, and the state with them added. */
export function takeNew(items, account, state) {
  const seen = new Set(state.seen ?? []);
  const fresh = [];
  for (const it of items) {
    const key = it.id ?? it.url;
    if (!key || !it.url || seen.has(key)) continue;
    seen.add(key);
    fresh.push({ key, url: secureLink(it.url), title: it.title ?? null, digest: it.text ?? null, published_at: it.published_at ?? null, account });
  }
  const entries = [...fresh, ...(state.entries ?? [])].slice(0, 200);
  return { fresh, state: { seen: [...seen].slice(-SEEN_LIMIT), entries } };
}

async function call(base, key, method, path, body, { idempotency } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "wechat-rss-feishu/1.0", ...(idempotency ? { "Idempotency-Key": idempotency } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json };
}

/** Plain words for a refusal. The first page of an answer can also carry status: "error" under HTTP 200. */
export function refusal(res) {
  const e = res.json?.error;
  if (!e) return null;
  const help = {
    unauthorized: "Set SOCIALTOAI_API_KEY to a current key. Create one at https://socialtoai.com/console/keys/ (signing up gives 100 free credits, no card).",
    insufficient_balance: "The balance is too low. Buy credits at https://socialtoai.com/console/billing/ and run again; nothing already saved is lost.",
    plan_limit: "A free account keeps 1 schedule. Buy credits at https://socialtoai.com/console/billing/ or delete the one it has.",
    key_scope_denied: "This key lacks a permission. Turn it on in the key's settings at https://socialtoai.com/console/keys/ .",
  }[e.code];
  return `${e.code}: ${help ?? e.message ?? "no details"}${e.fix?.note && !help ? ` ${e.fix.note}` : ""} Nothing was charged.${res.json?.request_id ? ` (request ${res.json.request_id})` : ""}`;
}

function needKey(env) {
  if (!env.SOCIALTOAI_API_KEY) throw new Error("Set SOCIALTOAI_API_KEY first. Create a key at https://socialtoai.com/console/keys/ (signing up gives 100 free credits, no card).");
  return env.SOCIALTOAI_API_KEY;
}

function apiBase(env) {
  const base = (env.SOCIALTOAI_API_BASE ?? DEFAULT_API).replace(/\/$/, "");
  if (!base.startsWith("https://") && env.SOCIALTOAI_ALLOW_PLAIN_HTTP !== "1") throw new Error("SOCIALTOAI_API_BASE must be https, so that the key is not sent in the clear.");
  return base;
}

export function parseArgs(argv) {
  const o = { command: argv[0] ?? "help", positional: [], config: "accounts.json", state: "state.json", feed: "feed.xml", name: null, weekly: false, weekday: 1, time: "08:30", timezone: null, maxCredits: 24, email: false, dry: false, printFeed: false };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === "--config") o.config = next();
    else if (a === "--state") o.state = next();
    else if (a === "--feed") o.feed = next();
    else if (a === "--name") o.name = next();
    else if (a === "--weekly") o.weekly = true;
    else if (a === "--weekday") o.weekday = Number(next());
    else if (a === "--time") o.time = next();
    else if (a === "--timezone") o.timezone = next();
    else if (a === "--max-credits") o.maxCredits = Number(next());
    else if (a === "--email") o.email = true;
    else if (a === "--dry-run") o.dry = true;
    else if (a === "--print-feed") o.printFeed = true;
    else if (a === "--api-key" || a === "--key" || a === "--webhook") throw new Error("Keys and webhook addresses are read only from the environment, so they stay out of your shell history.");
    else if (a.startsWith("--")) throw new Error(`Unknown option ${a}`);
    else o.positional.push(a);
  }
  return o;
}

const HELP = `wechat-rss-feishu: follow WeChat Official Accounts as RSS and Feishu messages

  resolve <article link>      the account's gh_ id, from one of its articles (12 credits)
  hosted <gh_id> [--name X]   a schedule we run: gives an RSS address; pushes to Feishu if FEISHU_WEBHOOK_URL is set
       [--weekly] [--weekday 0-6] [--time HH:MM] [--timezone ZONE] [--max-credits N] [--email] [--print-feed] [--dry-run]
  sync                        you run it: accounts.json -> feed.xml, state.json, optional Feishu
       [--config accounts.json] [--state state.json] [--feed feed.xml] [--dry-run]

Environment: SOCIALTOAI_API_KEY, FEISHU_WEBHOOK_URL, FEISHU_SECRET (optional, for a bot with signature check; sync only).
Each read of an account is 12 credits. Current prices: https://api.socialtoai.com/v1/capabilities
`;

async function resolve(o, env, log) {
  const link = o.positional[0];
  if (!link) throw new Error("resolve needs an article link.");
  const res = await call(apiBase(env), needKey(env), "POST", "/detail", { platform: "wechat", url: link }, { idempotency: randomUUID() });
  const why = refusal(res);
  if (why) {
    log(why);
    return 1;
  }
  const item = res.json?.items?.[0];
  if (!item?.author?.id) {
    log(`No account ID in this answer (status ${res.json?.status ?? res.status}).`);
    return 1;
  }
  log(`${item.author.id}  ${item.author.name ?? ""}`.trim());
  if (res.json?.billing?.display) log(res.json.billing.display);
  return 0;
}

async function hosted(o, env, log) {
  const id = o.positional[0];
  if (!isAccountId(id)) throw new Error("hosted needs an account ID starting with gh_. Get one with: resolve <article link>.");
  const frequency = o.weekly ? "weekly" : "daily";
  const webhook = env.FEISHU_WEBHOOK_URL;
  if (webhook) {
    const bad = checkFeishuUrl(webhook);
    if (bad) throw new Error(bad);
    if (env.FEISHU_SECRET) log("Note: the hosted push cannot sign messages. In the bot's settings use the keyword SocialToAI instead of a signature check, or use sync, which signs.");
  }
  const cap = CREDITS_USER_POSTS * (o.weekly ? 5 : 31);
  log(`Schedule: ${frequency} at ${o.time}, reads ${id}. ${CREDITS_USER_POSTS} credits a run at today's price, at most ${cap} credits a month (about $${(cap * USD_PER_CREDIT).toFixed(2)} on the $10 pack).`);
  if (o.dry) {
    log("Nothing was sent (--dry-run).");
    return 0;
  }
  const body = {
    name: (o.name ?? id).slice(0, 80),
    action: "user_posts",
    input: { platform: "wechat", id },
    frequency,
    time: o.time,
    timezone: o.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Asia/Shanghai",
    max_credits_per_run: o.maxCredits,
    ...(o.weekly ? { weekday: o.weekday } : {}),
    ...(o.email ? { email_new_items: true } : {}),
    ...(webhook ? { push_url: webhook } : {}),
  };
  const res = await call(apiBase(env), needKey(env), "POST", "/schedules", body);
  const why = refusal(res);
  if (why) {
    log(why);
    return 1;
  }
  const s = res.json?.schedule;
  log(`Made schedule ${s?.id}. Next run: ${s?.next_run_at}.`);
  if (webhook) log(`Feishu: ${s?.push ? "connected; a test message went to the chat" : "not connected"}.`);
  if (o.printFeed) log(`RSS: ${s?.feed?.rss}`);
  else log("Its RSS address is private. Show it with --print-feed on a new schedule, or on the console's Tasks page: https://socialtoai.com/console/");
  return 0;
}

async function sync(o, env, log) {
  if (!existsSync(o.config)) throw new Error(`No ${o.config}. Copy accounts.example.json and fill it in.`);
  const config = JSON.parse(readFileSync(o.config, "utf8"));
  const accounts = config.accounts ?? [];
  if (!Array.isArray(accounts) || accounts.length === 0) throw new Error(`${o.config} lists no accounts.`);
  for (const a of accounts) if (!isAccountId(a.id)) throw new Error(`"${a.id}" is not an account ID (gh_...). Get one with: resolve <article link>.`);

  const webhook = env.FEISHU_WEBHOOK_URL;
  if (webhook) {
    const bad = checkFeishuUrl(webhook);
    if (bad) throw new Error(bad);
  }
  log(`Reading ${accounts.length} account(s): ${accounts.length * CREDITS_USER_POSTS} credits at today's price.`);
  if (o.dry) {
    log("Nothing was sent (--dry-run).");
    return 0;
  }

  const key = needKey(env);
  const base = apiBase(env);
  let state = existsSync(o.state) ? JSON.parse(readFileSync(o.state, "utf8")) : { seen: [], entries: [] };
  const firstRun = (state.seen ?? []).length === 0;
  const fresh = [];
  let failed = 0;
  let charged = 0;
  for (const a of accounts) {
    const res = await call(base, key, "POST", "/user_posts", { platform: "wechat", id: a.id }, { idempotency: randomUUID() });
    const why = refusal(res);
    if (why) {
      failed++;
      log(`${a.name ?? a.id}: ${why}`);
      if (res.json?.error?.code === "unauthorized" || res.json?.error?.code === "insufficient_balance") break;
      continue;
    }
    charged += res.json?.cost_credits ?? 0;
    const result = takeNew(res.json?.items ?? [], a.name ?? a.id, state);
    state = result.state;
    fresh.push(...result.fresh);
    log(`${a.name ?? a.id}: ${result.fresh.length} new.`);
  }

  // Save before pushing: a chat that is down must not make the next run pay for the same articles again.
  const tmp = `${o.state}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, o.state);
  writeFileSync(o.feed, renderRss(state.entries ?? [], { title: config.title ?? "WeChat Official Accounts" }));
  log(`Wrote ${o.feed}. Charged ${charged} credits.`);

  if (webhook && fresh.length && !firstRun) {
    const timestamp = Math.floor(Date.now() / 1000);
    const res = await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(feishuMessage(fresh, { timestamp, secret: env.FEISHU_SECRET })) });
    const answer = await res.json().catch(() => ({}));
    if (!res.ok || (answer.code ?? 0) !== 0) {
      log(`Feishu did not take the message: ${answer.msg ?? `HTTP ${res.status}`}. Check the bot's address, keyword and signature settings. The articles are saved in the feed.`);
      return 1;
    }
    log(`Sent ${fresh.length} to Feishu.`);
  } else if (webhook && firstRun && fresh.length) {
    log(`First run: ${fresh.length} articles saved as the starting point, not pushed. The next run pushes what is new.`);
  }
  return failed ? 1 : 0;
}

export async function main(argv, env = process.env, log = console.log) {
  const o = parseArgs(argv);
  if (o.command === "resolve") return resolve(o, env, log);
  if (o.command === "hosted") return hosted(o, env, log);
  if (o.command === "sync") return sync(o, env, log);
  log(HELP);
  return o.command === "help" || o.command === "--help" || o.command === "-h" ? 0 : 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err.message);
      process.exit(2);
    },
  );
}

export { CREDITS_DETAIL };
