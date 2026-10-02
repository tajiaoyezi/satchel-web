# satchel-web

Satchel（百宝袋）的网页前端，对应 mmwx 的 miaomiaowux-frontend（私有仓库；Satchel 的前端公开）。技术栈按技术方案第 08 章：React 19 + Vite + TypeScript，M1 加 TanStack Router、TailwindCSS 4、shadcn/ui、主题框架与 i18n 框架。

编译产物不进主控仓库：主控 `satchel` 的 CI 按固定 tag 拉取本仓库构建，`go:embed` 进主控二进制，Docker 构建同样。

**状态：M0 骨架阶段，只有一页占位。**

## 构建

```sh
npm ci
npm run build      # 产物在 dist/
```

Node 22（见 `.nvmrc`）。

## 仓库关系

六个仓库的分工见技术方案第 02 章：`satchel`（主控、CLI、MCP、skills）、`satchel-agent`（节点守护）、`satchel-web`（本仓库）、`satchel-plugins`（订阅解析库、家用测速端）、`satchel-probe`（外置探针）、`satchel-docs`（文档站）。

## 许可证

GPL-3.0，见 LICENSE。
