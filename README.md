# satchel-web

Satchel（百宝袋）的网页前端，对应 mmwx 的 miaomiaowux-frontend（私有仓库；Satchel 的前端公开）。网页是工具面的人类外壳：只调主控命令表里的命令，不独占任何逻辑。

编译产物不进主控仓库：主控 `satchel` 按固定 tag 拉取本仓库构建，`go:embed` 进主控二进制，Docker 镜像同样。

**状态：M1 第一批页面：登录（含两步验证的第二步与 Turnstile）、初始化向导、总览、账号、API 令牌（含谁在连）、系统设置。运维页随 m1-12。**

## 技术栈

- React 19、Vite 7、TypeScript 5.9。
- TanStack Router（文件式路由，`src/routeTree.gen.ts` 由插件生成并提交）、TanStack Query。
- Tailwind CSS 4 + shadcn/ui（new-york，组件源码在 `src/components/ui/`）。
- i18next + react-i18next（现在只有中文），sonner（提示）、lucide-react（图标）、qrcode.react（两步验证的二维码）、input-otp。
- 测试：Vitest + Testing Library + jsdom；端到端用 Playwright，otpauth 算两步验证码。

Node 22（见 `.nvmrc`）。

## 目录

- `src/routes/`：页面。`_app.tsx` 是登录后的布局与守卫（空库进向导，没登录进登录页）。
- `src/api/`：调用封装。`commands.ts` 是网页调用的命令与 REST 路由，`client.ts` 的 `run` 调一条命令，`session.ts` 是会话入口（登录、第二步、登出、验证码配置）。
- `src/components/`：布局、当场验证与危险确认对话框、错误显示、Turnstile 组件，以及 shadcn/ui 的 `ui/`。
- `src/theme/`：主题框架。`public/boot.js` 在第一次绘制之前定好主题与亮暗。
- `src/i18n/locales/zh/*.json`：界面文案，按页面分命名空间。
- `src/manifest.ts`：页面清单（每页的「可见操作 → CLI 命令」）。
- `scripts/`：合成页面清单与文案检查。
- `e2e/`：端到端测试。

## 约定

- 网页只调命令表里的命令的 REST 路由与会话入口。每条命令登记在 `src/api/commands.ts`，并出现在 `src/manifest.ts` 某一页的可见操作里；构建时两者合成 `dist/satchel-web.json`，主控的测试拿它核对命令表。
- 取值规则与错误文案在主控：网页只做 CLI 在本地也做的检查（必填项、两次输入的密码一致），失败时原样显示主控的 `reason` 与 `next`。
- 人类专属命令发请求之前弹出当场验证，危险类命令先弹出确认；当场验证的值每次重新输入，网页不保存。
- 界面文案放进 locales。`npm run check:text` 扫 `src/` 里的中文字面量，测试文件、`src/test/`、`src/components/ui/` 与生成的路由树不查。
- 主题登记扁平、像素、动漫、premium 四套，本站只实现扁平，另外三套按扁平显示。首屏不用内联脚本：主控的 CSP 不许。
- `index.html` 里的 `__SATCHEL_SITE_TITLE__` 与 `__SATCHEL_BOOT__` 由主控在给出页面时替换成品牌字段；`npm run dev` 时换成默认值。

## 开发

```sh
npm ci
SATCHEL_DEV_TARGET=http://<Linux 主机>:12889 npm run dev   # 把 /api 与 /public 代理到一台 Linux 上的主控
```

主控的 `serve` 只在 Linux 上跑，所以本地联调要对一台 Linux 上的主控。

## 测试

```sh
npm run typecheck
npm run lint
npm test
npm run check:text
npm run build        # 产物在 dist/，含 satchel-web.json；清单里的版本取 SATCHEL_WEB_VERSION，没有时是 dev
```

CI 依次跑这五步，并核对构建后 `src/routeTree.gen.ts` 没有差异。

## 端到端测试

测试对一个空数据目录的主控按顺序跑：向导建管理员、开启两步验证、两步登录、令牌新建（用明文调 `whoami`）与吊销、改品牌后的登录页、Turnstile 测试配置与登录。它会建管理员、开两步验证、改设置，所以每次都要一个新的空库主控。

```sh
npx playwright install chromium
SATCHEL_E2E_URL=http://127.0.0.1:12889 npm run e2e
```

- Turnstile 那一步用 Cloudflare 公开的测试 key，要连 `challenges.cloudflare.com`。
- 页面上出现 CSP 违规或未处理的脚本错误时测试失败。
- 主控仓库 CI 的 `web-e2e` 任务按固定 tag 构建网页与主控，再跑这套测试。

## 打 tag 与主控怎么拉取

- 改完、CI 通过后打 tag（如 `v0.1.0`）并推送。
- 主控仓库的 `internal/projection/web/SATCHEL_WEB_REF` 记着用哪个 tag。主控的 `tools/web/build.sh` 按它浅克隆本仓库，执行 `npm ci && npm run build`（`SATCHEL_WEB_VERSION` 设成这个 tag），再把 `dist/` 放进主控编进二进制的目录。换网页版本就是在主控仓库改这个文件。
- 开发时在主控仓库执行 `SATCHEL_WEB_DIR=../satchel-web tools/web/build.sh`，用本地的工作区，版本记成 `local`。
- 页面或命令的路径改了而两边没有一起改时，主控 CI 里的清单核对会失败。

## 仓库关系

六个仓库的分工见技术方案第 02 章：`satchel`（主控、CLI、MCP、skills）、`satchel-agent`（节点守护）、`satchel-web`（本仓库）、`satchel-plugins`（订阅解析库、家用测速端）、`satchel-probe`（外置探针）、`satchel-docs`（文档站）。

## 许可证

GPL-3.0，见 LICENSE。
