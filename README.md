# 国内高尔夫赛事报名日历

这个本地网页会按比赛日期展示 2026 国内女子赛、起点中巡、业余赛、青少年赛，并在卡片详情里打开官方信息源网页。

## 公开网站部署

推荐部署到 GitHub Pages。推送到 GitHub 仓库后，在仓库 `Settings -> Pages` 中把 `Source` 设为 `Deploy from a branch`，`Branch` 选择 `main`，目录选择 `/ (root)`。

工作流会在每天北京时间 08:30 运行 `npm run update`，更新 `data/events.json`。也可以在 GitHub 的 `Actions -> Update golf event data -> Run workflow` 手动触发。

本项目没有前端依赖，`npm run build` 会把公开网站需要的文件输出到 `dist/`。

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

公网静态版没有本地 `/api/update`，网页会直接读取 `data/events.json`，由 GitHub Actions 定时更新。

## 数据源

- CLPGA 女子中巡官网接口与赛程页
- 中高协年历接口
- 已整理的赛事规程 Markdown 文件
