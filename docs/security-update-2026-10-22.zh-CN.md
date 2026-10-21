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
| undici | 根依赖树含 7.28.0 | >=7.30.0、<8 | 构建与本地 Worker 工具的间接 HTTP 依赖 |
| sharp | 0.35.5 | 0.35.5 | 保留已有安全 override |

Node 的最低版本限定为已修复的 22.23.4、24.22.1、26.12.1 分支，根项目和独立 Runner 均启用 `engine-strict`。CI 使用 `.nvmrc` 的精确版本。两个已固定哈希的隔离工作流仅修改 setup-node 版本输入，并同步更新校验器中的源码哈希；原有禁用条件、执行命令、权限与 secrets 边界保留。Runner 导出包含自己的 `.npmrc`，Docker 安装也复制该文件。

未来 E2B 基础镜像使用官方 `node:22.23.4-bookworm` 的索引摘要 `sha256:2bd396628eceb5c999a6e43731fab69d5fb98b94ba9d9d90b5f64575c5178765`。已读取 linux/amd64 配置确认 `NODE_VERSION=22.23.4`；没有运行镜像构建或模板创建。

## 校验

`npm run security:baseline:check` 使用实际锁文件，检查 Node、Next、sharp 和所有嵌套 RSC 包。回归测试覆盖修复边界、旧补丁、非支持 Node 分支、预发行版本、嵌套且标为 dev 的旧 RSC 解码器，以及缺少版本的锁文件。该检查接入快速和完整 CI。

`npm run security:dependencies` 分别审计根项目与独立 Runner 的生产依赖；RSC 即使归在 dev 依赖中，也由上述锁文件检查单独覆盖。生产审计不等同于构建工具审计。

完整开发依赖仍可能包含未修复的 `braces <=3.0.3` 高危栈耗尽告警（上游暂无补丁），以及 drizzle-kit 旧加载器携带的 esbuild 开发服务器告警。本次不通过降级 Next/vinext、屏蔽审计或强制跨主版本升级处理。禁止将开发服务器暴露公网，构建输入只接受仓库受控内容；这些约束不是漏洞修复，告警仍需跟踪。

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
