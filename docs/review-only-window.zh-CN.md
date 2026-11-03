# 独立评审的限定窗口

此功能仅在包含本改动的版本部署后生效。部署和生产配置变更必须先经过原有发布流程；本文不授权启动 Runner 或代替评审者作出判断。

在已有 `pw-research-window-document-v1` 文档的 surface 中，可以添加以下字段。保留原有名单和 `allowNewAttempts`；不要为了评审把新的评审 Person 或目标 Attempt 加入原有名单。文中标识均为示例，替换为已核实的真实内部标识。

```json
{
  "participant": {
    "reviewPublishGrants": [
      { "personId": "person:<owner>", "attemptId": "attempt:<target>", "bundleHash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
    ],
    "reviewGrants": [
      { "personId": "person:<reviewer>", "attemptId": "attempt:<target>", "operations": ["review:claim", "review:transition"] }
    ]
  },
  "mcp": {
    "reviewDispatchOnly": true,
    "reviewGrants": [
      { "personId": "person:<reviewer>", "agentId": "urn:pw:agent:<reviewer>", "attemptId": "attempt:<target>", "assignmentId": "assignment:<claimed>", "operations": ["review:replay", "attestation:write"] }
    ]
  }
}
```

上面仅列出新增字段，不能作为完整部署文档直接使用。`reviewPublishGrants` 只开放指定 Person、Attempt 和 Bundle 哈希的 `review:publish`；发布端点仍需验证 Bundle 的拥有权和已接受的 Lean 证据。它不会使其他 Bundle、Attempt 或其他操作可写。研究资格中的 `canWrite` 并不代表具有发布权限。

`reviewGrants` 只允许列明的 Person、Attempt、操作组合；MCP 还必须匹配 Agent 和已领取的具体 assignment。不同 assignment 需要分别授权。评审 Person 不得同时出现在同一个 surface 的原有 `persons` 列表，否则整个 surface 视为无效。原有列表与新授权不能混用来放宽评审范围。MCP 仍会检查 OAuth 作用域、有效委托、独立的已接受 assignment 及签名身份；授权本身并不产生复验或评审结果。

`reviewDispatchOnly` 仅允许带有精确 `review:replay` 授权的 MCP 复验请求进入 Runner 分发，拒绝普通作者 Run 请求及仅依靠旧名单的评审复验；它不会停止已经入队的工作或限制其他独立入口。打开执行环境前须同时核对其他入口与运行中的消费者。设置 `RUNNER_ONLY_RUN_ID` 为每次批准的具体新复验 Run，并设置 `RUNNER_MAX_DELIVERY_ATTEMPTS=1`，以限定该 Runner 的领取和投递；两个不同 assignment 的复验是两个独立 Run，不能用作者旧 Run 代替。

使用 `scripts/research-window.mjs show` 校验完整文件，再用 `export` 导出当前 surface；该工具保留上述字段并对示例占位符发出警告。变更前保存原配置，结束后恢复并回读。新增字段均可省略；未设置时保留原有行为。格式、surface 或授权操作不合法时，该 surface 的写入窗口会整体关闭。
