// node --test test.mjs   (no network, no key)
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { isAccountId, renderRss, feishuSign, feishuMessage, checkFeishuUrl, takeNew, secureLink, refusal, parseArgs } from "./wechat-rss-feishu.mjs";

test("account IDs start with gh_", () => {
  assert.ok(isAccountId("gh_13c97ab93ce8"));
  assert.ok(!isAccountId("某公众号"));
  assert.ok(!isAccountId("gh_"));
});

test("WeChat's http links are delivered as https", () => {
  assert.equal(secureLink("http://mp.weixin.qq.com/s?mid=1&idx=1"), "https://mp.weixin.qq.com/s?mid=1&idx=1");
  assert.equal(takeNew([{ id: "a", url: "http://mp.weixin.qq.com/s/a" }], "号", { seen: [], entries: [] }).fresh[0].url, "https://mp.weixin.qq.com/s/a");
});

test("only articles not yet seen count as new, and they are remembered", () => {
  const items = [{ id: "a", url: "https://mp.weixin.qq.com/s/a", title: "A", published_at: "2026-11-01T00:00:00Z" }, { id: "b", url: "https://mp.weixin.qq.com/s/b", title: "B", text: null }];
  const first = takeNew(items, "号", { seen: ["b"], entries: [] });
  assert.deepEqual(first.fresh.map((e) => e.key), ["a"]);
  const second = takeNew(items, "号", first.state);
  assert.equal(second.fresh.length, 0);
});

test("RSS is escaped, newest first, and holds no article body", () => {
  const xml = renderRss(
    [
      { key: "1", url: "https://x/1?a=1&b=2", title: "旧 <标题>", digest: "摘要 & 更多", published_at: "2026-10-01T00:00:00Z", account: "号" },
      { key: "2", url: "https://x/2", title: "新", digest: null, published_at: "2026-11-01T00:00:00Z", account: "号" },
    ],
    { now: new Date("2026-11-05T00:00:00Z") },
  );
  assert.ok(xml.indexOf("新") < xml.indexOf("旧"));
  assert.ok(xml.includes("旧 &lt;标题&gt;"));
  assert.ok(xml.includes("a=1&amp;b=2"));
  assert.ok(xml.includes("摘要 &amp; 更多"));
  assert.ok(!/content:encoded/.test(xml));
});

test("the Feishu signature follows Feishu's custom bot rule", () => {
  const expected = createHmac("sha256", "1700000000\nsecret").update("").digest("base64");
  assert.equal(feishuSign(1700000000, "secret"), expected);
  const body = feishuMessage([{ url: "https://x/1", title: "T", account: "号" }], { timestamp: 1700000000, secret: "secret" });
  assert.equal(body.sign, expected);
  assert.equal(body.timestamp, "1700000000");
  assert.equal(feishuMessage([{ url: "https://x/1", title: "T", account: "号" }]).sign, undefined);
});

test("a long list is cut in the chat, not lost", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ url: `https://x/${i}`, title: `T${i}`, account: "号" }));
  const lines = feishuMessage(many).content.post.zh_cn.content;
  assert.equal(lines.length, 11);
  assert.match(lines[10][0].text, /2 more/);
});

test("only a Feishu or Lark bot address is accepted", () => {
  assert.equal(checkFeishuUrl("https://open.feishu.cn/open-apis/bot/v2/hook/abc"), null);
  assert.ok(checkFeishuUrl("https://example.com/open-apis/bot/v2/hook/abc"));
  assert.ok(checkFeishuUrl("http://open.feishu.cn/open-apis/bot/v2/hook/abc"));
});

test("a refusal is explained, and a success is not", () => {
  assert.equal(refusal({ json: { items: [] } }), null);
  assert.match(refusal({ json: { error: { code: "insufficient_balance" } } }), /Buy credits/);
  assert.match(refusal({ json: { error: { code: "unauthorized" } } }), /100 free credits/);
});

test("keys and webhooks on the command line are refused", () => {
  assert.throws(() => parseArgs(["sync", "--api-key", "x"]), /environment/);
  assert.throws(() => parseArgs(["sync", "--webhook", "x"]), /environment/);
});
