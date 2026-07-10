# 国内高尔夫赛事报名日历

这个本地网页会按比赛日期展示 2026 国内女子赛、起点中巡、业余赛、青少年赛，并在卡片详情里打开官方信息源网页。

## 公开网站部署

推荐部署到 GitHub Pages。推送到 GitHub 仓库后，在仓库 `Settings -> Pages` 中把 `Source` 设为 `Deploy from a branch`，`Branch` 选择 `main`，目录选择 `/ (root)`。

工作流会在北京时间 08:00-22:00 每小时运行 `npm run update`，检查 CLPGA、中高协公开接口和大正高尔夫公开报名列表，并更新 `data/events.json`。也可以在 GitHub 的 `Actions -> Update golf event data -> Run workflow` 手动触发。

## 更新提醒

GitHub Actions 已接入赛事变化通知。每次自动更新后，如果发现新增赛事、报名状态变为可报名、报名截止/比赛日期/入口变化，会向已配置的机器人推送摘要。

在 GitHub 仓库 `Settings -> Secrets and variables -> Actions -> New repository secret` 添加以下任一配置即可启用：

- `DINGTALK_WEBHOOK`：钉钉群自定义机器人 Webhook。
- `DINGTALK_SECRET`：钉钉机器人加签密钥，若机器人安全设置启用了“加签”则必填。
- `WEWORK_WEBHOOK`：企业微信群机器人 Webhook。

钉钉推荐配置：

1. 在钉钉群里进入 `群设置 -> 机器人 -> 添加机器人 -> 自定义`。
2. 安全设置选择“加签”，复制 Webhook 和加签密钥。
3. 在 GitHub 仓库添加 `DINGTALK_WEBHOOK` 和 `DINGTALK_SECRET` 两个 Secret。
4. 到 `Actions -> Test DingTalk notification -> Run workflow` 手动发送测试消息。

普通个人微信没有稳定的官方群机器人 Webhook。微信侧建议优先使用企业微信群机器人；如果要走公众号/服务号模板或订阅消息，需要另做公众号后台和用户授权流程。

本项目没有前端依赖，`npm run build` 会把公开网站需要的文件输出到 `dist/`。

`data/sources.json` 维护青少年热门赛事的一手资讯源，包括中高协、大正高尔夫、CJGT、朝向集团高尔夫赛事、格林体育、华高体育、巡回赛系列赛官方号、汇丰青少年、斐乐青少年、如歌高尔夫等。CLPGA、中高协公开接口和大正公开报名列表由自动任务检查；公众号、小程序及没有稳定公开接口的平台仍需在微信或对应 App 内人工回查，网站会把这些渠道作为核验清单展示。

大正抓取采用增量方式：每小时读取一次公开报名列表，只在发现新赛事、报名区间变化或缺少详情缓存时读取对应详情页。会员招募、教练培训、等级考试和明确的海外站不会作为国内赛事写入赛历。

自动更新会先按来源权威性合并数据，再检查重复赛事、比赛日期、报名截止和报名入口。单项规程优先于全年赛历；任何数据校验失败都会保留上一版公开数据，避免错误日期进入网页和钉钉推送。

`data/app-links.json` 维护 App/小程序入口。只有平台公开 Universal Link、URL Scheme 或微信 URL Link 时，网页才能直达报名页；否则页面提供安装入口、打开微信和 App 内搜索路径。

## 启动

```bash
./scripts/start.zsh
```

打开 `http://localhost:4173`。

## 更新数据

```bash
./scripts/update.zsh
```

本地服务运行时会在启动时检查 `data/events.json` 是否超过 23 小时未更新；如果过期会自动刷新。服务保持运行时也会每 24 小时刷新一次，并且网页左侧有“更新官方数据”按钮。

公网静态版没有本地 `/api/update`，网页会直接读取 `data/events.json`、`data/sources.json` 和 `data/app-links.json`，由 GitHub Actions 定时更新。

## 数据源

- CLPGA 女子中巡官网接口与赛程页
- 中高协年历接口
- 大正高尔夫公开报名列表与赛事详情页
- 已整理的赛事规程 Markdown 文件
