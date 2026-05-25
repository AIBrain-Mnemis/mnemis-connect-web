# Mnemis Connect Web

数字人 1:1 通话服务的 Web 客户端。用户打开 `/bot/:botUserId`，页面向撮合服务申请 TRTC `userSig`，进入房间，与 Bot 客户端（例如 Electron 应用，独立仓库）进行音频 + 可选屏幕共享通话。

English version: [README.md](./README.md).

## 主要功能

- Bot ID 输入页：输入校验 + `localStorage` 记忆上次访问的 Bot。
- 通话状态机 (`useCallSession`)：`online → reserving → waiting → calling → ended`，含 `busy` / `offline` / `timeout` / `error` 分支。
- TRTC SDK 生命周期 Hook (`useTRTC`)：进/退房、麦克风、屏幕共享、远端订阅、静音、abort-safe 清理。
- 同名重连：`userName` 持久化到 `sessionStorage`，刷新 / 重试复用同一房间。
- 国际化：中英双语，按 URL `?lang=` → localStorage → 浏览器语言自动选择。
- 本地 Mock 撮合服务 (`tools/mock-server.mjs`)：可签发真实 `userSig`，不依赖后端即可完成 Web ↔ Bot 全链路联调。
- GitHub Actions CI + Deploy（基于 self-hosted runner + `rsync`，无需 SSH 凭据）。

## 技术栈

- React 18 + TypeScript, Vite 5
- React Router v6（BrowserRouter）
- Zustand（极简 state：仅 remoteUsers 与日志 sink）
- Tailwind CSS 4 + shadcn 风格基础组件（radix-ui）
- react-i18next
- `trtc-sdk-v5`
- vitest

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量（可选，仅用 mock 时可跳过）
cp .env.example .env.local
#   不设置 VITE_API_BASE_URL → 默认走本地 mock：http://localhost:8787
#   或指向真实后端：VITE_API_BASE_URL=https://api.example.com

# 3. 启动开发（同时拉起 mock + Vite）
npm run dev
```

打开 <http://localhost:5800>，输入任意后缀（拼成 `bot_<后缀>`）后提交。

> Mock 默认返回随机的 Bot 状态。若要真正进入房间，需要配置 TRTC SDK 凭据，见下文 _Mock 签发真实 userSig_。

## 脚本

| 命令                    | 说明                                                                      |
| ----------------------- | ------------------------------------------------------------------------- |
| `npm run dev`           | 并行启动 `dev:mock` + `dev:web`，Web 通过 `VITE_API_BASE_URL` 指向 mock。 |
| `npm run dev:web`       | 仅启动 Vite（默认仍代理 `/rtc` → `http://localhost:8787`）。              |
| `npm run dev:mock`      | 仅启动 mock 撮合服务（`tools/mock-server.mjs`），监听 `:8787`。           |
| `npm run mock`          | 同 `dev:mock`，独立运行 mock。                                            |
| `npm run build`         | `tsc && vite build`。                                                     |
| `npm run preview`       | 本地预览生产构建。                                                        |
| `npm run lint`          | ESLint（`--max-warnings=0`）。                                            |
| `npm run lint:fix`      | ESLint `--fix`。                                                          |
| `npm run format`        | Prettier 写回。                                                           |
| `npm run format:check`  | Prettier 校验（CI 使用）。                                                |
| `npm run typecheck`     | `tsc --noEmit`。                                                          |
| `npm test`              | Vitest 单次执行。                                                         |
| `npm run test:watch`    | Vitest watch 模式。                                                       |
| `npm run test:coverage` | Vitest + v8 覆盖率。                                                      |

## Mock 签发真实 userSig

`tools/mock-server.mjs` 可签发真实 `userSig`，让 Web 真正进入 TRTC 房间。在 `.env.local` 增加：

```bash
MOCK_SDK_APP_ID=1400000000          # 你的 TRTC SDKAppID
MOCK_SDK_SECRET_KEY=<sdk-secret>    # 你的 SDKSecretKey
```

配置后 mock 会在 `IDLE` / `BUSY` 间随机（可入房）；不配置时只会落 `OFFLINE` / `BUSY`，`connect` 不会返回房间凭据 —— 适合无 TRTC 凭据的纯 UI 演示。

任意 TRTC 用户加入相同 `roomId` 即可完成通话。协议详见 [`docs/rtc-client-integration.md`](./docs/rtc-client-integration.md)。

## 接入真实后端

Web 端通信对象是撮合服务，不直接与 TRTC 通信。所需 API 定义见 [`docs/rtc-client-integration.md`](./docs/rtc-client-integration.md)；`tools/mock-server.mjs` 是该契约的一个可运行参考实现。

切换到真实后端：

```bash
# .env.local
VITE_API_BASE_URL=https://api.example.com
```

## 目录结构

```
src/
├── main.tsx                  # 入口
├── App.tsx                   # BrowserRouter 外壳
├── api/
│   ├── client.ts             # apiFetch + ApiError 外壳处理
│   ├── bot.ts                # botApi.{getStatus, connect}
│   └── types.ts              # BotStatusInfo, ConnectResult, 错误码
├── hooks/
│   ├── useTRTC.ts            # TRTC SDK 生命周期（房间 / 麦克风 / 屏幕共享）
│   └── useCallSession.ts     # 通话状态机 + 撮合服务联动
├── components/
│   ├── ErrorBoundary.tsx
│   └── ui/                   # shadcn 风格基础组件
├── pages/
│   ├── LandingPage.tsx       # Bot ID 输入页
│   └── CallPage/             # Setup + 通话视图
├── locales/                  # en / zh-cn JSON + i18next 初始化
├── lib/                      # 工具（cn helper、语言检测）
└── store/                    # Zustand（remoteUsers + log sink）
tools/
├── mock-server.mjs           # 本地撮合服务 mock
└── userSig.mjs               # 服务端 TRTC userSig 签发
docs/
├── rtc-client-integration.md # 后端 API 契约
└── deployment.md             # self-hosted runner 部署说明
```

## 部署

CI (`.github/workflows/ci.yml`) 与 Deploy (`.github/workflows/deploy.yml`) 在 self-hosted Linux runner 上执行。详见 [`docs/deployment.md`](./docs/deployment.md)，并在仓库 Variables 中设置 `VITE_API_BASE_URL`、`DEPLOY_TARGET_DIR`。

生产构建使用 `base: '/'` + `BrowserRouter`，Web 服务器需配置 SPA history fallback（nginx 中的 `try_files $uri $uri/ /index.html;`）。

## 安全提示

`tools/userSig.mjs` 是**服务端**辅助工具。浏览器包不会下发 SDK 密钥 —— 仅撮合服务持有 `SDKSecretKey` 并按需签发 `userSig`。`MOCK_SDK_SECRET_KEY` 切勿提交到公开仓库。

## 许可

[MIT](./LICENSE) © 2026 AIBrain-Mnemis Teams
