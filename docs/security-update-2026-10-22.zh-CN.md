# 2026-10-22 安全依赖修复

本次变更基于 main `8bd7409db9ae95110043bacc42f4b336ce3eabaf`，只更新源码、依赖锁文件、构建配置和测试。生产执行、自动部署及现有镜像批准均不改变。

## 修复范围

| 组件 | 原版本 | 本次版本 | 覆盖范围 |
| --- | --- | --- | --- |
| Node.js | Render 配置 22.14.0；托管 Docker 22.13.1 | 22.23.4 | 本地版本文件、CI、Runner 配置和未来镜像构建输入 |
| Next.js / eslint-config-next | 16.4.0 / 16.2.12 | 16.4.2 | 网页依赖和配套 lint 配置 |
| React / React DOM / react-server-dom-webpack | 19.2.8 | 19.2.9 | 客户端与服务端解码器同步升级，保留 vinext 0.2.1 |
| Vite | 8.1.4 | 8.1.6 | 同一版本线的开发服务器安全补丁 |
| Hono | 4.13.7 | 4.13.13 | MCP SDK 的间接依赖，通过 override 固定补丁 |
| image-size | 2.0.2 | 2.0.4 | vinext 的间接图片解析依赖 |
| undici 7 / undici8 别名 | 根树含 7.28.0；独立 Runner 7.29.1；别名 8.11.2 | 7.30.1 / 8.12.2 | 根项目、独立 Runner 和 E2B 可选 HTTP 实现 |
| body-parser | 2.3.0 | 2.4.0 | MCP SDK 经 Express 引入的压缩请求解析器 |
| Zod | 4.4.3 | 4.6.7（最低 4.6.6） | MCP 输入模式与 SDK 校验 |
| sharp | 0.35.5 | 0.35.5 | 保留已有安全 override |

Node 的最低版本限定为已修复的 22.23.4、24.22.1、26.12.1 分支，根项目和独立 Runner 均启用 `engine-strict`。CI 使用 `.nvmrc` 的精确版本。两个已固定哈希的隔离工作流仅修改 setup-node 版本输入，并同步更新校验器中的源码哈希；原有禁用条件、执行命令、权限与 secrets 边界保留。Runner 导出包含自己的 `.npmrc`，Docker 安装也复制该文件。

未来 E2B 基础镜像使用官方 `node:22.23.4-bookworm` 的索引摘要 `sha256:2bd396628eceb5c999a6e43731fab69d5fb98b94ba9d9d90b5f64575c5178765`。已读取 linux/amd64 配置确认 `NODE_VERSION=22.23.4`；没有运行镜像构建或模板创建。

## 2026-10-24 补充修复

PR #169 的完整门禁在生产依赖审计处发现三项高危包。`undici` 原 override 只覆盖普通包名，未覆盖 E2B 2.55.0 在 Node >=22.19.0 时优先尝试的可选别名 `undici8`。现在为该别名单独固定 `npm:undici@8.12.2`，并将两个安装根的普通 undici override 最低版本提高到 7.30.1；保留独立 Runner 的 E2B 2.35.0。body-parser 固定 2.4.0，Zod 的直接依赖最低版本提高到 4.6.6，锁定当前 4.6.7。未升级 Next、vinext、E2B 或 Node 主版本，未降低审计门槛。

真实依赖回归在隔离子进程中向回环服务器发送压缩尾随数据和过多 Content-Encoding 响应，验证解析/HTTP 客户端不会产生未处理错误终止进程，且后续正常请求可用；普通 undici 与 undici8 分别覆盖。Zod 测试覆盖数组、Set、Map 的同步/异步解析：超出已声明上限时不访问元素，正常小集合仍按原模式校验。测试只使用有界本地载荷，不访问外部服务。Zod 的补丁不代表任意无上限模式也获得了应用级输入限制。

## 校验

`npm run security:baseline:check` 使用实际锁文件，检查 Node、Next、sharp、所有嵌套 RSC 包、body-parser、undici 和 Zod；同时检查 npm 别名的真实包名，包括可选或标为 dev 的条目。回归测试覆盖修复边界、旧补丁、非支持 Node 分支、预发行版本、嵌套且标为 dev 的旧 RSC 解码器，以及缺少版本的锁文件。该检查接入快速和完整 CI。

`npm run security:dependencies` 分别审计根项目与独立 Runner 的生产依赖；RSC 即使归在 dev 依赖中，也由上述锁文件检查单独覆盖。生产审计不等同于构建工具审计。

2026-10-24 复核结果：根项目生产依赖审计为 0 高危、2 中危（fast-uri、ip-address），独立 Runner 为 0 告警；完整开发依赖审计为 0 高危、6 中危，另外四项来自 drizzle-kit 旧加载器的 esbuild 链。本次只修复指定的三项高危包，中危告警继续跟踪，没有屏蔽或提高审计阈值。此前记录的 8 项 braces 高危链已因[上游在 2026-10-23 撤回告警](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)而不再计入；这不是本 PR 升级 braces 的结果。禁止将开发服务器暴露公网，构建输入只接受仓库受控内容；这些约束不是漏洞修复。

本地使用 Node 22.23.4 完成干净 `npm ci`、快速检查和真实依赖回归。隔离旧版本对照中，body-parser 2.3.0 与 undici8 8.11.2 分别触发子进程未处理错误，Zod 4.4.3 遍历超限集合；相同测试在补丁版本全部通过。

## 发布边界

截至本次只读核查，Render 的 `RUNNER_EXECUTION_ENABLED=false`、`autoDeploy=no`，最新部署仍是 `dep-dbbi4fu1egvs7384b1n0`（提交 `13c07955d7fc85e9ff6f47102d0a9d8806339aad`）。线上 `NODE_VERSION` 配置仍为 `22.14.0`，不能据此宣称生产已修复，也未在运行中的进程读取二进制版本。

后续发布需在批准后分别完成：核对合并提交与 CI；更新 Render 的实际 Node 配置并部署、核验运行版本；发布 Cloudflare 网页并核验组件来源；重新构建并审查 E2B 不可变镜像及模板，更新获批摘要。旧 E2B 镜像不会因修改构建配方而自动修复。Cloudflare Worker 使用 workerd，不由 Render 的 Node 配置控制。所有步骤均继续保持生产执行关闭，恢复执行另行确认。

仓库未发现 PHP 源文件或 Composer 清单，因此未修改本机或无关服务的 PHP。

## 上游依据

- [Node 2026-10-21 安全公告](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
- [Next 2026-10-14 安全公告](https://nextjs.org/blog/nextjs-security-update-october-14-2026)
- [React RSC 远程代码执行修复](https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3)
- [React RSC 拒绝服务修复](https://github.com/react/react/security/advisories/GHSA-h3gv-c5rc-p453)
- [Hono 静态路径二次解码](https://github.com/honojs/hono/security/advisories/GHSA-5r4p-p66f-jhc7)
- [Vite/launch-editor Windows 命令执行](https://github.com/vitejs/launch-editor/security/advisories/GHSA-587h-7wmj-h5pm)
- [image-size 修复提交](https://codeberg.org/image-size/image-size/commit/e6e83a5578961de81f6d5834d90fb7430d8f29a5)
- [braces 尚无补丁的告警](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)

- [body-parser 压缩尾随数据导致进程崩溃](https://github.com/advisories/GHSA-27r3-jxmh-p828)
- [undici 过多 Content-Encoding 的未处理错误](https://github.com/advisories/GHSA-xjj6-f33q-929c)
- [Zod 超大集合资源耗尽](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
