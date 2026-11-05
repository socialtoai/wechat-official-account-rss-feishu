# WeChat Official Accounts to RSS and Feishu

[中文](README.md)

WeChat's own APIs manage your own Official Account and do not read other accounts' articles. This small tool uses the SocialToAI API to read the public article lists of the accounts you follow, and turns new articles into an RSS feed and Feishu (Lark) group messages. **No WeChat account of yours, no QR code, no machine left running. It reads public content only.**

Published by the SocialToAI team. The tool is open source (MIT). Reading goes through our paid API, and each read costs credits, listed below.

## Two ways to run it

| | A. We run it (try this first) | B. You run it |
| --- | --- | --- |
| Where it runs | SocialToAI, on schedule; no server | Your machine or GitHub Actions |
| RSS | A private feed address for your reader | Writes `feed.xml`; host it yourself |
| Feishu | Yes; the bot cannot use a signature check, so use the keyword `SocialToAI` | Yes, including a signature check |
| Item content | Title and start of text for 24 hours, then platform, date and link | Title and link, kept |
| WeCom, Slack | Yes | Not built; change `feishuMessage` if you need it |
| How many accounts | 1 on a free account, up to 20 on a paid one | No limit; you pay per read |

## Step 1: a key and the account's ID

1. Create a key in [the console](https://socialtoai.com/console/keys/?utm_source=github&utm_medium=repo&utm_campaign=wechat-rss-feishu-20261106). Signing up gives 100 free credits, no card. Way A needs the permission to manage schedules. The key is shown once.

   ```bash
   export SOCIALTOAI_API_KEY="<YOUR_API_KEY>"
   ```

2. Find the account's ID, which starts with `gh_`. **Do not search accounts by name: that call is 102 credits.** Pass a link to one of its articles instead, 12 credits:

   ```bash
   node wechat-rss-feishu.mjs resolve "https://mp.weixin.qq.com/s/xxxx"
   ```

Node 18 or newer; no dependencies.

## A. We run it

```bash
node wechat-rss-feishu.mjs hosted gh_xxxxxxxxxxxx --name "An account" --dry-run      # plan and cost, nothing sent
node wechat-rss-feishu.mjs hosted gh_xxxxxxxxxxxx --name "An account" --print-feed   # make it and print the private feed address

export FEISHU_WEBHOOK_URL="https://open.feishu.cn/open-apis/bot/v2/hook/..."
node wechat-rss-feishu.mjs hosted gh_xxxxxxxxxxxx --name "An account" --time 08:30 --timezone Asia/Shanghai
```

In the Feishu group: settings → bots → add a custom bot, with no signature check and no IP allowlist. A keyword check passes with `SocialToAI`. The chat gets one test message when you set it up; if that fails, nothing is saved. Add `--weekly --weekday 1` to read once a week.

## B. You run it

```bash
cp accounts.example.json accounts.json
export FEISHU_WEBHOOK_URL="https://open.feishu.cn/open-apis/bot/v2/hook/..."   # optional
export FEISHU_SECRET="..."                                                     # optional, for a bot with a signature check
node wechat-rss-feishu.mjs sync --dry-run
node wechat-rss-feishu.mjs sync
```

It writes `feed.xml` and `state.json`. The first run records existing articles as a starting point and does not post them; later runs post only what is new. Progress is saved before posting, so a chat that is down does not make you pay twice. `examples/github-actions-sync.yml` (save it as `.github/workflows/sync.yml` in your own repository) is a template for GitHub Actions: use a **private** repository, because the state it commits back shows who you follow.

## Cost

Checked on 2026-11-05 against [`/v1/capabilities`](https://api.socialtoai.com/v1/capabilities), price version `pv_29229c6acba5`. Dollars are on the $10 pack (3,000 credits).

| Price key | What it does | Credits |
| --- | --- | --- |
| `wechat.user_posts` | An account's articles, about 10 pushes a page (a push can hold several) | 12 |
| `wechat.detail` | One article in full; also gives the account's ID | 12 |
| `wechat.search:user` | Find an account by name (not used here) | 102 |

| One account | At most a month | On the $10 pack |
| --- | --- | --- |
| Read daily | 372 credits | $1.24 |
| Read weekly | 60 credits | $0.20 |

100 free credits covers one ID lookup and 7 reads. Failed calls are free; a read that ran and found nothing new is charged.

## What the output looks like

A real `sync` on 2026-11-06, reading one public museum account for 12 credits. That page held 63 articles from 10 pushes (2026-08-21 to 2026-10-30). This is the first item in `feed.xml` (the link's last parameters left out); `category` is the name you gave the account in `accounts.json`:

```text
Reading 1 account(s): 12 credits at today's price.
An account: 63 new.
Wrote feed.xml. Charged 12 credits.
```

```xml
<item>
  <title>上博新展预告丨环宇璀璨：大都会艺术博物馆珠宝珍藏展</title>
  <link>https://mp.weixin.qq.com/s?__biz=MzIyNjA4NDYyNQ==&amp;mid=2652576976&amp;idx=1&amp;sn=d79d6226dc4d5669931e06285ed3085a</link>
  <guid isPermaLink="false">MzIyNjA4NDYyNQ==_2652576976_1</guid>
  <pubDate>Fri, 30 Oct 2026 10:15:14 GMT</pubDate>
  <category>An account</category>
</item>
```

None of the 63 had a summary, so the feed has titles and links only. The first run records them as the starting point and pushes nothing to the group.

## Limits

- **Title and link only.** Article lists usually hold no body or digest, and the tool does not put full text in the feed. Articles belong to their authors; do not use this to republish them.
- **Not real time.** It reads when you say, at most once a day when we run it.
- **About 10 pushes a page.** A push can hold several articles: the account we read had 63 on one page. An account publishing more than a page a day is read for its first page only.
- **Not in the list:** reads, likes and other counts. `wechat.article_stats` (12 credits) reads those for one article.

## Or ask your AI

Connect `https://mcp.socialtoai.com/mcp` to Claude, ChatGPT or Cursor and say: "Every morning, check this Official Account for new articles and post them to this Feishu group." Your AI previews it, quotes the price and makes it only after you agree. [Connect page.](https://socialtoai.com/mcp/?utm_source=github&utm_medium=repo&utm_campaign=wechat-rss-feishu-20261106)

## Tests

```bash
node --test test.mjs   # no network, no key
```

Support: support@socialtoai.com. MIT licence. Published by the SocialToAI team.
