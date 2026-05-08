> ## Documentation Index
> Fetch the complete documentation index at: https://code.claude.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Channels 参考

> 构建一个 MCP 服务器，将 webhooks、警报和聊天消息推送到 Claude Code 会话中。频道合约的参考：能力声明、通知事件、回复工具、发送者门控和权限中继。

<Note>
  Channels 处于[研究预览](/zh-CN/channels#research-preview)阶段，需要 Claude Code v2.1.80 或更高版本。它们需要 claude.ai 登录。不支持控制台和 API 密钥身份验证。Team 和 Enterprise 组织必须[明确启用它们](/zh-CN/channels#enterprise-controls)。
</Note>

Channel 是一个 MCP 服务器，它将事件推送到 Claude Code 会话中，以便 Claude 可以对终端外发生的事情做出反应。

您可以构建单向或双向频道。单向频道转发警报、webhooks 或监控事件供 Claude 处理。双向频道（如聊天桥接）也[公开回复工具](#expose-a-reply-tool)，以便 Claude 可以发送消息回复。具有受信任发送者路径的频道也可以选择加入[中继权限提示](#relay-permission-prompts)，以便您可以远程批准或拒绝工具使用。

本页涵盖：

* [概述](#overview)：频道如何工作
* [您需要什么](#what-you-need)：要求和一般步骤
* [示例：构建 webhook 接收器](#example-build-a-webhook-receiver)：最小单向演练
* [服务器选项](#server-options)：构造函数字段
* [通知格式](#notification-format)：事件有效负载
* [公开回复工具](#expose-a-reply-tool)：让 Claude 发送消息回复
* [门控入站消息](#gate-inbound-messages)：发送者检查以防止提示注入
* [中继权限提示](#relay-permission-prompts)：将工具批准提示转发到远程频道

要使用现有频道而不是构建一个，请参阅 [Channels](/zh-CN/channels)。Telegram、Discord、iMessage 和 fakechat 包含在研究预览中。

## 概述

Channel 是一个在与 Claude Code 相同的机器上运行的 [MCP](https://modelcontextprotocol.io) 服务器。Claude Code 将其作为子进程生成并通过 stdio 进行通信。您的频道服务器是外部系统和 Claude Code 会话之间的桥梁：

* **聊天平台**（Telegram、Discord）：您的插件在本地运行并轮询平台的 API 以获取新消息。当有人向您的机器人发送 DM 时，插件接收消息并将其转发给 Claude。无需公开 URL。
* **Webhooks**（CI、监控）：您的服务器在本地 HTTP 端口上侦听。外部系统 POST 到该端口，您的服务器将有效负载推送到 Claude。

<img src="https://mintlify.s3.us-west-1.amazonaws.com/claude-code/zh-CN/images/channel-architecture.svg" alt="架构图显示外部系统连接到您的本地频道服务器，该服务器通过 stdio 与 Claude Code 通信" />

## 您需要什么

唯一的硬性要求是 [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) 包和 Node.js 兼容的运行时。[Bun](https://bun.sh)、[Node](https://nodejs.org) 和 [Deno](https://deno.com) 都可以工作。研究预览中的预构建插件使用 Bun，但您的频道不一定要使用。

您的服务器需要：

1. 声明 `claude/channel` 能力，以便 Claude Code 注册通知侦听器
2. 当发生某事时发出 `notifications/claude/channel` 事件
3. 通过 [stdio transport](https://modelcontextprotocol.io/docs/concepts/transports#standard-io) 连接（Claude Code 将您的服务器作为子进程生成）

[服务器选项](#server-options)和[通知格式](#notification-format)部分详细介绍了每一项。有关完整演练，请参阅[示例：构建 webhook 接收器](#example-build-a-webhook-receiver)。

在研究预览期间，自定义频道不在[批准的允许列表](/zh-CN/channels#supported-channels)上。使用 `--dangerously-load-development-channels` 在本地测试。有关详细信息，请参阅[在研究预览期间测试](#test-during-the-research-preview)。

## 示例：构建 webhook 接收器

本演练构建一个单文件服务器，该服务器侦听 HTTP 请求并将其转发到您的 Claude Code 会话中。最后，任何可以发送 HTTP POST 的东西，如 CI 管道、监控警报或 `curl` 命令，都可以将事件推送到 Claude。

此示例使用 [Bun](https://bun.sh) 作为运行时，用于其内置的 HTTP 服务器和 TypeScript 支持。您可以改用 [Node](https://nodejs.org) 或 [Deno](https://deno.com)；唯一的要求是 [MCP SDK](https://www.npmjs.com/package/@modelcontextprotocol/sdk)。

<Steps>
  <Step title="创建项目">
    创建一个新目录并安装 MCP SDK：

    ```bash theme={null}
    mkdir webhook-channel && cd webhook-channel
    bun add @modelcontextprotocol/sdk
    ```
  </Step>

  <Step title="编写频道服务器">
    创建一个名为 `webhook.ts` 的文件。这是您的整个频道服务器：它通过 stdio 连接到 Claude Code，并在端口 8788 上侦听 HTTP POST。当请求到达时，它将主体作为频道事件推送到 Claude。

    ```ts title="webhook.ts" theme={null}
    #!/usr/bin/env bun
    import { Server } from '@modelcontextprotocol/sdk/server/index.js'
    import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

    // 创建 MCP 服务器并将其声明为频道
    const mcp = new Server(
      { name: 'webhook', version: '0.0.1' },
      {
        // 这个键使其成为频道 — Claude Code 为其注册侦听器
        capabilities: { experimental: { 'claude/channel': {} } },
        // 添加到 Claude 的系统提示，以便它知道如何处理这些事件
        instructions: 'Events from the webhook channel arrive as <channel source="webhook" ...>. They are one-way: read them and act, no reply expected.',
      },
    )

    // 通过 stdio 连接到 Claude Code（Claude Code 生成此进程）
    await mcp.connect(new StdioServerTransport())

    // 启动一个 HTTP 服务器，将每个 POST 转发给 Claude
    Bun.serve({
      port: 8788,  // 任何开放端口都可以
      // 仅限本地主机：此机器外的任何东西都无法 POST
      hostname: '127.0.0.1',
      async fetch(req) {
        const body = await req.text()
        await mcp.notification({
          method: 'notifications/claude/channel',
          params: {
            content: body,  // 成为 <channel> 标签的主体
            // 每个键都成为标签属性，例如 <channel path="/" method="POST">
            meta: { path: new URL(req.url).pathname, method: req.method },
          },
        })
        return new Response('ok')
      },
    })
    ```

    该文件按顺序执行三项操作：

    * **服务器配置**：使用 `claude/channel` 在其能力中创建 MCP 服务器，这是告诉 Claude Code 这是一个频道的原因。[`instructions`](#server-options) 字符串进入 Claude 的系统提示：告诉 Claude 期望什么事件、是否回复以及如果应该回复，使用哪个工具和传回哪个属性。
    * **Stdio 连接**：通过 stdin/stdout 连接到 Claude Code。这对任何 [MCP 服务器](https://modelcontextprotocol.io/docs/concepts/transports#standard-io) 都是标准的：Claude Code 将其作为子进程生成。
    * **HTTP 侦听器**：在端口 8788 上启动本地 Web 服务器。每个 POST 主体都通过 `mcp.notification()` 作为频道事件转发给 Claude。`content` 成为事件主体，每个 `meta` 条目成为 `<channel>` 标签上的属性。侦听器需要访问 `mcp` 实例，因此它在同一进程中运行。对于更大的项目，您可以将其拆分为单独的模块。
  </Step>

  <Step title="向 Claude Code 注册您的服务器">
    将服务器添加到您的 MCP 配置中，以便 Claude Code 知道如何启动它。对于同一目录中的项目级 `.mcp.json`，使用相对路径。对于 `~/.claude.json` 中的用户级配置，使用完整的绝对路径，以便可以从任何项目找到服务器：

    ```json title=".mcp.json" theme={null}
    {
      "mcpServers": {
        "webhook": { "command": "bun", "args": ["./webhook.ts"] }
      }
    }
    ```

    Claude Code 在启动时读取您的 MCP 配置并将每个服务器作为子进程生成。
  </Step>

  <Step title="测试它">
    在研究预览期间，自定义频道不在允许列表上，因此使用开发标志启动 Claude Code：

    ```bash theme={null}
    claude --dangerously-load-development-channels server:webhook
    ```

    当 Claude Code 启动时，它读取您的 MCP 配置，将您的 `webhook.ts` 作为子进程生成，HTTP 侦听器自动在您配置的端口上启动（此示例中为 8788）。您不需要自己运行服务器。

    如果您看到"被组织政策阻止"，您的 Team 或 Enterprise 管理员需要[启用频道](/zh-CN/channels#enterprise-controls)。

    在单独的终端中，通过向您的服务器发送带有消息的 HTTP POST 来模拟 webhook。此示例向端口 8788 发送 CI 失败警报（或您配置的任何端口）：

    ```bash theme={null}
    curl -X POST localhost:8788 -d "build failed on main: https://ci.example.com/run/1234"
    ```

    有效负载作为 `<channel>` 标签到达您的 Claude Code 会话中：

    ```text theme={null}
    <channel source="webhook" path="/" method="POST">build failed on main: https://ci.example.com/run/1234</channel>
    ```

    在您的 Claude Code 终端中，您会看到 Claude 接收消息并开始响应：读取文件、运行命令或消息要求的任何操作。这是一个单向频道，因此 Claude 在您的会话中行动，但不会通过 webhook 发送任何内容回复。要添加回复，请参阅[公开回复工具](#expose-a-reply-tool)。

    如果事件没有到达，诊断取决于 `curl` 返回的内容：

    * **`curl` 成功但没有任何内容到达 Claude**：在您的会话中运行 `/mcp` 以检查服务器的状态。"Failed to connect"通常意味着您的服务器文件中存在依赖项或导入错误；检查 `~/.claude/debug/<session-id>.txt` 处的调试日志以获取 stderr 跟踪。
    * **`curl` 失败，显示"connection refused"**：端口要么尚未绑定，要么来自较早运行的陈旧进程正在占用它。`lsof -i :<port>` 显示正在侦听的内容；在重新启动会话之前 `kill` 陈旧进程。
  </Step>
</Steps>

[fakechat 服务器](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/fakechat)使用 Web UI、文件附件和用于双向聊天的回复工具扩展此模式。

## 在研究预览期间测试

在研究预览期间，每个频道都必须在[批准的允许列表](/zh-CN/channels#research-preview)上才能注册。开发标志在确认提示后绕过特定条目的允许列表。此示例显示两种条目类型：

```bash theme={null}
# 测试您正在开发的插件
claude --dangerously-load-development-channels plugin:yourplugin@yourmarketplace

# 测试裸 .mcp.json 服务器（尚无插件包装器）
claude --dangerously-load-development-channels server:webhook
```

绕过是按条目的。将此标志与 `--channels` 结合不会将绕过扩展到 `--channels` 条目。在研究预览期间，批准的允许列表由 Anthropic 策划，因此您的频道在您构建和测试时保持在开发标志上。

<Note>
  此标志仅跳过允许列表。`channelsEnabled` 组织政策仍然适用。不要使用它来运行来自不受信任来源的频道。
</Note>

## 服务器选项

频道在 [`Server`](https://modelcontextprotocol.io/docs/concepts/servers) 构造函数中设置这些选项。`instructions` 和 `capabilities.tools` 字段是[标准 MCP](https://modelcontextprotocol.io/docs/concepts/servers)；`capabilities.experimental['claude/channel']` 和 `capabilities.experimental['claude/channel/permission']` 是频道特定的添加：

| 字段                                                       | 类型       | 描述                                                                                                                |
| :------------------------------------------------------- | :------- | :---------------------------------------------------------------------------------------------------------------- |
| `capabilities.experimental['claude/channel']`            | `object` | 必需。始终为 `{}`。存在注册通知侦听器。                                                                                            |
| `capabilities.experimental['claude/channel/permission']` | `object` | 可选。始终为 `{}`。声明此频道可以接收权限中继请求。声明后，Claude Code 将工具批准提示转发到您的频道，以便您可以远程批准或拒绝它们。请参阅[中继权限提示](#relay-permission-prompts)。 |
| `capabilities.tools`                                     | `object` | 仅双向。始终为 `{}`。标准 MCP 工具能力。请参阅[公开回复工具](#expose-a-reply-tool)。                                                       |
| `instructions`                                           | `string` | 推荐。添加到 Claude 的系统提示。告诉 Claude 期望什么事件、`<channel>` 标签属性的含义、是否回复，如果是，使用哪个工具以及传回哪个属性（如 `chat_id`）。                    |

要创建单向频道，请省略 `capabilities.tools`。此示例显示双向设置，其中频道能力、工具和说明已设置：

```ts theme={null}
import { Server } from '@modelcontextprotocol/sdk/server/index.js'

const mcp = new Server(
  { name: 'your-channel', version: '0.0.1' },
  {
    capabilities: {
      experimental: { 'claude/channel': {} },  // 注册频道侦听器
      tools: {},  // 对于单向频道省略
    },
    // 添加到 Claude 的系统提示，以便它知道如何处理您的事件
    instructions: 'Messages arrive as <channel source="your-channel" ...>. Reply with the reply tool.',
  },
)
```

要推送事件，请使用方法 `notifications/claude/channel` 调用 `mcp.notification()`。参数在下一部分中。

## 通知格式

您的服务器使用两个参数发出 `notifications/claude/channel`：

| 字段        | 类型                       | 描述                                                                                             |
| :-------- | :----------------------- | :--------------------------------------------------------------------------------------------- |
| `content` | `string`                 | 事件主体。作为 `<channel>` 标签的主体传递。                                                                   |
| `meta`    | `Record<string, string>` | 可选。每个条目成为 `<channel>` 标签上的属性，用于路由上下文，如聊天 ID、发送者名称或警报严重性。键必须是标识符：仅字母、数字和下划线。包含连字符或其他字符的键会被静默删除。 |

您的服务器通过在 `Server` 实例上调用 `mcp.notification()` 来推送事件。此示例推送带有两个元键的 CI 失败警报：

```ts theme={null}
await mcp.notification({
  method: 'notifications/claude/channel',
  params: {
    content: 'build failed on main: https://ci.example.com/run/1234',
    meta: { severity: 'high', run_id: '1234' },
  },
})
```

事件在 Claude 的上下文中到达，包装在 `<channel>` 标签中。`source` 属性从您的服务器配置的名称自动设置：

```text theme={null}
<channel source="your-channel" severity="high" run_id="1234">
build failed on main: https://ci.example.com/run/1234
</channel>
```

## 公开回复工具

如果您的频道是双向的，如聊天桥接而不是警报转发器，请公开一个标准 [MCP 工具](https://modelcontextprotocol.io/docs/concepts/tools)，Claude 可以调用它来发送消息回复。关于工具注册的任何内容都不是频道特定的。回复工具有三个组件：

1. 您的 `Server` 构造函数能力中的 `tools: {}` 条目，以便 Claude Code 发现工具
2. 定义工具的架构并实现发送逻辑的工具处理程序
3. 您的 `Server` 构造函数中的 `instructions` 字符串，告诉 Claude 何时以及如何调用工具

要将这些添加到上面的[webhook 接收器](#example-build-a-webhook-receiver)：

<Steps>
  <Step title="启用工具发现">
    在您的 `Server` 构造函数中的 `webhook.ts` 中，将 `tools: {}` 添加到能力中，以便 Claude Code 知道您的服务器提供工具：

    ```ts theme={null}
    capabilities: {
      experimental: { 'claude/channel': {} },
      tools: {},  // 启用工具发现
    },
    ```
  </Step>

  <Step title="注册回复工具">
    将以下内容添加到 `webhook.ts`。`import` 与您的其他导入一起位于文件顶部；两个处理程序位于 `Server` 构造函数和 `mcp.connect()` 之间。这注册了一个 `reply` 工具，Claude 可以使用 `chat_id` 和 `text` 调用它：

    ```ts theme={null}
    // 在 webhook.ts 顶部添加此导入
    import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

    // Claude 在启动时查询此项以发现您的服务器提供什么工具
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{
        name: 'reply',
        description: 'Send a message back over this channel',
        // inputSchema 告诉 Claude 要传递什么参数
        inputSchema: {
          type: 'object',
          properties: {
            chat_id: { type: 'string', description: 'The conversation to reply in' },
            text: { type: 'string', description: 'The message to send' },
          },
          required: ['chat_id', 'text'],
        },
      }],
    }))

    // Claude 想要调用工具时调用此项
    mcp.setRequestHandler(CallToolRequestSchema, async req => {
      if (req.params.name === 'reply') {
        const { chat_id, text } = req.params.arguments as { chat_id: string; text: string }
        // send() 是您的出站：POST 到您的聊天平台，或用于本地
        // 测试下面完整示例中显示的 SSE 广播。
        send(`Reply to ${chat_id}: ${text}`)
        return { content: [{ type: 'text', text: 'sent' }] }
      }
      throw new Error(`unknown tool: ${req.params.name}`)
    })
    ```
  </Step>

  <Step title="更新说明">
    更新您的 `Server` 构造函数中的 `instructions` 字符串，以便 Claude 知道通过工具将回复路由回去。此示例告诉 Claude 从入站标签传递 `chat_id`：

    ```ts theme={null}
    instructions: 'Messages arrive as <channel source="webhook" chat_id="...">. Reply with the reply tool, passing the chat_id from the tag.'
    ```
  </Step>
</Steps>

这是完整的 `webhook.ts`，具有双向支持。出站回复通过 `GET /events` 使用 [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) (SSE) 流式传输，因此 `curl -N localhost:8788/events` 可以实时观看它们；入站聊天到达 `POST /`：

```ts title="Full webhook.ts with reply tool' expandable theme={null}
#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

// --- 出站：写入 /events 上的任何 curl -N 侦听器 ---
// 真实的桥接会改为 POST 到您的聊天平台。
const listeners = new Set<(chunk: string) => void>()
function send(text: string) {
  const chunk = text.split('\n').map(l => `data: ${l}\n`).join('') + '\n'
  for (const emit of listeners) emit(chunk)
}

const mcp = new Server(
  { name: 'webhook', version: '0.0.1' },
  {
    capabilities: {
      experimental: { 'claude/channel': {} },
      tools: {},
    },
    instructions: 'Messages arrive as <channel source="webhook" chat_id="...">. Reply with the reply tool, passing the chat_id from the tag.',
  },
)

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'reply',
    description: 'Send a message back over this channel',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'The conversation to reply in' },
        text: { type: 'string', description: 'The message to send' },
      },
      required: ['chat_id', 'text'],
    },
  }],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  if (req.params.name === 'reply') {
    const { chat_id, text } = req.params.arguments as { chat_id: string; text: string }
    send(`Reply to ${chat_id}: ${text}`)
    return { content: [{ type: 'text', text: 'sent' }] }
  }
  throw new Error(`unknown tool: ${req.params.name}`)
})

await mcp.connect(new StdioServerTransport())

let nextId = 1
Bun.serve({
  port: 8788,
  hostname: '127.0.0.1',
  idleTimeout: 0,  // 不要关闭空闲 SSE 流
  async fetch(req) {
    const url = new URL(req.url)

    // GET /events：SSE 流，以便 curl -N 可以实时观看 Claude 的回复
    if (req.method === 'GET' && url.pathname === '/events') {
      const stream = new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(': connected\n\n')  // 所以 curl 立即显示一些内容
          const emit = (chunk: string) => ctrl.enqueue(chunk)
          listeners.add(emit)
          req.signal.addEventListener('abort', () => listeners.delete(emit))
        },
      })
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      })
    }

    // POST：作为频道事件转发给 Claude
    const body = await req.text()
    const chat_id = String(nextId++)
    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: body,
        meta: { chat_id, path: url.pathname, method: req.method },
      },
    })
    return new Response('ok')
  },
})
```

[fakechat 服务器](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/fakechat)显示了一个更完整的示例，具有文件附件和消息编辑。

## 门控入站消息

未门控的频道是提示注入向量。任何可以到达您的端点的人都可以在 Claude 前面放置文本。侦听聊天平台或公共端点的频道需要在发出任何内容之前进行真正的发送者检查。

在调用 `mcp.notification()` 之前，根据允许列表检查发送者。此示例删除来自不在集合中的发送者的任何消息：

```ts theme={null}
const allowed = new Set(loadAllowlist())  // 从您的 access.json 或等效项

// 在您的消息处理程序中，在发出之前：
if (!allowed.has(message.from.id)) {  // 发送者，不是房间
  return  // 静默删除
}
await mcp.notification({ ... })
```

根据发送者的身份而不是聊天或房间身份进行门控：示例中的 `message.from.id`，而不是 `message.chat.id`。在群组聊天中，这些不同，根据房间进行门控会让允许列表中的任何人向会话注入消息。

[Telegram](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/telegram) 和 [Discord](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/discord) 频道以相同的方式在发送者允许列表上进行门控。它们通过配对引导列表：用户向机器人发送 DM，机器人回复配对代码，用户在其 Claude Code 会话中批准它，其平台 ID 被添加。有关完整配对流程，请参阅任一实现。[iMessage](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/imessage) 频道采用不同的方法：它在启动时从 Messages 数据库检测用户自己的地址，并自动让它们通过，其他发送者通过句柄添加。

## 中继权限提示

<Note>
  权限中继需要 Claude Code v2.1.81 或更高版本。较早的版本忽略 `claude/channel/permission` 能力。
</Note>

当 Claude 调用需要批准的工具时，本地终端对话打开，会话等待。双向频道可以选择加入以在并行接收相同的提示，并将其中继到您的另一台设备。两者都保持活动：您可以在终端或手机上回答，Claude Code 应用先到达的任何答案并关闭另一个。

中继涵盖工具使用批准，如 Bash、Write 和 Edit。项目信任和 MCP 服务器同意对话不中继；这些仅在本地终端中出现。

### 中继如何工作

当权限提示打开时，中继循环有四个步骤：

1. Claude Code 生成一个短请求 ID 并通知您的服务器
2. 您的服务器将提示和 ID 转发到您的聊天应用
3. 远程用户使用该 ID 回复是或否
4. 您的入站处理程序将回复解析为判决，Claude Code 仅在 ID 匹配开放请求时应用它

本地终端对话在所有这一切中保持打开。如果终端上的某人在远程判决到达之前回答，该答案将被应用，待处理的远程请求将被删除。

<img src="https://mintlify.s3.us-west-1.amazonaws.com/claude-code/zh-CN/images/channel-permission-relay.svg" alt="序列图：Claude Code 向频道服务器发送 permission_request 通知，服务器格式化并将提示发送到聊天应用，人类使用判决回复，服务器将该回复解析为权限通知回到 Claude Code" />

### 权限请求字段

来自 Claude Code 的出站通知是 `notifications/claude/channel/permission_request`。与[频道通知](#notification-format)一样，传输是标准 MCP，但方法和架构是 Claude Code 扩展。`params` 对象有四个字符串字段，您的服务器将其格式化为出站提示：

| 字段              | 描述                                                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `request_id`    | 从 `a`-`z` 中抽取的五个小写字母，不包括 `l`，因此在手机上输入时永远不会读作 `1` 或 `I`。将其包含在您的出站提示中，以便可以在回复中回显。Claude Code 仅接受携带其发出的 ID 的判决。本地终端对话不显示此 ID，因此您的出站处理程序是了解它的唯一方式。 |
| `tool_name`     | Claude 想要使用的工具的名称，例如 `Bash` 或 `Write`。                                                                                                         |
| `description`   | 此特定工具调用执行的操作的人类可读摘要，与本地终端对话显示的文本相同。对于 Bash 调用，这是 Claude 对命令的描述，或者如果没有给出，则是命令本身。                                                                |
| `input_preview` | 工具的参数作为 JSON 字符串，截断为 200 个字符。对于 Bash，这是命令；对于 Write，这是文件路径和内容的前缀。如果您只有一行消息的空间，请从您的提示中省略它。您的服务器决定显示什么。                                           |

您的服务器发送回的判决是 `notifications/claude/channel/permission`，有两个字段：`request_id` 回显上面的 ID，`behavior` 设置为 `'allow'` 或 `'deny'`。允许让工具调用继续；拒绝拒绝它，与在本地对话中回答"否"相同。两个判决都不影响未来的调用。

### 向聊天桥接添加中继

向双向频道添加权限中继需要三个组件：

1. 您的 `Server` 构造函数中 `experimental` 能力下的 `claude/channel/permission: {}` 条目，以便 Claude Code 知道转发提示
2. `notifications/claude/channel/permission_request` 的通知处理程序，格式化提示并通过您的平台 API 发送它
3. 您的入站消息处理程序中的检查，识别 `yes <id>` 或 `no <id>` 并发出 `notifications/claude/channel/permission` 判决通知，而不是将文本转发给 Claude

仅在您的频道[验证发送者](#gate-inbound-messages)时声明该能力，因为任何可以通过您的频道回复的人都可以批准或拒绝您会话中的工具使用。

要将这些添加到在[公开回复工具](#expose-a-reply-tool)中组装的双向聊天桥接：

<Steps>
  <Step title="声明权限能力">
    在您的 `Server` 构造函数中，在 `experimental` 下的 `claude/channel` 旁边添加 `claude/channel/permission: {}`：

    ```ts theme={null}
    capabilities: {
      experimental: {
        'claude/channel': {},
        'claude/channel/permission': {},  // 选择加入权限中继
      },
      tools: {},
    },
    ```
  </Step>

  <Step title="处理传入请求">
    在您的 `Server` 构造函数和 `mcp.connect()` 之间注册一个通知处理程序。当权限对话打开时，Claude Code 使用[四个请求字段](#permission-request-fields)调用它。您的处理程序为您的平台格式化提示，并包括使用 ID 回复的说明：

    ```ts theme={null}
    import { z } from 'zod'

    // setNotificationHandler 通过 z.literal 在方法字段上路由，
    // 所以这个架构既是验证器又是调度键
    const PermissionRequestSchema = z.object({
      method: z.literal('notifications/claude/channel/permission_request'),
      params: z.object({
        request_id: z.string(),     // 五个小写字母，在您的提示中逐字包含
        tool_name: z.string(),      // 例如 "Bash"、"Write"
        description: z.string(),    // 此调用的人类可读摘要
        input_preview: z.string(),  // 工具参数作为 JSON，截断为 ~200 个字符
      }),
    })

    mcp.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
      // send() 是您的出站：POST 到您的聊天平台，或用于本地
      // 测试下面完整示例中显示的 SSE 广播。
      send(
        `Claude wants to run ${params.tool_name}: ${params.description}\n\n` +
        // 说明中的 ID 是您的入站处理程序在步骤 3 中解析的内容
        `Reply "yes ${params.request_id}" or "no ${params.request_id}"`,
      )
    })
    ```
  </Step>

  <Step title="在您的入站处理程序中拦截判决">
    您的入站处理程序是接收来自您的平台的消息的循环或回调：与您[根据发送者进行门控](#gate-inbound-messages)和发出 `notifications/claude/channel` 以将聊天转发给 Claude 的地方相同。在聊天转发调用之前添加一个检查，识别判决格式并改为发出权限通知。

    正则表达式匹配 Claude Code 生成的 ID 格式：五个字母，永远不是 `l`。`/i` 标志容忍手机自动更正将回复大写；在将其发送回之前将捕获的 ID 小写。

    ```ts theme={null}
    // 匹配 "y abcde"、"yes abcde"、"n abcde"、"no abcde"
    // [a-km-z] 是 Claude Code 使用的 ID 字母表（小写，跳过 'l'）
    // /i 容忍手机自动更正；在发送前小写捕获
    const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i

    async function onInbound(message: PlatformMessage) {
      if (!allowed.has(message.from.id)) return  // 首先根据发送者进行门控

      const m = PERMISSION_REPLY_RE.exec(message.text)
      if (m) {
        // m[1] 是判决词，m[2] 是请求 ID
        // 将判决通知发出回 Claude Code，而不是聊天
        await mcp.notification({
          method: 'notifications/claude/channel/permission',
          params: {
            request_id: m[2].toLowerCase(),  // 在自动更正大写的情况下规范化
            behavior: m[1].toLowerCase().startsWith('y') ? 'allow' : 'deny',
          },
        })
        return  // 作为判决处理，不要也转发为聊天
      }

      // 不匹配判决格式：落入正常聊天路径
      await mcp.notification({
        method: 'notifications/claude/channel',
        params: { content: message.text, meta: { chat_id: String(message.chat.id) } },
      })
    }
    ```
  </Step>
</Steps>

Claude Code 也保持本地终端对话打开，因此您可以在任一地方回答，第一个到达的答案被应用。不完全匹配预期格式的远程回复以两种方式之一失败，在两种情况下对话都保持打开：

* **不同格式**：您的入站处理程序的正则表达式无法匹配，因此 `approve it` 或 `yes` 之类的文本（没有 ID）会作为正常消息落入 Claude。
* **正确格式，错误的 ID**：您的服务器发出判决，但 Claude Code 找不到具有该 ID 的开放请求并静默删除它。

### 完整示例

下面组装的 `webhook.ts` 结合了本页的所有三个扩展：回复工具、发送者门控和权限中继。如果您从这里开始，您还需要初始演练中的[项目设置和 `.mcp.json` 条目](#example-build-a-webhook-receiver)。

为了使两个方向都可以从 curl 测试，HTTP 侦听器提供两个路径：

* **`GET /events`**：保持 SSE 流打开并将每个出站消息作为 `data:` 行推送，因此 `curl -N` 可以实时观看 Claude 的回复和权限提示到达。
* **`POST /`**：入站端，与之前相同的处理程序，现在在聊天转发分支之前插入了判决格式检查。

```ts title="Full webhook.ts with permission relay' expandable theme={null}
#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

// --- 出站：写入 /events 上的任何 curl -N 侦听器 ---
// 真实的桥接会改为 POST 到您的聊天平台。
const listeners = new Set<(chunk: string) => void>()
function send(text: string) {
  const chunk = text.split('\n').map(l => `data: ${l}\n`).join('') + '\n'
  for (const emit of listeners) emit(chunk)
}

// 发送者允许列表。对于本地演练，我们信任单个 X-Sender
// 标头值 "dev"；真实的桥接会检查平台的用户 ID。
const allowed = new Set(['dev'])

const mcp = new Server(
  { name: 'webhook', version: '0.0.1' },
  {
    capabilities: {
      experimental: {
        'claude/channel': {},
        'claude/channel/permission': {},  // 选择加入权限中继
      },
      tools: {},
    },
    instructions:
      'Messages arrive as <channel source="webhook" chat_id="...">. ' +
      'Reply with the reply tool, passing the chat_id from the tag.',
  },
)

// --- 回复工具：Claude 调用此项以发送消息回复 ---
mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'reply',
    description: 'Send a message back over this channel',
    inputSchema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'The conversation to reply in' },
        text: { type: 'string', description: 'The message to send' },
      },
      required: ['chat_id', 'text'],
    },
  }],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  if (req.params.name === 'reply') {
    const { chat_id, text } = req.params.arguments as { chat_id: string; text: string }
    send(`Reply to ${chat_id}: ${text}`)
    return { content: [{ type: 'text', text: 'sent' }] }
  }
  throw new Error(`unknown tool: ${req.params.name}`)
})

// --- 权限中继：当对话打开时，Claude Code（不是 Claude）调用此项
const PermissionRequestSchema = z.object({
  method: z.literal('notifications/claude/channel/permission_request'),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
})

mcp.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
  send(
    `Claude wants to run ${params.tool_name}: ${params.description}\n\n` +
    `Reply "yes ${params.request_id}" or "no ${params.request_id}"`,
  )
})

await mcp.connect(new StdioServerTransport())

// --- HTTP on :8788：GET /events 流出站，POST 路由入站 ---
const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i
let nextId = 1

Bun.serve({
  port: 8788,
  hostname: '127.0.0.1',
  idleTimeout: 0,  // 不要关闭空闲 SSE 流
  async fetch(req) {
    const url = new URL(req.url)

    // GET /events：SSE 流，以便 curl -N 可以实时观看回复和提示
    if (req.method === 'GET' && url.pathname === '/events') {
      const stream = new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(': connected\n\n')  // 所以 curl 立即显示一些内容
          const emit = (chunk: string) => ctrl.enqueue(chunk)
          listeners.add(emit)
          req.signal.addEventListener('abort', () => listeners.delete(emit))
        },
      })
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      })
    }

    // 其他一切都是入站：首先根据发送者进行门控
    const body = await req.text()
    const sender = req.headers.get('X-Sender') ?? ''
    if (!allowed.has(sender)) return new Response('forbidden', { status: 403 })

    // 在将其视为聊天之前检查判决格式
    const m = PERMISSION_REPLY_RE.exec(body)
    if (m) {
      await mcp.notification({
        method: 'notifications/claude/channel/permission',
        params: {
          request_id: m[2].toLowerCase(),
          behavior: m[1].toLowerCase().startsWith('y') ? 'allow' : 'deny',
        },
      })
      return new Response('verdict recorded')
    }

    // 正常聊天：作为频道事件转发给 Claude
    const chat_id = String(nextId++)
    await mcp.notification({
      method: 'notifications/claude/channel',
      params: { content: body, meta: { chat_id, path: url.pathname } },
    })
    return new Response('ok')
  },
})
```

在三个终端中测试判决路径。第一个是您的 Claude Code 会话，使用[开发标志](#test-during-the-research-preview)启动，以便它生成 `webhook.ts`：

```bash theme={null}
claude --dangerously-load-development-channels server:webhook
```

在第二个中，流出站端，以便您可以看到 Claude 的回复和任何权限提示在它们触发时到达：

```bash theme={null}
curl -N localhost:8788/events
```

在第三个中，发送一条消息，使 Claude 尝试运行命令：

```bash theme={null}
curl -d "list the files in this directory" -H "X-Sender: dev" localhost:8788
```

本地权限对话在您的 Claude Code 终端中打开。片刻后，提示出现在 `/events` 流中，包括五字母 ID。从远程端批准它：

```bash theme={null}
curl -d "yes <id>" -H "X-Sender: dev" localhost:8788
```

本地对话关闭，工具运行。Claude 的回复通过 `reply` 工具返回并也在流中着陆。

此文件中的三个频道特定部分：

* **`Server` 构造函数中的能力**：`claude/channel` 注册通知侦听器，`claude/channel/permission` 选择加入权限中继，`tools` 让 Claude 发现回复工具。
* **出站路径**：`reply` 工具处理程序是 Claude 为会话响应调用的；`PermissionRequestSchema` 通知处理程序是当权限对话打开时 Claude Code 调用的。两者都调用 `send()` 通过 `/events` 广播，但它们由系统的不同部分触发。
* **HTTP 处理程序**：`GET /events` 保持 SSE 流打开，以便 curl 可以实时观看出站；`POST` 是入站，根据 `X-Sender` 标头进行门控。`yes <id>` 或 `no <id>` 主体作为判决通知进入 Claude Code，永远不会到达 Claude；其他任何东西都作为频道事件转发给 Claude。

## 打包为插件

要使您的频道可安装和可共享，请将其包装在[插件](/zh-CN/plugins)中并将其发布到[市场](/zh-CN/plugin-marketplaces)。用户使用 `/plugin install` 安装它，然后使用 `--channels plugin:<name>@<marketplace>` 按会话启用它。

发布到您自己的市场的频道仍然需要 `--dangerously-load-development-channels` 来运行，因为它不在[批准的允许列表](/zh-CN/channels#supported-channels)上。要将其添加，[将其提交到官方市场](/zh-CN/plugins#submit-your-plugin-to-the-official-marketplace)。频道插件在被批准之前经过安全审查。在 Team 和 Enterprise 计划上，管理员可以改为将您的插件包含在组织自己的 [`allowedChannelPlugins`](/zh-CN/channels#restrict-which-channel-plugins-can-run) 列表中，该列表替换默认的 Anthropic 允许列表。

## 另请参阅

* [Channels](/zh-CN/channels) 安装和使用 Telegram、Discord、iMessage 或 fakechat 演示，以及为 Team 或 Enterprise 组织启用频道
* [工作频道实现](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins)用于具有配对流、回复工具和文件附件的完整服务器代码
* [MCP](/zh-CN/mcp) 用于频道服务器实现的基础协议
* [Plugins](/zh-CN/plugins) 打包您的频道，以便用户可以使用 `/plugin install` 安装它
