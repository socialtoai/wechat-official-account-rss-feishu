# 公众号转 RSS 和飞书：关注的公众号有新文章，自动进阅读器和飞书群

[English](README.en.md)

微信官方接口只管理你自己的公众号，读不了别人的文章。这个小工具用 SocialToAI 的 API 读公开的公众号文章列表，把新文章变成 RSS，发到飞书群。**不用你的微信账号，不用扫码，也不用一台一直开着的电脑。只读公开内容。**

SocialToAI 团队发布。工具本身开源（MIT），读取走我们的付费 API，每次读取都要花积分，费用写在下面。

## 两种跑法，先选一种

| | A. 我们替你跑（推荐先试） | B. 你自己跑 |
| --- | --- | --- |
| 运行在哪 | SocialToAI 按时运行，不用服务器 | 你的电脑或 GitHub Actions |
| RSS | 私有订阅地址，放进阅读器 | 生成 `feed.xml`，自己放到能访问的地方 |
| 飞书 | 支持；机器人不能开签名校验，用关键词 `SocialToAI` | 支持，也支持签名校验 |
| 条目内容 | 24 小时内有标题和开头，之后只留平台、日期和链接 | 一直保留标题和链接 |
| 企业微信、Slack | 支持 | 没做，需要的话改一下 `feishuMessage` |
| 账号数量 | 免费账户 1 个，付费账户最多 20 个 | 不限，按读取次数付费 |

## 第一步：拿到 Key 和公众号 ID

1. 在[控制台](https://socialtoai.com/console/keys/?utm_source=github&utm_medium=repo&utm_campaign=wechat-rss-feishu-20261106)创建 Key（注册送 100 积分，不用绑卡；A 跑法要打开“管理定时任务”权限）。Key 只显示一次。

   ```bash
   export SOCIALTOAI_API_KEY="<YOUR_API_KEY>"
   ```

2. 找公众号 ID（`gh_` 开头）。**别按名字搜账号，那个调用 102 积分。** 贴一篇这个公众号的文章链接，12 积分：

   ```bash
   node wechat-rss-feishu.mjs resolve "https://mp.weixin.qq.com/s/xxxx"
   ```

需要 Node 18 或更新版本，没有依赖。

## A. 我们替你跑

```bash
# 只放进 RSS：先看计划和费用，不发送
node wechat-rss-feishu.mjs hosted gh_xxxxxxxxxxxx --name "某公众号" --dry-run
# 真正创建，并打印私有订阅地址（只在创建时打印）
node wechat-rss-feishu.mjs hosted gh_xxxxxxxxxxxx --name "某公众号" --print-feed

# 同时发到飞书群
export FEISHU_WEBHOOK_URL="https://open.feishu.cn/open-apis/bot/v2/hook/..."
node wechat-rss-feishu.mjs hosted gh_xxxxxxxxxxxx --name "某公众号" --time 08:30 --timezone Asia/Shanghai
```

飞书群设置：群设置 → 机器人 → 添加机器人 → 自定义机器人。不要开签名校验和 IP 白名单；关键词校验填 `SocialToAI` 可以通过。创建时群里会收到一条测试消息，收不到就不会保存。

每周一次比每天一次省很多：加 `--weekly --weekday 1`。很多公众号一周只更新几次。

## B. 你自己跑

```bash
cp accounts.example.json accounts.json   # 填上公众号 ID 和名字
export FEISHU_WEBHOOK_URL="https://open.feishu.cn/open-apis/bot/v2/hook/..."   # 可选
export FEISHU_SECRET="..."                                                     # 可选，机器人开了签名校验时才要
node wechat-rss-feishu.mjs sync --dry-run   # 看要花多少
node wechat-rss-feishu.mjs sync
```

它会写出 `feed.xml` 和 `state.json`。第一次运行只把现有文章记作起点，不往群里发，免得一次刷屏；之后每次只发新文章。进度先存盘再发群，飞书一时不通也不会重复花钱。

用 GitHub Actions 定时跑：把 `examples/github-actions-sync.yml` 存成你自己仓库的 `.github/workflows/sync.yml`，把 Key 和飞书地址放进 Secrets，再打开里面的 `schedule`。请用**私有仓库**，因为 `state.json` 和 `feed.xml` 会提交回仓库，里面有你关注了谁。

## 费用

2026-11-05 查询 [`/v1/capabilities`](https://api.socialtoai.com/v1/capabilities)，价格版本 `pv_29229c6acba5`。美元按 $10 档（3,000 积分）算。

| 计费项 | 做什么 | 积分 |
| --- | --- | --- |
| `wechat.user_posts` | 读一个公众号的文章列表，每页约 10 次推送（一次可能有多篇） | 12 |
| `wechat.detail` | 读一篇文章全文，也用来查公众号 ID | 12 |
| `wechat.search:user` | 按名字找公众号（这里不用） | 102 |

| 一个公众号 | 一个月最多 | 折合 |
| --- | --- | --- |
| 每天读一次 | 372 积分 | $1.24 |
| 每周读一次 | 60 积分 | $0.20 |

赠送的 100 积分：查一次 ID 再读 7 次。失败不扣；正常读取但没有新文章也算一次。

## 输出长什么样

2026-11-06 真实跑一次 `sync` 的结果：读一个公开的博物馆公众号，花 12 积分，这一页有 10 次推送共 63 篇（2026-08-21 到 2026-10-30）。下面是 `feed.xml` 里的第一条（链接省略了末尾的参数），`category` 是你在 `accounts.json` 里给它起的名字：

```text
Reading 1 account(s): 12 credits at today's price.
某公众号: 63 new.
Wrote feed.xml. Charged 12 credits.
```

```xml
<item>
  <title>上博新展预告丨环宇璀璨：大都会艺术博物馆珠宝珍藏展</title>
  <link>https://mp.weixin.qq.com/s?__biz=MzIyNjA4NDYyNQ==&amp;mid=2652576976&amp;idx=1&amp;sn=d79d6226dc4d5669931e06285ed3085a</link>
  <guid isPermaLink="false">MzIyNjA4NDYyNQ==_2652576976_1</guid>
  <pubDate>Fri, 30 Oct 2026 10:15:14 GMT</pubDate>
  <category>某公众号</category>
</item>
```

这一页的 63 篇都没有摘要，所以 RSS 里只有标题和链接。第一次运行只把这些记作起点，不往群里发。

## 限制

- **只有标题和链接。** 文章列表里通常没有正文和摘要，工具也不把全文写进 RSS。文章版权归作者，请不要把它做成公开的全文转载。
- **不是实时。** 按你设的时间读，最快一天一次。
- **一页约 10 次推送。** 一次推送可能有多篇，我们真实读的那个账号一页是 63 篇。一天发超过一页的账号，只读第一页。
- **拿不到的字段：** 阅读、点赞等数字不在文章列表里，要用 `wechat.article_stats`（12 积分）单独查。

## 也可以直接问 AI

把 `https://mcp.socialtoai.com/mcp` 接到 Claude、ChatGPT 或 Cursor，然后说：“每天早上看这个公众号有没有新文章，发到这个飞书群”。AI 会先预览、报价，你同意才建。步骤见 [MCP 接入页](https://socialtoai.com/zh/mcp/?utm_source=github&utm_medium=repo&utm_campaign=wechat-rss-feishu-20261106)。

## 测试

```bash
node --test test.mjs   # 不联网，不用 Key
```

支持：support@socialtoai.com。MIT 许可。SocialToAI 团队发布。
