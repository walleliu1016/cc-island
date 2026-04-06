> ## Documentation Index
> Fetch the complete documentation index at: https://code.claude.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Hooks 参考

> Claude Code hook 事件、配置架构、JSON 输入/输出格式、退出代码、异步 hooks、HTTP hooks、提示 hooks 和 MCP 工具 hooks 的参考。

<Tip>
  有关包含示例的快速入门指南，请参阅[使用 hooks 自动化工作流](/zh-CN/hooks-guide)。
</Tip>

Hooks 是用户定义的 shell 命令、HTTP 端点或 LLM 提示，在 Claude Code 生命周期中的特定点自动执行。使用此参考查找事件架构、配置选项、JSON 输入/输出格式以及异步 hooks、HTTP hooks 和 MCP 工具 hooks 等高级功能。如果您是第一次设置 hooks，请改为从[指南](/zh-CN/hooks-guide)开始。

## Hook 生命周期

Hooks 在 Claude Code 会话期间的特定点触发。当事件触发且匹配器匹配时，Claude Code 会将关于该事件的 JSON 上下文传递给您的 hook 处理程序。对于命令 hooks，输入通过 stdin 到达。对于 HTTP hooks，它作为 POST 请求体到达。您的处理程序随后可以检查输入、采取行动并可选地返回决定。某些事件每个会话触发一次，而其他事件在代理循环内重复触发：

<div style={{maxWidth: "500px", margin: "0 auto"}}>
  <Frame>
    <img src="https://mintcdn.com/claude-code/WLZtXlltXc8aIoIM/images/hooks-lifecycle.svg?fit=max&auto=format&n=WLZtXlltXc8aIoIM&q=85&s=6a0bf67eeb570a96e36b564721fa2a93" alt="Hook 生命周期图，显示从 SessionStart 通过代理循环（PreToolUse、PermissionRequest、PostToolUse、SubagentStart/Stop、TaskCreated、TaskCompleted）到 Stop 或 StopFailure、TeammateIdle、PreCompact、PostCompact 和 SessionEnd 的 hooks 序列，Elicitation 和 ElicitationResult 嵌套在 MCP 工具执行内，PermissionDenied 作为 PermissionRequest 的副分支用于自动模式拒绝，WorktreeCreate、WorktreeRemove、Notification、ConfigChange、InstructionsLoaded、CwdChanged 和 FileChanged 作为独立异步事件" width="520" height="1155" data-path="images/hooks-lifecycle.svg" />
  </Frame>
</div>

下表总结了每个事件何时触发。[Hook 事件](#hook-events)部分记录了每个事件的完整输入架构和决定控制选项。

| Event                | When it fires                                                                                                                                          |
| :------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionStart`       | When a session begins or resumes                                                                                                                       |
| `UserPromptSubmit`   | When you submit a prompt, before Claude processes it                                                                                                   |
| `PreToolUse`         | Before a tool call executes. Can block it                                                                                                              |
| `PermissionRequest`  | When a permission dialog appears                                                                                                                       |
| `PermissionDenied`   | When a tool call is denied by the auto mode classifier. Return `{retry: true}` to tell the model it may retry the denied tool call                     |
| `PostToolUse`        | After a tool call succeeds                                                                                                                             |
| `PostToolUseFailure` | After a tool call fails                                                                                                                                |
| `Notification`       | When Claude Code sends a notification                                                                                                                  |
| `SubagentStart`      | When a subagent is spawned                                                                                                                             |
| `SubagentStop`       | When a subagent finishes                                                                                                                               |
| `TaskCreated`        | When a task is being created via `TaskCreate`                                                                                                          |
| `TaskCompleted`      | When a task is being marked as completed                                                                                                               |
| `Stop`               | When Claude finishes responding                                                                                                                        |
| `StopFailure`        | When the turn ends due to an API error. Output and exit code are ignored                                                                               |
| `TeammateIdle`       | When an [agent team](/en/agent-teams) teammate is about to go idle                                                                                     |
| `InstructionsLoaded` | When a CLAUDE.md or `.claude/rules/*.md` file is loaded into context. Fires at session start and when files are lazily loaded during a session         |
| `ConfigChange`       | When a configuration file changes during a session                                                                                                     |
| `CwdChanged`         | When the working directory changes, for example when Claude executes a `cd` command. Useful for reactive environment management with tools like direnv |
| `FileChanged`        | When a watched file changes on disk. The `matcher` field specifies which filenames to watch                                                            |
| `WorktreeCreate`     | When a worktree is being created via `--worktree` or `isolation: "worktree"`. Replaces default git behavior                                            |
| `WorktreeRemove`     | When a worktree is being removed, either at session exit or when a subagent finishes                                                                   |
| `PreCompact`         | Before context compaction                                                                                                                              |
| `PostCompact`        | After context compaction completes                                                                                                                     |
| `Elicitation`        | When an MCP server requests user input during a tool call                                                                                              |
| `ElicitationResult`  | After a user responds to an MCP elicitation, before the response is sent back to the server                                                            |
| `SessionEnd`         | When a session terminates                                                                                                                              |

### Hook 如何解析

要了解这些部分如何组合在一起，请考虑这个 `PreToolUse` hook，它阻止破坏性 shell 命令。`matcher` 缩小到 Bash 工具调用，`if` 条件进一步缩小到以 `rm` 开头的命令，因此 `block-rm.sh` 仅在两个过滤器都匹配时生成：

```json  theme={null}
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "if": "Bash(rm *)",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/block-rm.sh"
          }
        ]
      }
    ]
  }
}
```

该脚本从 stdin 读取 JSON 输入，提取命令，如果包含 `rm -rf`，则返回 `permissionDecision` 为 `"deny"`：

```bash  theme={null}
#!/bin/bash
# .claude/hooks/block-rm.sh
COMMAND=$(jq -r '.tool_input.command')

if echo "$COMMAND" | grep -q 'rm -rf'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Destructive command blocked by hook"
    }
  }'
else
  exit 0  # allow the command
fi
```

现在假设 Claude Code 决定运行 `Bash "rm -rf /tmp/build"`。以下是发生的情况：

<Frame>
  <img src="https://mintcdn.com/claude-code/-tYw1BD_DEqfyyOZ/images/hook-resolution.svg?fit=max&auto=format&n=-tYw1BD_DEqfyyOZ&q=85&s=c73ebc1eeda2037570427d7af1e0a891" alt="Hook 解析流程：PreToolUse 事件触发，匹配器检查 Bash 匹配，if 条件检查 Bash(rm *) 匹配，hook 处理程序运行，结果返回到 Claude Code" width="930" height="290" data-path="images/hook-resolution.svg" />
</Frame>

<Steps>
  <Step title="事件触发">
    `PreToolUse` 事件触发。Claude Code 将工具输入作为 JSON 通过 stdin 发送到 hook：

    ```json  theme={null}
    { "tool_name": "Bash", "tool_input": { "command": "rm -rf /tmp/build" }, ... }
    ```
  </Step>

  <Step title="匹配器检查">
    匹配器 `"Bash"` 与工具名称匹配，因此此 hook 组激活。如果您省略匹配器或使用 `"*"`，该组在事件的每次出现时激活。
  </Step>

  <Step title="If 条件检查">
    `if` 条件 `"Bash(rm *)"` 匹配，因为命令以 `rm` 开头，因此此处理程序生成。如果命令是 `npm test`，`if` 检查会失败，`block-rm.sh` 永远不会运行，避免进程生成开销。`if` 字段是可选的；没有它，匹配组中的每个处理程序都运行。
  </Step>

  <Step title="Hook 处理程序运行">
    脚本检查完整命令并找到 `rm -rf`，因此它将决定打印到 stdout：

    ```json  theme={null}
    {
      "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": "Destructive command blocked by hook"
      }
    }
    ```

    如果命令是更安全的 `rm` 变体，如 `rm file.txt`，脚本会改为执行 `exit 0`，这告诉 Claude Code 允许工具调用而无需进一步操作。
  </Step>

  <Step title="Claude Code 对结果采取行动">
    Claude Code 读取 JSON 决定，阻止工具调用，并向 Claude 显示原因。
  </Step>
</Steps>

下面的[配置](#configuration)部分记录了完整的架构，每个[hook 事件](#hook-events)部分记录了您的命令接收的输入以及它可以返回的输出。

## 配置

Hooks 在 JSON 设置文件中定义。配置有三个嵌套级别：

1. 选择要响应的[hook 事件](#hook-events)，如 `PreToolUse` 或 `Stop`
2. 添加[匹配器组](#matcher-patterns)以过滤何时触发，如"仅针对 Bash 工具"
3. 定义一个或多个[hook 处理程序](#hook-handler-fields)以在匹配时运行

有关完整的演练和带注释的示例，请参阅上面的[Hook 如何解析](#how-a-hook-resolves)。

<Note>
  此页面为每个级别使用特定术语：**hook 事件**表示生命周期点，**匹配器组**表示过滤器，**hook 处理程序**表示运行的 shell 命令、HTTP 端点、提示或代理。"Hook"本身指的是一般功能。
</Note>

### Hook 位置

您定义 hook 的位置决定了其范围：

| 位置                                                          | 范围     | 可共享          |
| :---------------------------------------------------------- | :----- | :----------- |
| `~/.claude/settings.json`                                   | 您的所有项目 | 否，本地于您的计算机   |
| `.claude/settings.json`                                     | 单个项目   | 是，可以提交到仓库    |
| `.claude/settings.local.json`                               | 单个项目   | 否，gitignored |
| 托管策略设置                                                      | 组织范围   | 是，管理员控制      |
| [Plugin](/zh-CN/plugins) `hooks/hooks.json`                 | 启用插件时  | 是，与插件捆绑      |
| [Skill](/zh-CN/skills) 或[代理](/zh-CN/sub-agents) frontmatter | 组件活跃时  | 是，在组件文件中定义   |

有关设置文件解析的详细信息，请参阅[设置](/zh-CN/settings)。企业管理员可以使用 `allowManagedHooksOnly` 来阻止用户、项目和插件 hooks。请参阅[Hook 配置](/zh-CN/settings#hook-configuration)。

### 匹配器模式

`matcher` 字段是一个正则表达式字符串，用于过滤 hooks 何时触发。使用 `"*"`、`""` 或完全省略 `matcher` 以匹配所有出现。每个事件类型在不同的字段上匹配：

| 事件                                                                                                       | 匹配器过滤的内容     | 示例匹配器值                                                                                                              |
| :------------------------------------------------------------------------------------------------------- | :----------- | :------------------------------------------------------------------------------------------------------------------ |
| `PreToolUse`、`PostToolUse`、`PostToolUseFailure`、`PermissionRequest`、`PermissionDenied`                   | 工具名称         | `Bash`、`Edit\|Write`、`mcp__.*`                                                                                      |
| `SessionStart`                                                                                           | 会话如何启动       | `startup`、`resume`、`clear`、`compact`                                                                                |
| `SessionEnd`                                                                                             | 会话为何结束       | `clear`、`resume`、`logout`、`prompt_input_exit`、`bypass_permissions_disabled`、`other`                                 |
| `Notification`                                                                                           | 通知类型         | `permission_prompt`、`idle_prompt`、`auth_success`、`elicitation_dialog`                                               |
| `SubagentStart`                                                                                          | 代理类型         | `Bash`、`Explore`、`Plan` 或自定义代理名称                                                                                    |
| `PreCompact`、`PostCompact`                                                                               | 触发压缩的原因      | `manual`、`auto`                                                                                                     |
| `SubagentStop`                                                                                           | 代理类型         | 与 `SubagentStart` 相同的值                                                                                              |
| `ConfigChange`                                                                                           | 配置源          | `user_settings`、`project_settings`、`local_settings`、`policy_settings`、`skills`                                      |
| `CwdChanged`                                                                                             | 不支持匹配器       | 总是在每次目录更改时触发                                                                                                        |
| `FileChanged`                                                                                            | 文件名（更改文件的基名） | `.envrc`、`.env`、任何您想监视的文件名                                                                                          |
| `StopFailure`                                                                                            | 错误类型         | `rate_limit`、`authentication_failed`、`billing_error`、`invalid_request`、`server_error`、`max_output_tokens`、`unknown` |
| `InstructionsLoaded`                                                                                     | 加载原因         | `session_start`、`nested_traversal`、`path_glob_match`、`include`、`compact`                                            |
| `Elicitation`                                                                                            | MCP 服务器名称    | 您配置的 MCP 服务器名称                                                                                                      |
| `ElicitationResult`                                                                                      | MCP 服务器名称    | 与 `Elicitation` 相同的值                                                                                                |
| `UserPromptSubmit`、`Stop`、`TeammateIdle`、`TaskCreated`、`TaskCompleted`、`WorktreeCreate`、`WorktreeRemove` | 不支持匹配器       | 总是在每次出现时触发                                                                                                          |

匹配器是一个正则表达式，所以 `Edit|Write` 匹配任一工具，`Notebook.*` 匹配任何以 Notebook 开头的工具。匹配器针对 Claude Code 在 stdin 上发送给您的 hook 的[JSON 输入](#hook-input-and-output)中的字段运行。对于工具事件，该字段是 `tool_name`。每个[hook 事件](#hook-events)部分列出了完整的匹配器值集和该事件的输入架构。

此示例仅在 Claude 写入或编辑文件时运行 linting 脚本：

```json  theme={null}
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/lint-check.sh"
          }
        ]
      }
    ]
  }
}
```

`UserPromptSubmit`、`Stop`、`TeammateIdle`、`TaskCreated`、`TaskCompleted`、`WorktreeCreate`、`WorktreeRemove` 和 `CwdChanged` 不支持匹配器，总是在每次出现时触发。如果您向这些事件添加 `matcher` 字段，它会被静默忽略。

对于工具事件，您可以通过在单个 hook 处理程序上设置[`if` 字段](#common-fields)来更狭隘地过滤。`if` 使用[权限规则语法](/zh-CN/permissions)来匹配工具名称和参数，因此 `"Bash(git *)"` 仅对 `git` 命令运行，`"Edit(*.ts)"` 仅对 TypeScript 文件运行。

#### 匹配 MCP 工具

[MCP](/zh-CN/mcp) 服务器工具在工具事件中显示为常规工具（`PreToolUse`、`PostToolUse`、`PostToolUseFailure`、`PermissionRequest`、`PermissionDenied`），因此您可以像匹配任何其他工具名称一样匹配它们。

MCP 工具遵循命名模式 `mcp__<server>__<tool>`，例如：

* `mcp__memory__create_entities`：Memory 服务器的创建实体工具
* `mcp__filesystem__read_file`：Filesystem 服务器的读取文件工具
* `mcp__github__search_repositories`：GitHub 服务器的搜索工具

使用正则表达式模式来针对特定 MCP 工具或工具组：

* `mcp__memory__.*` 匹配来自 `memory` 服务器的所有工具
* `mcp__.*__write.*` 匹配来自任何服务器的任何包含"write"的工具

此示例记录所有内存服务器操作并验证来自任何 MCP 服务器的写入操作：

```json  theme={null}
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__memory__.*",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Memory operation initiated' >> ~/mcp-operations.log"
          }
        ]
      },
      {
        "matcher": "mcp__.*__write.*",
        "hooks": [
          {
            "type": "command",
            "command": "/home/user/scripts/validate-mcp-write.py"
          }
        ]
      }
    ]
  }
}
```

### Hook 处理程序字段

内部 `hooks` 数组中的每个对象都是一个 hook 处理程序：当匹配器匹配时运行的 shell 命令、HTTP 端点、LLM 提示或代理。有四种类型：

* **[命令 hooks](#command-hook-fields)**（`type: "command"`）：运行 shell 命令。您的脚本在 stdin 上接收事件的[JSON 输入](#hook-input-and-output)，并通过退出代码和 stdout 传回结果。
* **[HTTP hooks](#http-hook-fields)**（`type: "http"`）：将事件的 JSON 输入作为 HTTP POST 请求发送到 URL。端点通过使用与命令 hooks 相同的[JSON 输出格式](#json-output)的响应体传回结果。
* **[提示 hooks](#prompt-and-agent-hook-fields)**（`type: "prompt"`）：向 Claude 模型发送提示以进行单轮评估。模型返回 yes/no 决定作为 JSON。请参阅[基于提示的 hooks](#prompt-based-hooks)。
* **[代理 hooks](#prompt-and-agent-hook-fields)**（`type: "agent"`）：生成一个可以使用 Read、Grep 和 Glob 等工具来验证条件的 subagent，然后返回决定。请参阅[基于代理的 hooks](#agent-based-hooks)。

#### 通用字段

这些字段适用于所有 hook 类型：

| 字段              | 必需 | 描述                                                                                                                                                                                                                                                  |
| :-------------- | :- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`          | 是  | `"command"`、`"http"`、`"prompt"` 或 `"agent"`                                                                                                                                                                                                         |
| `if`            | 否  | 权限规则语法以过滤此 hook 何时运行，例如 `"Bash(git *)"` 或 `"Edit(*.ts)"`。仅当工具调用与模式匹配时，hook 才会生成。仅在工具事件上评估：`PreToolUse`、`PostToolUse`、`PostToolUseFailure`、`PermissionRequest` 和 `PermissionDenied`。在其他事件上，设置了 `if` 的 hook 永远不会运行。使用与[权限规则](/zh-CN/permissions)相同的语法 |
| `timeout`       | 否  | 取消前的秒数。默认值：命令 600、提示 30、代理 60                                                                                                                                                                                                                       |
| `statusMessage` | 否  | hook 运行时显示的自定义加载程序消息                                                                                                                                                                                                                                |
| `once`          | 否  | 如果为 `true`，每个会话仅运行一次，然后被移除。仅限 skills，不是代理。请参阅[skills 和代理中的 Hooks](#hooks-in-skills-and-agents)                                                                                                                                                      |

#### 命令 hook 字段

除了[通用字段](#common-fields)外，命令 hooks 还接受这些字段：

| 字段        | 必需 | 描述                                                                                                                                                              |
| :-------- | :- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `command` | 是  | 要执行的 shell 命令                                                                                                                                                   |
| `async`   | 否  | 如果为 `true`，在后台运行而不阻止。请参阅[在后台运行 hooks](#run-hooks-in-the-background)                                                                                             |
| `shell`   | 否  | 用于此 hook 的 shell。接受 `"bash"`（默认）或 `"powershell"`。设置 `"powershell"` 在 Windows 上通过 PowerShell 运行命令。不需要 `CLAUDE_CODE_USE_POWERSHELL_TOOL`，因为 hooks 直接生成 PowerShell |

#### HTTP hook 字段

除了[通用字段](#common-fields)外，HTTP hooks 还接受这些字段：

| 字段               | 必需 | 描述                                                                                      |
| :--------------- | :- | :-------------------------------------------------------------------------------------- |
| `url`            | 是  | 发送 POST 请求的 URL                                                                         |
| `headers`        | 否  | 其他 HTTP 标头作为键值对。值支持使用 `$VAR_NAME` 或 `${VAR_NAME}` 语法的环境变量插值。仅解析 `allowedEnvVars` 中列出的变量 |
| `allowedEnvVars` | 否  | 可能被插值到标头值中的环境变量名称列表。对未列出变量的引用被替换为空字符串。任何环境变量插值都需要此项                                     |

Claude Code 使用 `Content-Type: application/json` 将 hook 的[JSON 输入](#hook-input-and-output)作为 POST 请求体发送。响应体使用与命令 hooks 相同的[JSON 输出格式](#json-output)。

错误处理与命令 hooks 不同：非 2xx 响应、连接失败和超时都会产生非阻止错误，允许执行继续。要阻止工具调用或拒绝权限，返回 2xx 响应，其 JSON 体包含 `decision: "block"` 或 `hookSpecificOutput` 与 `permissionDecision: "deny"`。

此示例将 `PreToolUse` 事件发送到本地验证服务，使用来自 `MY_TOKEN` 环境变量的令牌进行身份验证：

```json  theme={null}
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:8080/hooks/pre-tool-use",
            "timeout": 30,
            "headers": {
              "Authorization": "Bearer $MY_TOKEN"
            },
            "allowedEnvVars": ["MY_TOKEN"]
          }
        ]
      }
    ]
  }
}
```

#### 提示和代理 hook 字段

除了[通用字段](#common-fields)外，提示和代理 hooks 还接受这些字段：

| 字段       | 必需 | 描述                                               |
| :------- | :- | :----------------------------------------------- |
| `prompt` | 是  | 要发送给模型的提示文本。使用 `$ARGUMENTS` 作为 hook 输入 JSON 的占位符 |
| `model`  | 否  | 用于评估的模型。默认为快速模型                                  |

所有匹配的 hooks 并行运行，相同的处理程序会自动去重。命令 hooks 按命令字符串去重，HTTP hooks 按 URL 去重。处理程序在当前目录中运行，使用 Claude Code 的环境。在远程 web 环境中，`$CLAUDE_CODE_REMOTE` 环境变量设置为 `"true"`，在本地 CLI 中未设置。

### 按路径引用脚本

使用环境变量按项目或插件根目录引用 hook 脚本，无论 hook 运行时的工作目录如何：

* `$CLAUDE_PROJECT_DIR`：项目根目录。用引号包装以处理包含空格的路径。
* `${CLAUDE_PLUGIN_ROOT}`：插件的安装目录，用于与[插件](/zh-CN/plugins)捆绑的脚本。在每次插件更新时更改。
* `${CLAUDE_PLUGIN_DATA}`：插件的[持久数据目录](/zh-CN/plugins-reference#persistent-data-directory)，用于应该在插件更新后保留的依赖项和状态。

<Tabs>
  <Tab title="项目脚本">
    此示例使用 `$CLAUDE_PROJECT_DIR` 在任何 `Write` 或 `Edit` 工具调用后从项目的 `.claude/hooks/` 目录运行样式检查器：

    ```json  theme={null}
    {
      "hooks": {
        "PostToolUse": [
          {
            "matcher": "Write|Edit",
            "hooks": [
              {
                "type": "command",
                "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/check-style.sh"
              }
            ]
          }
        ]
      }
    }
    ```
  </Tab>

  <Tab title="插件脚本">
    在 `hooks/hooks.json` 中定义插件 hooks，带有可选的顶级 `description` 字段。启用插件时，其 hooks 与您的用户和项目 hooks 合并。

    此示例运行与插件捆绑的格式化脚本：

    ```json  theme={null}
    {
      "description": "Automatic code formatting",
      "hooks": {
        "PostToolUse": [
          {
            "matcher": "Write|Edit",
            "hooks": [
              {
                "type": "command",
                "command": "${CLAUDE_PLUGIN_ROOT}/scripts/format.sh",
                "timeout": 30
              }
            ]
          }
        ]
      }
    }
    ```

    有关创建插件 hooks 的详细信息，请参阅[插件组件参考](/zh-CN/plugins-reference#hooks)。
  </Tab>
</Tabs>

### Skills 和代理中的 Hooks

除了设置文件和插件外，hooks 还可以使用 frontmatter 直接在[skills](/zh-CN/skills)和[subagents](/zh-CN/sub-agents)中定义。这些 hooks 的范围限于组件的生命周期，仅在该组件活跃时运行。

支持所有 hook 事件。对于 subagents，`Stop` hooks 会自动转换为 `SubagentStop`，因为这是 subagent 完成时触发的事件。

Hooks 使用与基于设置的 hooks 相同的配置格式，但范围限于组件的生命周期，并在其完成时清理。

此 skill 定义了一个 `PreToolUse` hook，在每个 `Bash` 命令之前运行安全验证脚本：

```yaml  theme={null}
---
name: secure-operations
description: Perform operations with security checks
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/security-check.sh"
---
```

代理在其 YAML frontmatter 中使用相同的格式。

### `/hooks` 菜单

在 Claude Code 中键入 `/hooks` 以打开您配置的 hooks 的只读浏览器。菜单显示每个 hook 事件及其配置的 hooks 计数，让您深入了解匹配器，并显示每个 hook 处理程序的完整详细信息。使用它来验证配置、检查 hook 来自哪个设置文件，或检查 hook 的命令、提示或 URL。

菜单显示所有四种 hook 类型：`command`、`prompt`、`agent` 和 `http`。每个 hook 都标有 `[type]` 前缀和指示其定义位置的源：

* `User`：来自 `~/.claude/settings.json`
* `Project`：来自 `.claude/settings.json`
* `Local`：来自 `.claude/settings.local.json`
* `Plugin`：来自插件的 `hooks/hooks.json`
* `Session`：在当前会话中在内存中注册
* `Built-in`：由 Claude Code 内部注册

选择 hook 会打开详细视图，显示其事件、匹配器、类型、源文件以及完整的命令、提示或 URL。菜单是只读的：要添加、修改或移除 hooks，请直接编辑设置 JSON 或要求 Claude 进行更改。

### 禁用或移除 hooks

要移除 hook，请从设置 JSON 文件中删除其条目。

要临时禁用所有 hooks 而不移除它们，请在设置文件中设置 `"disableAllHooks": true`。没有办法在保持 hook 在配置中的同时禁用单个 hook。

`disableAllHooks` 设置遵守托管设置层次结构。如果管理员通过托管策略设置配置了 hooks，则在用户、项目或本地设置中设置的 `disableAllHooks` 无法禁用这些托管 hooks。仅在托管设置级别设置的 `disableAllHooks` 可以禁用托管 hooks。

对设置文件中 hooks 的直接编辑通常由文件监视程序自动拾取。

## Hook 输入和输出

命令 hooks 通过 stdin 接收 JSON 数据，并通过退出代码、stdout 和 stderr 传回结果。HTTP hooks 接收相同的 JSON 作为 POST 请求体，并通过 HTTP 响应体传回结果。本部分涵盖所有事件通用的字段和行为。每个事件在[Hook 事件](#hook-events)下的部分包括其特定的输入架构和决定控制选项。

### 通用输入字段

所有 hook 事件都接收这些字段作为 JSON，除了每个[hook 事件](#hook-events)部分中记录的事件特定字段。对于命令 hooks，此 JSON 通过 stdin 到达。对于 HTTP hooks，它作为 POST 请求体到达。

| 字段                | 描述                                                                                                                                                                 |
| :---------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session_id`      | 当前会话标识符                                                                                                                                                            |
| `transcript_path` | 对话 JSON 的路径                                                                                                                                                        |
| `cwd`             | 调用 hook 时的当前工作目录                                                                                                                                                   |
| `permission_mode` | 当前[权限模式](/zh-CN/permissions#permission-modes)：`"default"`、`"plan"`、`"acceptEdits"`、`"auto"`、`"dontAsk"` 或 `"bypassPermissions"`。并非所有事件都接收此字段：请参阅下面每个事件的 JSON 示例以检查 |
| `hook_event_name` | 触发的事件名称                                                                                                                                                            |

使用 `--agent` 运行或在 subagent 内部时，包括两个额外字段：

| 字段           | 描述                                                                                                                                 |
| :----------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| `agent_id`   | Subagent 的唯一标识符。仅当 hook 在 subagent 调用内触发时存在。使用此来区分 subagent hook 调用和主线程调用。                                                         |
| `agent_type` | 代理名称（例如，`"Explore"` 或 `"security-reviewer"`）。当会话使用 `--agent` 或 hook 在 subagent 内触发时存在。对于 subagents，subagent 的类型优先于会话的 `--agent` 值。 |

例如，Bash 命令的 `PreToolUse` hook 在 stdin 上接收：

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/home/user/.claude/projects/.../transcript.jsonl",
  "cwd": "/home/user/my-project",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": {
    "command": "npm test"
  }
}
```

`tool_name` 和 `tool_input` 字段是事件特定的。每个[hook 事件](#hook-events)部分记录了该事件的额外字段。

### 退出代码输出

您的 hook 命令的退出代码告诉 Claude Code 操作是否应该继续、被阻止或被忽略。

**退出 0** 表示成功。Claude Code 解析 stdout 以获取[JSON 输出字段](#json-output)。JSON 输出仅在退出 0 时处理。对于大多数事件，stdout 仅在详细模式（`Ctrl+O`）中显示。例外是 `UserPromptSubmit` 和 `SessionStart`，其中 stdout 作为 Claude 可以看到和作用的上下文添加。

**退出 2** 表示阻止错误。Claude Code 忽略 stdout 和其中的任何 JSON。相反，stderr 文本被反馈给 Claude 作为错误消息。效果取决于事件：`PreToolUse` 阻止工具调用，`UserPromptSubmit` 拒绝提示，等等。有关完整列表，请参阅[每个事件的退出代码 2 行为](#exit-code-2-behavior-per-event)。

**任何其他退出代码** 是非阻止错误。stderr 在详细模式（`Ctrl+O`）中显示，执行继续。

例如，一个 hook 命令脚本，阻止危险的 Bash 命令：

```bash  theme={null}
#!/bin/bash
# 从 stdin 读取 JSON 输入，检查命令
command=$(jq -r '.tool_input.command' < /dev/stdin)

if [[ "$command" == rm* ]]; then
  echo "Blocked: rm commands are not allowed" >&2
  exit 2  # 阻止错误：工具调用被阻止
fi

exit 0  # 成功：工具调用继续
```

#### 每个事件的退出代码 2 行为

退出代码 2 是 hook 发出"停止，不要这样做"的方式。效果取决于事件，因为某些事件代表可以被阻止的操作（如尚未发生的工具调用），而其他事件代表已经发生或无法防止的事情。

| Hook 事件              | 可以阻止？ | 退出 2 时发生的情况                                                                |
| :------------------- | :---- | :------------------------------------------------------------------------- |
| `PreToolUse`         | 是     | 阻止工具调用                                                                     |
| `PermissionRequest`  | 是     | 拒绝权限                                                                       |
| `UserPromptSubmit`   | 是     | 阻止提示处理并从上下文中删除提示                                                           |
| `Stop`               | 是     | 防止 Claude 停止，继续对话                                                          |
| `SubagentStop`       | 是     | 防止 subagent 停止                                                             |
| `TeammateIdle`       | 是     | 防止队友空闲（队友继续工作）                                                             |
| `TaskCreated`        | 是     | 回滚任务创建                                                                     |
| `TaskCompleted`      | 是     | 防止任务被标记为已完成                                                                |
| `ConfigChange`       | 是     | 阻止配置更改生效（除了 `policy_settings`）                                             |
| `StopFailure`        | 否     | 输出和退出代码被忽略                                                                 |
| `PostToolUse`        | 否     | 向 Claude 显示 stderr（工具已运行）                                                  |
| `PostToolUseFailure` | 否     | 向 Claude 显示 stderr（工具已失败）                                                  |
| `PermissionDenied`   | 否     | 退出代码和 stderr 被忽略（拒绝已发生）。使用 JSON `hookSpecificOutput.retry: true` 告诉模型它可能重试 |
| `Notification`       | 否     | 仅向用户显示 stderr                                                              |
| `SubagentStart`      | 否     | 仅向用户显示 stderr                                                              |
| `SessionStart`       | 否     | 仅向用户显示 stderr                                                              |
| `SessionEnd`         | 否     | 仅向用户显示 stderr                                                              |
| `CwdChanged`         | 否     | 仅向用户显示 stderr                                                              |
| `FileChanged`        | 否     | 仅向用户显示 stderr                                                              |
| `PreCompact`         | 否     | 仅向用户显示 stderr                                                              |
| `PostCompact`        | 否     | 仅向用户显示 stderr                                                              |
| `Elicitation`        | 是     | 拒绝 elicitation                                                             |
| `ElicitationResult`  | 是     | 阻止响应（操作变为 decline）                                                         |
| `WorktreeCreate`     | 是     | 任何非零退出代码都会导致 worktree 创建失败                                                 |
| `WorktreeRemove`     | 否     | 失败仅在调试模式下记录                                                                |
| `InstructionsLoaded` | 否     | 退出代码被忽略                                                                    |

### HTTP 响应处理

HTTP hooks 使用 HTTP 状态代码和响应体而不是退出代码和 stdout：

* **2xx 带空体**：成功，等同于退出代码 0 且无输出
* **2xx 带纯文本体**：成功，文本作为上下文添加
* **2xx 带 JSON 体**：成功，使用与命令 hooks 相同的[JSON 输出](#json-output)架构解析
* **非 2xx 状态**：非阻止错误，执行继续
* **连接失败或超时**：非阻止错误，执行继续

与命令 hooks 不同，HTTP hooks 无法仅通过状态代码发出阻止错误信号。要阻止工具调用或拒绝权限，返回 2xx 响应，其 JSON 体包含适当的决定字段。

### JSON 输出

退出代码让您允许或阻止，但 JSON 输出提供更细粒度的控制。与其使用代码 2 退出来阻止，不如退出 0 并将 JSON 对象打印到 stdout。Claude Code 从该 JSON 读取特定字段以控制行为，包括[决定控制](#decision-control)以阻止、允许或升级给用户。

<Note>
  您必须为每个 hook 选择一种方法，而不是两种：要么单独使用退出代码进行信号传递，要么退出 0 并打印 JSON 以进行结构化控制。Claude Code 仅在退出 0 时处理 JSON。如果您退出 2，任何 JSON 都会被忽略。
</Note>

您的 hook 的 stdout 必须仅包含 JSON 对象。如果您的 shell 配置文件在启动时打印文本，它可能会干扰 JSON 解析。请参阅故障排除指南中的[JSON 验证失败](/zh-CN/hooks-guide#json-validation-failed)。

Hook 输出注入到上下文中（`additionalContext`、`systemMessage` 或纯 stdout）的上限为 10,000 个字符。超过此限制的输出被保存到文件并替换为预览和文件路径，与大型工具结果的处理方式相同。

JSON 对象支持三种字段：

* **通用字段**，如 `continue`，在所有事件中工作。这些列在下表中。
* **顶级 `decision` 和 `reason`** 由某些事件用于阻止或提供反馈。
* **`hookSpecificOutput`** 是一个嵌套对象，用于需要更丰富控制的事件。它需要一个设置为事件名称的 `hookEventName` 字段。

| 字段               | 默认      | 描述                                                   |
| :--------------- | :------ | :--------------------------------------------------- |
| `continue`       | `true`  | 如果为 `false`，Claude 在 hook 运行后完全停止处理。优先于任何事件特定的决定字段   |
| `stopReason`     | 无       | hook 运行后 `continue` 为 `false` 时向用户显示的消息。不向 Claude 显示 |
| `suppressOutput` | `false` | 如果为 `true`，从详细模式输出中隐藏 stdout                         |
| `systemMessage`  | 无       | 向用户显示的警告消息                                           |

要无论事件类型如何都完全停止 Claude：

```json  theme={null}
{ "continue": false, "stopReason": "Build failed, fix errors before continuing" }
```

#### 决定控制

并非每个事件都支持通过 JSON 阻止或控制行为。支持的事件各自使用不同的字段集来表达该决定。在编写 hook 之前，使用此表作为快速参考：

| 事件                                                                                                                  | 决定模式                    | 关键字段                                                                                               |
| :------------------------------------------------------------------------------------------------------------------ | :---------------------- | :------------------------------------------------------------------------------------------------- |
| UserPromptSubmit、PostToolUse、PostToolUseFailure、Stop、SubagentStop、ConfigChange                                      | 顶级 `decision`           | `decision: "block"`、`reason`                                                                       |
| TeammateIdle、TaskCreated、TaskCompleted                                                                              | 退出代码或 `continue: false` | 退出代码 2 使用 stderr 反馈阻止操作。JSON `{"continue": false, "stopReason": "..."}` 也会完全停止队友，匹配 `Stop` hook 行为 |
| PreToolUse                                                                                                          | `hookSpecificOutput`    | `permissionDecision`（allow/deny/ask/defer）、`permissionDecisionReason`                              |
| PermissionRequest                                                                                                   | `hookSpecificOutput`    | `decision.behavior`（allow/deny）                                                                    |
| PermissionDenied                                                                                                    | `hookSpecificOutput`    | `retry: true` 告诉模型它可能重试被拒绝的工具调用                                                                    |
| WorktreeCreate                                                                                                      | 路径返回                    | 命令 hook 在 stdout 上打印路径；HTTP hook 通过 `hookSpecificOutput.worktreePath` 返回。Hook 失败或缺少路径会导致创建失败       |
| Elicitation                                                                                                         | `hookSpecificOutput`    | `action`（accept/decline/cancel）、`content`（form 字段值用于 accept）                                       |
| ElicitationResult                                                                                                   | `hookSpecificOutput`    | `action`（accept/decline/cancel）、`content`（form 字段值覆盖）                                              |
| WorktreeRemove、Notification、SessionEnd、PreCompact、PostCompact、InstructionsLoaded、StopFailure、CwdChanged、FileChanged | 无                       | 无决定控制。用于日志记录或清理等副作用                                                                                |

以下是每种模式的实际示例：

<Tabs>
  <Tab title="顶级决定">
    由 `UserPromptSubmit`、`PostToolUse`、`PostToolUseFailure`、`Stop`、`SubagentStop` 和 `ConfigChange` 使用。唯一的值是 `"block"`。要允许操作继续，从您的 JSON 中省略 `decision`，或退出 0 而不带任何 JSON：

    ```json  theme={null}
    {
      "decision": "block",
      "reason": "Test suite must pass before proceeding"
    }
    ```
  </Tab>

  <Tab title="PreToolUse">
    使用 `hookSpecificOutput` 以获得更丰富的控制：允许、拒绝、询问或延迟工具调用。您还可以在运行前修改工具输入或为 Claude 注入额外上下文。有关完整的选项集，请参阅[PreToolUse 决定控制](#pretooluse-decision-control)。

    ```json  theme={null}
    {
      "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": "Database writes are not allowed"
      }
    }
    ```
  </Tab>

  <Tab title="PermissionRequest">
    使用 `hookSpecificOutput` 代表用户允许或拒绝权限请求。允许时，您还可以修改工具的输入或应用权限规则，以便用户不会再次被提示。有关完整的选项集，请参阅[PermissionRequest 决定控制](#permissionrequest-decision-control)。

    ```json  theme={null}
    {
      "hookSpecificOutput": {
        "hookEventName": "PermissionRequest",
        "decision": {
          "behavior": "allow",
          "updatedInput": {
            "command": "npm run lint"
          }
        }
      }
    }
    ```
  </Tab>
</Tabs>

有关扩展示例，包括 Bash 命令验证、提示过滤和自动批准脚本，请参阅指南中的[您可以自动化的内容](/zh-CN/hooks-guide#what-you-can-automate)以及[Bash 命令验证器参考实现](https://github.com/anthropics/claude-code/blob/main/examples/hooks/bash_command_validator_example.py)。

## Hook 事件

每个事件对应于 Claude Code 生命周期中 hooks 可以运行的一个点。下面的部分按照生命周期排序：从会话设置通过代理循环到会话结束。每个部分描述事件何时触发、它支持的匹配器、它接收的 JSON 输入以及如何通过输出控制行为。

### SessionStart

在 Claude Code 启动新会话或恢复现有会话时运行。用于加载开发上下文，如现有问题或代码库的最近更改，或设置环境变量。对于不需要脚本的静态上下文，请改用[CLAUDE.md](/zh-CN/memory)。

SessionStart 在每个会话上运行，因此保持这些 hooks 快速。仅支持 `type: "command"` hooks。

匹配器值对应于会话的启动方式：

| 匹配器       | 何时触发                                |
| :-------- | :---------------------------------- |
| `startup` | 新会话                                 |
| `resume`  | `--resume`、`--continue` 或 `/resume` |
| `clear`   | `/clear`                            |
| `compact` | 自动或手动压缩                             |

#### SessionStart 输入

除了[通用输入字段](#common-input-fields)外，SessionStart hooks 还接收 `source`、`model` 和可选的 `agent_type`。`source` 字段指示会话如何启动：新会话为 `"startup"`，恢复会话为 `"resume"`，`/clear` 后为 `"clear"`，压缩后为 `"compact"`。`model` 字段包含模型标识符。如果您使用 `claude --agent <name>` 启动 Claude Code，`agent_type` 字段包含代理名称。

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "SessionStart",
  "source": "startup",
  "model": "claude-sonnet-4-6"
}
```

#### SessionStart 决定控制

您的 hook 脚本打印到 stdout 的任何文本都作为 Claude 的上下文添加。除了所有 hooks 可用的[JSON 输出字段](#json-output)外，您还可以返回这些事件特定字段：

| 字段                  | 描述                                |
| :------------------ | :-------------------------------- |
| `additionalContext` | 添加到 Claude 上下文的字符串。多个 hooks 的值被连接 |

```json  theme={null}
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "My additional context here"
  }
}
```

#### 持久化环境变量

SessionStart hooks 可以访问 `CLAUDE_ENV_FILE` 环境变量，该变量提供一个文件路径，您可以在其中为后续 Bash 命令持久化环境变量。

要设置单个环境变量，请将 `export` 语句写入 `CLAUDE_ENV_FILE`。使用追加（`>>`）来保留由其他 hooks 设置的变量：

```bash  theme={null}
#!/bin/bash

if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo 'export NODE_ENV=production' >> "$CLAUDE_ENV_FILE"
  echo 'export DEBUG_LOG=true' >> "$CLAUDE_ENV_FILE"
  echo 'export PATH="$PATH:./node_modules/.bin"' >> "$CLAUDE_ENV_FILE"
fi

exit 0
```

要捕获设置命令中的所有环境更改，请比较之前和之后导出的变量：

```bash  theme={null}
#!/bin/bash

ENV_BEFORE=$(export -p | sort)

# 运行修改环境的设置命令
source ~/.nvm/nvm.sh
nvm use 20

if [ -n "$CLAUDE_ENV_FILE" ]; then
  ENV_AFTER=$(export -p | sort)
  comm -13 <(echo "$ENV_BEFORE") <(echo "$ENV_AFTER") >> "$CLAUDE_ENV_FILE"
fi

exit 0
```

写入此文件的任何变量都将在会话期间 Claude Code 执行的所有后续 Bash 命令中可用。

<Note>
  `CLAUDE_ENV_FILE` 可用于 SessionStart、[CwdChanged](#cwdchanged) 和 [FileChanged](#filechanged) hooks。其他 hook 类型无法访问此变量。
</Note>

### InstructionsLoaded

当 `CLAUDE.md` 或 `.claude/rules/*.md` 文件加载到上下文中时触发。此事件在会话启动时为急切加载的文件触发，稍后当文件被懒加载时再次触发，例如当 Claude 访问包含嵌套 `CLAUDE.md` 的子目录或条件规则与 `paths:` frontmatter 匹配时。该 hook 不支持阻止或决定控制。它异步运行以用于可观测性目的。

匹配器针对 `load_reason` 运行。例如，使用 `"matcher": "session_start"` 仅对会话启动时加载的文件触发，或使用 `"matcher": "path_glob_match|nested_traversal"` 仅对懒加载触发。

#### InstructionsLoaded 输入

除了[通用输入字段](#common-input-fields)外，InstructionsLoaded hooks 还接收这些字段：

| 字段                  | 描述                                                                                                                           |
| :------------------ | :--------------------------------------------------------------------------------------------------------------------------- |
| `file_path`         | 加载的指令文件的绝对路径                                                                                                                 |
| `memory_type`       | 文件的范围：`"User"`、`"Project"`、`"Local"` 或 `"Managed"`                                                                           |
| `load_reason`       | 文件被加载的原因：`"session_start"`、`"nested_traversal"`、`"path_glob_match"`、`"include"` 或 `"compact"`。`"compact"` 值在压缩事件后重新加载指令文件时触发 |
| `globs`             | 文件 `paths:` frontmatter 中的路径 glob 模式（如果有）。仅对 `path_glob_match` 加载存在                                                          |
| `trigger_file_path` | 触发此加载的文件的路径，用于懒加载                                                                                                            |
| `parent_file_path`  | 包含此文件的父指令文件的路径，用于 `include` 加载                                                                                               |

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../transcript.jsonl",
  "cwd": "/Users/my-project",
  "hook_event_name": "InstructionsLoaded",
  "file_path": "/Users/my-project/CLAUDE.md",
  "memory_type": "Project",
  "load_reason": "session_start"
}
```

#### InstructionsLoaded 决定控制

InstructionsLoaded hooks 没有决定控制。它们无法阻止或修改指令加载。使用此事件进行审计日志记录、合规性跟踪或可观测性。

### UserPromptSubmit

在用户提交提示时运行，在 Claude 处理之前。这允许您根据提示/对话添加额外上下文、验证提示或阻止某些类型的提示。

#### UserPromptSubmit 输入

除了[通用输入字段](#common-input-fields)外，UserPromptSubmit hooks 还接收包含用户提交的文本的 `prompt` 字段。

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "UserPromptSubmit",
  "prompt": "Write a function to calculate the factorial of a number"
}
```

#### UserPromptSubmit 决定控制

`UserPromptSubmit` hooks 可以控制用户提示是否被处理并添加上下文。所有[JSON 输出字段](#json-output)都可用。

有两种方法可以在退出代码 0 时向对话添加上下文：

* **纯文本 stdout**：写入 stdout 的任何非 JSON 文本都作为上下文添加
* **带 `additionalContext` 的 JSON**：使用下面的 JSON 格式以获得更多控制。`additionalContext` 字段作为上下文添加

纯 stdout 在成绩单中显示为 hook 输出。`additionalContext` 字段更谨慎地添加。

要阻止提示，返回一个 JSON 对象，其中 `decision` 设置为 `"block"`：

| 字段                  | 描述                                      |
| :------------------ | :-------------------------------------- |
| `decision`          | `"block"` 防止提示被处理并从上下文中删除。省略以允许提示继续     |
| `reason`            | 当 `decision` 为 `"block"` 时向用户显示。不添加到上下文 |
| `additionalContext` | 添加到 Claude 上下文的字符串                      |

```json  theme={null}
{
  "decision": "block",
  "reason": "Explanation for decision",
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "My additional context here"
  }
}
```

<Note>
  JSON 格式对于简单用例不是必需的。要添加上下文，您可以使用退出代码 0 将纯文本打印到 stdout。当您需要阻止提示或想要更结构化的控制时，使用 JSON。
</Note>

### PreToolUse

在 Claude 创建工具参数后和处理工具调用之前运行。在工具名称上匹配：`Bash`、`Edit`、`Write`、`Read`、`Glob`、`Grep`、`Agent`、`WebFetch`、`WebSearch`、`AskUserQuestion`、`ExitPlanMode` 和任何[MCP 工具名称](#match-mcp-tools)。

使用[PreToolUse 决定控制](#pretooluse-decision-control)来允许、拒绝、询问或延迟工具调用。

#### PreToolUse 输入

除了[通用输入字段](#common-input-fields)外，PreToolUse hooks 还接收 `tool_name`、`tool_input` 和 `tool_use_id`。`tool_input` 字段取决于工具：

##### Bash

执行 shell 命令。

| 字段                  | 类型      | 示例                 | 描述            |
| :------------------ | :------ | :----------------- | :------------ |
| `command`           | string  | `"npm test"`       | 要执行的 shell 命令 |
| `description`       | string  | `"Run test suite"` | 命令执行操作的可选描述   |
| `timeout`           | number  | `120000`           | 可选超时（毫秒）      |
| `run_in_background` | boolean | `false`            | 是否在后台运行命令     |

##### Write

创建或覆盖文件。

| 字段          | 类型     | 示例                    | 描述          |
| :---------- | :----- | :-------------------- | :---------- |
| `file_path` | string | `"/path/to/file.txt"` | 要写入的文件的绝对路径 |
| `content`   | string | `"file content"`      | 要写入文件的内容    |

##### Edit

替换现有文件中的字符串。

| 字段            | 类型      | 示例                    | 描述          |
| :------------ | :------ | :-------------------- | :---------- |
| `file_path`   | string  | `"/path/to/file.txt"` | 要编辑的文件的绝对路径 |
| `old_string`  | string  | `"original text"`     | 要查找和替换的文本   |
| `new_string`  | string  | `"replacement text"`  | 替换文本        |
| `replace_all` | boolean | `false`               | 是否替换所有出现    |

##### Read

读取文件内容。

| 字段          | 类型     | 示例                    | 描述          |
| :---------- | :----- | :-------------------- | :---------- |
| `file_path` | string | `"/path/to/file.txt"` | 要读取的文件的绝对路径 |
| `offset`    | number | `10`                  | 可选的开始读取的行号  |
| `limit`     | number | `50`                  | 可选的要读取的行数   |

##### Glob

查找与 glob 模式匹配的文件。

| 字段        | 类型     | 示例               | 描述                |
| :-------- | :----- | :--------------- | :---------------- |
| `pattern` | string | `"**/*.ts"`      | 要匹配文件的 Glob 模式    |
| `path`    | string | `"/path/to/dir"` | 可选的搜索目录。默认为当前工作目录 |

##### Grep

使用正则表达式搜索文件内容。

| 字段            | 类型      | 示例               | 描述                                                                        |
| :------------ | :------ | :--------------- | :------------------------------------------------------------------------ |
| `pattern`     | string  | `"TODO.*fix"`    | 要搜索的正则表达式模式                                                               |
| `path`        | string  | `"/path/to/dir"` | 可选的要搜索的文件或目录                                                              |
| `glob`        | string  | `"*.ts"`         | 可选的 glob 模式以过滤文件                                                          |
| `output_mode` | string  | `"content"`      | `"content"`、`"files_with_matches"` 或 `"count"`。默认为 `"files_with_matches"` |
| `-i`          | boolean | `true`           | 不区分大小写的搜索                                                                 |
| `multiline`   | boolean | `false`          | 启用多行匹配                                                                    |

##### WebFetch

获取和处理 web 内容。

| 字段       | 类型     | 示例                            | 描述           |
| :------- | :----- | :---------------------------- | :----------- |
| `url`    | string | `"https://example.com/api"`   | 要获取内容的 URL   |
| `prompt` | string | `"Extract the API endpoints"` | 在获取的内容上运行的提示 |

##### WebSearch

搜索网络。

| 字段                | 类型     | 示例                             | 描述             |
| :---------------- | :----- | :----------------------------- | :------------- |
| `query`           | string | `"react hooks best practices"` | 搜索查询           |
| `allowed_domains` | array  | `["docs.example.com"]`         | 可选：仅包含来自这些域的结果 |
| `blocked_domains` | array  | `["spam.example.com"]`         | 可选：排除来自这些域的结果  |

##### Agent

生成一个[subagent](/zh-CN/sub-agents)。

| 字段              | 类型     | 示例                         | 描述            |
| :-------------- | :----- | :------------------------- | :------------ |
| `prompt`        | string | `"Find all API endpoints"` | 代理要执行的任务      |
| `description`   | string | `"Find API endpoints"`     | 任务的简短描述       |
| `subagent_type` | string | `"Explore"`                | 要使用的专门代理的类型   |
| `model`         | string | `"sonnet"`                 | 可选的模型别名以覆盖默认值 |

##### AskUserQuestion

向用户提出一到四个多选题。

| 字段          | 类型     | 示例                                                                                                                 | 描述                                                                         |
| :---------- | :----- | :----------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------- |
| `questions` | array  | `[{"question": "Which framework?", "header": "Framework", "options": [{"label": "React"}], "multiSelect": false}]` | 要呈现的问题，每个都有 `question` 字符串、短 `header`、`options` 数组和可选的 `multiSelect` 标志    |
| `answers`   | object | `{"Which framework?": "React"}`                                                                                    | 可选。将问题文本映射到选定的选项标签。多选答案用逗号连接标签。Claude 不设置此字段；通过 `updatedInput` 提供它以以编程方式回答 |

#### PreToolUse 决定控制

`PreToolUse` hooks 可以控制工具调用是否继续。与使用顶级 `decision` 字段的其他 hooks 不同，PreToolUse 在 `hookSpecificOutput` 对象内返回其决定。这给了它更丰富的控制：四个结果（允许、拒绝、询问或延迟）加上在执行前修改工具输入的能力。

| 字段                         | 描述                                                                                                                                                   |
| :------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| `permissionDecision`       | `"allow"` 绕过权限提示。`"deny"` 防止工具调用。`"ask"` 提示用户确认。`"defer"` 优雅地退出，以便工具稍后可以恢复。[拒绝和询问规则](/zh-CN/permissions#manage-permissions)在 hook 返回 `"allow"` 时仍然适用 |
| `permissionDecisionReason` | 对于 `"allow"` 和 `"ask"`，向用户显示但不向 Claude 显示。对于 `"deny"`，向 Claude 显示。对于 `"defer"`，被忽略                                                                   |
| `updatedInput`             | 在执行前修改工具的输入参数。替换整个输入对象，因此包括未修改的字段以及修改后的字段。与 `"allow"` 结合以自动批准，或与 `"ask"` 结合以向用户显示修改后的输入。对于 `"defer"`，被忽略                                             |
| `additionalContext`        | 在工具执行前添加到 Claude 上下文的字符串。对于 `"defer"`，被忽略                                                                                                            |

当多个 PreToolUse hooks 返回不同的决定时，优先级是 `deny` > `defer` > `ask` > `allow`。

当 hook 返回 `"ask"` 时，向用户显示的权限提示包括一个标签，标识 hook 来自何处：例如，`[User]`、`[Project]`、`[Plugin]` 或 `[Local]`。这帮助用户了解哪个配置源正在请求确认。

```json  theme={null}
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "My reason here",
    "updatedInput": {
      "field_to_modify": "new value"
    },
    "additionalContext": "Current environment: production. Proceed with caution."
  }
}
```

`AskUserQuestion` 和 `ExitPlanMode` 需要用户交互，通常在[非交互模式](/zh-CN/headless)中使用 `-p` 标志时阻止。返回 `permissionDecision: "allow"` 以及 `updatedInput` 满足该要求：hook 从 stdin 读取工具的输入，通过您自己的 UI 收集答案，并在 `updatedInput` 中返回它，以便工具运行而不提示。仅返回 `"allow"` 对这些工具不足够。对于 `AskUserQuestion`，回显原始 `questions` 数组并添加一个[`answers`](#askuserquestion)对象，将每个问题的文本映射到选定的答案。

<Note>
  PreToolUse 之前使用顶级 `decision` 和 `reason` 字段，但这些对此事件已弃用。改用 `hookSpecificOutput.permissionDecision` 和 `hookSpecificOutput.permissionDecisionReason`。已弃用的值 `"approve"` 和 `"block"` 映射到 `"allow"` 和 `"deny"`。PostToolUse 和 Stop 等其他事件继续使用顶级 `decision` 和 `reason` 作为其当前格式。
</Note>

#### 延迟工具调用以供稍后使用

`"defer"` 用于运行 `claude -p` 作为子进程并读取其 JSON 输出的集成，例如 Agent SDK 应用或构建在 Claude Code 之上的自定义 UI。它让该调用进程在工具调用处暂停 Claude，通过其自己的界面收集输入，并从中断处恢复。Claude Code 仅在[非交互模式](/zh-CN/headless)中使用 `-p` 标志时遵守此值。在交互式会话中，它记录警告并忽略 hook 结果。

<Note>
  `defer` 值需要 Claude Code v2.1.89 或更高版本。早期版本不识别它，工具通过正常权限流程进行。
</Note>

`AskUserQuestion` 工具是典型情况：Claude 想要询问用户一些事情，但没有终端来回答。往返工作如下：

1. Claude 调用 `AskUserQuestion`。`PreToolUse` hook 触发。
2. Hook 返回 `permissionDecision: "defer"`。工具不执行。进程以 `stop_reason: "tool_deferred"` 退出，待处理的工具调用保留在成绩单中。
3. 调用进程从 SDK 结果读取 `deferred_tool_use`，在其自己的 UI 中显示问题，并等待答案。
4. 调用进程运行 `claude -p --resume <session-id>`。相同的工具调用再次触发 `PreToolUse`。
5. Hook 返回 `permissionDecision: "allow"` 和 `updatedInput` 中的答案。工具执行，Claude 继续。

`deferred_tool_use` 字段携带工具的 `id`、`name` 和 `input`。`input` 是 Claude 为工具调用生成的参数，在执行前捕获：

```json  theme={null}
{
  "type": "result",
  "subtype": "success",
  "stop_reason": "tool_deferred",
  "session_id": "abc123",
  "deferred_tool_use": {
    "id": "toolu_01abc",
    "name": "AskUserQuestion",
    "input": { "questions": [{ "question": "Which framework?", "header": "Framework", "options": [{"label": "React"}, {"label": "Vue"}], "multiSelect": false }] }
  }
}
```

没有超时或重试限制。会话保留在磁盘上，直到您恢复它。如果恢复时答案还没有准备好，hook 可以再次返回 `"defer"`，进程以相同的方式退出。调用进程控制何时通过最终返回 `"allow"` 或 `"deny"` 从 hook 中断循环。

`"defer"` 仅在 Claude 在轮次中进行单个工具调用时有效。如果 Claude 一次进行多个工具调用，`"defer"` 被忽略并显示警告，工具通过正常权限流程进行。约束存在是因为恢复只能重新运行一个工具：没有办法延迟一个调用而不留下其他调用未解决。

如果恢复时延迟的工具不再可用，进程以 `stop_reason: "tool_deferred_unavailable"` 和 `is_error: true` 退出，在 hook 触发之前。这发生在为恢复的会话未连接提供工具的 MCP 服务器时。`deferred_tool_use` 有效负载仍然包括，以便您可以识别哪个工具丢失。

<Warning>
  `--resume` 不会从先前的会话恢复权限模式。在恢复时传递与工具被延迟时活跃的相同 `--permission-mode` 标志。Claude Code 在模式不同时记录警告。
</Warning>

### PermissionRequest

在向用户显示权限对话框时运行。使用[PermissionRequest 决定控制](#permissionrequest-decision-control)代表用户允许或拒绝。

在工具名称上匹配，与 PreToolUse 相同的值。

#### PermissionRequest 输入

PermissionRequest hooks 接收 `tool_name` 和 `tool_input` 字段，如 PreToolUse hooks，但没有 `tool_use_id`。可选的 `permission_suggestions` 数组包含用户通常在权限对话框中看到的"总是允许"选项。区别在于 hook 何时触发：PermissionRequest hooks 在权限对话框即将显示给用户时运行，而 PreToolUse hooks 在工具执行前运行，无论权限状态如何。

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "PermissionRequest",
  "tool_name": "Bash",
  "tool_input": {
    "command": "rm -rf node_modules",
    "description": "Remove node_modules directory"
  },
  "permission_suggestions": [
    {
      "type": "addRules",
      "rules": [{ "toolName": "Bash", "ruleContent": "rm -rf node_modules" }],
      "behavior": "allow",
      "destination": "localSettings"
    }
  ]
}
```

#### PermissionRequest 决定控制

`PermissionRequest` hooks 可以允许或拒绝权限请求。除了所有 hooks 可用的[JSON 输出字段](#json-output)外，您的 hook 脚本可以返回一个 `decision` 对象，其中包含这些事件特定字段：

| 字段                   | 描述                                                                             |
| :------------------- | :----------------------------------------------------------------------------- |
| `behavior`           | `"allow"` 授予权限，`"deny"` 拒绝它                                                    |
| `updatedInput`       | 仅对 `"allow"`：在执行前修改工具的输入参数。替换整个输入对象，因此包括未修改的字段以及修改后的字段                         |
| `updatedPermissions` | 仅对 `"allow"`：应用权限规则更新的[权限更新条目](#permission-update-entries)数组，例如添加允许规则或更改会话权限模式 |
| `message`            | 仅对 `"deny"`：告诉 Claude 为什么权限被拒绝                                                 |
| `interrupt`          | 仅对 `"deny"`：如果为 `true`，停止 Claude                                               |

```json  theme={null}
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow",
      "updatedInput": {
        "command": "npm run lint"
      }
    }
  }
}
```

#### 权限更新条目

`updatedPermissions` 输出字段和[`permission_suggestions` 输入字段](#permissionrequest-input)都使用相同的条目对象数组。每个条目都有一个 `type` 来确定其其他字段，以及一个 `destination` 来控制更改的写入位置。

| `type`              | 字段                               | 效果                                                                                                                   |
| :------------------ | :------------------------------- | :------------------------------------------------------------------------------------------------------------------- |
| `addRules`          | `rules`、`behavior`、`destination` | 添加权限规则。`rules` 是 `{toolName, ruleContent?}` 对象的数组。省略 `ruleContent` 以匹配整个工具。`behavior` 是 `"allow"`、`"deny"` 或 `"ask"` |
| `replaceRules`      | `rules`、`behavior`、`destination` | 用提供的 `rules` 替换 `destination` 处给定 `behavior` 的所有规则                                                                   |
| `removeRules`       | `rules`、`behavior`、`destination` | 移除给定 `behavior` 的匹配规则                                                                                                |
| `setMode`           | `mode`、`destination`             | 更改权限模式。有效模式为 `default`、`acceptEdits`、`dontAsk`、`bypassPermissions` 和 `plan`                                          |
| `addDirectories`    | `directories`、`destination`      | 添加工作目录。`directories` 是路径字符串的数组                                                                                       |
| `removeDirectories` | `directories`、`destination`      | 移除工作目录                                                                                                               |

每个条目上的 `destination` 字段确定更改是保留在内存中还是持久化到设置文件。

| `destination`     | 写入                            |
| :---------------- | :---------------------------- |
| `session`         | 仅在内存中，会话结束时丢弃                 |
| `localSettings`   | `.claude/settings.local.json` |
| `projectSettings` | `.claude/settings.json`       |
| `userSettings`    | `~/.claude/settings.json`     |

Hook 可以回显它接收的 `permission_suggestions` 之一作为其自己的 `updatedPermissions` 输出，这等同于用户在对话框中选择该"总是允许"选项。

### PostToolUse

在工具成功完成后立即运行。

在工具名称上匹配，与 PreToolUse 相同的值。

#### PostToolUse 输入

`PostToolUse` hooks 在工具已经成功执行后触发。输入包括 `tool_input`（发送给工具的参数）和 `tool_response`（它返回的结果）。两者的确切架构取决于工具。

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/path/to/file.txt",
    "content": "file content"
  },
  "tool_response": {
    "filePath": "/path/to/file.txt",
    "success": true
  },
  "tool_use_id": "toolu_01ABC123..."
}
```

#### PostToolUse 决定控制

`PostToolUse` hooks 可以在工具执行后向 Claude 提供反馈。除了所有 hooks 可用的[JSON 输出字段](#json-output)外，您的 hook 脚本可以返回这些事件特定字段：

| 字段                     | 描述                                        |
| :--------------------- | :---------------------------------------- |
| `decision`             | `"block"` 用 `reason` 提示 Claude。省略以允许操作继续  |
| `reason`               | 当 `decision` 为 `"block"` 时向 Claude 显示的解释  |
| `additionalContext`    | Claude 要考虑的额外上下文                          |
| `updatedMCPToolOutput` | 仅对[MCP 工具](#match-mcp-tools)：用提供的值替换工具的输出 |

```json  theme={null}
{
  "decision": "block",
  "reason": "Explanation for decision",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "Additional information for Claude"
  }
}
```

### PostToolUseFailure

当工具执行失败时运行。此事件对于抛出错误或返回失败结果的工具调用触发。使用此来记录失败、发送警报或向 Claude 提供纠正反馈。

在工具名称上匹配，与 PreToolUse 相同的值。

#### PostToolUseFailure 输入

PostToolUseFailure hooks 接收与 PostToolUse 相同的 `tool_name` 和 `tool_input` 字段，以及作为顶级字段的错误信息：

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "PostToolUseFailure",
  "tool_name": "Bash",
  "tool_input": {
    "command": "npm test",
    "description": "Run test suite"
  },
  "tool_use_id": "toolu_01ABC123...",
  "error": "Command exited with non-zero status code 1",
  "is_interrupt": false
}
```

| 字段             | 描述                   |
| :------------- | :------------------- |
| `error`        | 描述出错原因的字符串           |
| `is_interrupt` | 可选的布尔值，指示失败是否由用户中断引起 |

#### PostToolUseFailure 决定控制

`PostToolUseFailure` hooks 可以在工具失败后向 Claude 提供上下文。除了所有 hooks 可用的[JSON 输出字段](#json-output)外，您的 hook 脚本可以返回这些事件特定字段：

| 字段                  | 描述                    |
| :------------------ | :-------------------- |
| `additionalContext` | Claude 要与错误一起考虑的额外上下文 |

```json  theme={null}
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUseFailure",
    "additionalContext": "Additional information about the failure for Claude"
  }
}
```

### PermissionDenied

当[自动模式](/zh-CN/permission-modes#eliminate-prompts-with-auto-mode)分类器拒绝工具调用时运行。此 hook 仅在自动模式中触发：当您手动拒绝权限对话框、`PreToolUse` hook 阻止调用或 `deny` 规则匹配时，它不运行。使用它来记录分类器拒绝、调整配置或告诉模型它可能重试工具调用。

在工具名称上匹配，与 PreToolUse 相同的值。

#### PermissionDenied 输入

除了[通用输入字段](#common-input-fields)外，PermissionDenied hooks 还接收 `tool_name`、`tool_input`、`tool_use_id` 和 `reason`。

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "auto",
  "hook_event_name": "PermissionDenied",
  "tool_name": "Bash",
  "tool_input": {
    "command": "rm -rf /tmp/build",
    "description": "Clean build directory"
  },
  "tool_use_id": "toolu_01ABC123...",
  "reason": "Auto mode denied: command targets a path outside the project"
}
```

| 字段       | 描述                 |
| :------- | :----------------- |
| `reason` | 分类器解释为什么工具调用被拒绝的原因 |

#### PermissionDenied 决定控制

PermissionDenied hooks 可以告诉模型它可能重试被拒绝的工具调用。返回一个 JSON 对象，其中 `hookSpecificOutput.retry` 设置为 `true`：

```json  theme={null}
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionDenied",
    "retry": true
  }
}
```

当 `retry` 为 `true` 时，Claude Code 向对话添加一条消息，告诉模型它可能重试工具调用。拒绝本身不被反转。如果您的 hook 不返回 JSON，或返回 `retry: false`，拒绝成立，模型接收原始拒绝消息。

### Notification

在 Claude Code 发送通知时运行。在通知类型上匹配：`permission_prompt`、`idle_prompt`、`auth_success`、`elicitation_dialog`。省略匹配器以为所有通知类型运行 hooks。

使用单独的匹配器根据通知类型运行不同的处理程序。此配置在 Claude 需要权限批准时触发权限特定的警报脚本，在 Claude 空闲时触发不同的通知：

```json  theme={null}
{
  "hooks": {
    "Notification": [
      {
        "matcher": "permission_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/permission-alert.sh"
          }
        ]
      },
      {
        "matcher": "idle_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/idle-notification.sh"
          }
        ]
      }
    ]
  }
}
```

#### Notification 输入

除了[通用输入字段](#common-input-fields)外，Notification hooks 还接收 `message` 和通知文本、可选的 `title` 和 `notification_type` 指示哪个类型触发。

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "Notification",
  "message": "Claude needs your permission to use Bash",
  "title": "Permission needed",
  "notification_type": "permission_prompt"
}
```

Notification hooks 无法阻止或修改通知。除了所有 hooks 可用的[JSON 输出字段](#json-output)外，您可以返回 `additionalContext` 以向对话添加上下文：

| 字段                  | 描述                 |
| :------------------ | :----------------- |
| `additionalContext` | 添加到 Claude 上下文的字符串 |

### SubagentStart

当通过 Agent 工具生成 Claude Code subagent 时运行。支持匹配器以按代理类型名称过滤（内置代理如 `Bash`、`Explore`、`Plan` 或来自 `.claude/agents/` 的自定义代理名称）。

#### SubagentStart 输入

除了[通用输入字段](#common-input-fields)外，SubagentStart hooks 还接收 `agent_id` 和 subagent 的唯一标识符以及 `agent_type` 和代理名称（内置代理如 `"Bash"`、`"Explore"`、`"Plan"` 或自定义代理名称）。

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "SubagentStart",
  "agent_id": "agent-abc123",
  "agent_type": "Explore"
}
```

SubagentStart hooks 无法阻止 subagent 创建，但它们可以向 subagent 注入上下文。除了所有 hooks 可用的[JSON 输出字段](#json-output)外，您可以返回：

| 字段                  | 描述                   |
| :------------------ | :------------------- |
| `additionalContext` | 添加到 subagent 上下文的字符串 |

```json  theme={null}
{
  "hookSpecificOutput": {
    "hookEventName": "SubagentStart",
    "additionalContext": "Follow security guidelines for this task"
  }
}
```

### SubagentStop

当 Claude Code subagent 完成响应时运行。在代理类型上匹配，与 SubagentStart 相同的值。

#### SubagentStop 输入

除了[通用输入字段](#common-input-fields)外，SubagentStop hooks 还接收 `stop_hook_active`、`agent_id`、`agent_type`、`agent_transcript_path` 和 `last_assistant_message`。`agent_type` 字段是用于匹配器过滤的值。`transcript_path` 是主会话的成绩单，而 `agent_transcript_path` 是 subagent 自己的成绩单，存储在嵌套的 `subagents/` 文件夹中。`last_assistant_message` 字段包含 subagent 最终响应的文本内容，因此 hooks 可以访问它而无需解析成绩单文件。

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "~/.claude/projects/.../abc123.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "SubagentStop",
  "stop_hook_active": false,
  "agent_id": "def456",
  "agent_type": "Explore",
  "agent_transcript_path": "~/.claude/projects/.../abc123/subagents/agent-def456.jsonl",
  "last_assistant_message": "Analysis complete. Found 3 potential issues..."
}
```

SubagentStop hooks 使用与[Stop hooks](#stop-decision-control)相同的决定控制格式。

### TaskCreated

当通过 `TaskCreate` 工具创建任务时运行。使用此来强制执行命名约定、要求任务描述或防止创建某些任务。

当 `TaskCreated` hook 以代码 2 退出时，任务不被创建，stderr 消息作为反馈反馈给模型。要完全停止队友而不是重新运行它，返回 JSON `{"continue": false, "stopReason": "..."}` 。TaskCreated hooks 不支持匹配器，在每次出现时触发。

#### TaskCreated 输入

除了[通用输入字段](#common-input-fields)外，TaskCreated hooks 还接收 `task_id`、`task_subject` 和可选的 `task_description`、`teammate_name` 和 `team_name`。

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "TaskCreated",
  "task_id": "task-001",
  "task_subject": "Implement user authentication",
  "task_description": "Add login and signup endpoints",
  "teammate_name": "implementer",
  "team_name": "my-project"
}
```

| 字段                 | 描述               |
| :----------------- | :--------------- |
| `task_id`          | 被创建的任务的标识符       |
| `task_subject`     | 任务的标题            |
| `task_description` | 任务的详细描述。可能不存在    |
| `teammate_name`    | 创建任务的队友的名称。可能不存在 |
| `team_name`        | 团队的名称。可能不存在      |

#### TaskCreated 决定控制

TaskCreated hooks 支持两种方式来控制任务创建：

* **退出代码 2**：任务不被创建，stderr 消息作为反馈反馈给模型。
* **JSON `{"continue": false, "stopReason": "..."}`**：完全停止队友，匹配 `Stop` hook 行为。`stopReason` 向用户显示。

此示例阻止主题不遵循所需格式的任务：

```bash  theme={null}
#!/bin/bash
INPUT=$(cat)
TASK_SUBJECT=$(echo "$INPUT" | jq -r '.task_subject')

if [[ ! "$TASK_SUBJECT" =~ ^\[TICKET-[0-9]+\] ]]; then
  echo "Task subject must start with a ticket number, e.g. '[TICKET-123] Add feature'" >&2
  exit 2
fi

exit 0
```

### TaskCompleted

当任务被标记为已完成时运行。这在两种情况下触发：当任何代理通过 TaskUpdate 工具显式标记任务为已完成时，或当[代理团队](/zh-CN/agent-teams)队友完成其轮次且有进行中的任务时。使用此来强制执行完成标准，如通过测试或 lint 检查，然后任务才能关闭。

当 `TaskCompleted` hook 以代码 2 退出时，任务不被标记为已完成，stderr 消息作为反馈反馈给模型。要完全停止队友而不是重新运行它，返回 JSON `{"continue": false, "stopReason": "..."}` 。TaskCompleted hooks 不支持匹配器，在每次出现时触发。

#### TaskCompleted 输入

除了[通用输入字段](#common-input-fields)外，TaskCompleted hooks 还接收 `task_id`、`task_subject` 和可选的 `task_description`、`teammate_name` 和 `team_name`。

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "TaskCompleted",
  "task_id": "task-001",
  "task_subject": "Implement user authentication",
  "task_description": "Add login and signup endpoints",
  "teammate_name": "implementer",
  "team_name": "my-project"
}
```

| 字段                 | 描述               |
| :----------------- | :--------------- |
| `task_id`          | 被完成的任务的标识符       |
| `task_subject`     | 任务的标题            |
| `task_description` | 任务的详细描述。可能不存在    |
| `teammate_name`    | 完成任务的队友的名称。可能不存在 |
| `team_name`        | 团队的名称。可能不存在      |

#### TaskCompleted 决定控制

TaskCompleted hooks 支持两种方式来控制任务完成：

* **退出代码 2**：任务不被标记为已完成，stderr 消息作为反馈反馈给模型。
* **JSON `{"continue": false, "stopReason": "..."}`**：完全停止队友，匹配 `Stop` hook 行为。`stopReason` 向用户显示。

此示例运行测试并在失败时阻止任务完成：

```bash  theme={null}
#!/bin/bash
INPUT=$(cat)
TASK_SUBJECT=$(echo "$INPUT" | jq -r '.task_subject')

# 运行测试套件
if ! npm test 2>&1; then
  echo "Tests not passing. Fix failing tests before completing: $TASK_SUBJECT" >&2
  exit 2
fi

exit 0
```

### Stop

在主 Claude Code 代理完成响应时运行。如果停止是由于用户中断，则不运行。API 错误触发[StopFailure](#stopfailure)。

#### Stop 输入

除了[通用输入字段](#common-input-fields)外，Stop hooks 还接收 `stop_hook_active` 和 `last_assistant_message`。`stop_hook_active` 字段在 Claude Code 已经作为 stop hook 的结果继续时为 `true`。检查此值或处理成绩单以防止 Claude Code 无限运行。`last_assistant_message` 字段包含 Claude 最终响应的文本内容，因此 hooks 可以访问它而无需解析成绩单文件。

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "~/.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "Stop",
  "stop_hook_active": true,
  "last_assistant_message": "I've completed the refactoring. Here's a summary..."
}
```

#### Stop 决定控制

`Stop` 和 `SubagentStop` hooks 可以控制 Claude 是否继续。除了所有 hooks 可用的[JSON 输出字段](#json-output)外，您的 hook 脚本可以返回这些事件特定字段：

| 字段         | 描述                                              |
| :--------- | :---------------------------------------------- |
| `decision` | `"block"` 防止 Claude 停止。省略以允许 Claude 停止          |
| `reason`   | 当 `decision` 为 `"block"` 时必需。告诉 Claude 为什么它应该继续 |

```json  theme={null}
{
  "decision": "block",
  "reason": "Must be provided when Claude is blocked from stopping"
}
```

### StopFailure

当轮次因 API 错误而结束时运行，而不是[Stop](#stop)。输出和退出代码被忽略。使用此来记录失败、发送警报或在 Claude 因速率限制、身份验证问题或其他 API 错误而无法完成响应时采取恢复操作。

#### StopFailure 输入

除了[通用输入字段](#common-input-fields)外，StopFailure hooks 还接收 `error`、可选的 `error_details` 和可选的 `last_assistant_message`。`error` 字段标识错误类型，用于匹配器过滤。

| 字段                       | 描述                                                                                                                                    |
| :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| `error`                  | 错误类型：`rate_limit`、`authentication_failed`、`billing_error`、`invalid_request`、`server_error`、`max_output_tokens` 或 `unknown`            |
| `error_details`          | 关于错误的额外详细信息（如果可用）                                                                                                                     |
| `last_assistant_message` | 在对话中显示的呈现错误文本。与 `Stop` 和 `SubagentStop` 不同，其中此字段包含 Claude 的对话输出，对于 `StopFailure` 它包含 API 错误字符串本身，例如 `"API Error: Rate limit reached"` |

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "StopFailure",
  "error": "rate_limit",
  "error_details": "429 Too Many Requests",
  "last_assistant_message": "API Error: Rate limit reached"
}
```

StopFailure hooks 没有决定控制。它们仅为通知和日志记录目的运行。

### TeammateIdle

当[代理团队](/zh-CN/agent-teams)队友在完成其轮次后即将空闲时运行。使用此来强制执行质量门，如要求通过 lint 检查或验证输出文件存在。

当 `TeammateIdle` hook 以代码 2 退出时，队友接收 stderr 消息作为反馈并继续工作而不是空闲。要完全停止队友而不是重新运行它，返回 JSON `{"continue": false, "stopReason": "..."}` 。TeammateIdle hooks 不支持匹配器，在每次出现时触发。

#### TeammateIdle 输入

除了[通用输入字段](#common-input-fields)外，TeammateIdle hooks 还接收 `teammate_name` 和 `team_name`。

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "TeammateIdle",
  "teammate_name": "researcher",
  "team_name": "my-project"
}
```

| 字段              | 描述         |
| :-------------- | :--------- |
| `teammate_name` | 即将空闲的队友的名称 |
| `team_name`     | 团队的名称      |

#### TeammateIdle 决定控制

TeammateIdle hooks 支持两种方式来控制队友行为：

* **退出代码 2**：队友接收 stderr 消息作为反馈并继续工作而不是空闲。
* **JSON `{"continue": false, "stopReason": "..."}`**：完全停止队友，匹配 `Stop` hook 行为。`stopReason` 向用户显示。

此示例检查构建工件是否存在，然后允许队友空闲：

```bash  theme={null}
#!/bin/bash

if [ ! -f "./dist/output.js" ]; then
  echo "Build artifact missing. Run the build before stopping." >&2
  exit 2
fi

exit 0
```

### ConfigChange

当会话期间配置文件更改时运行。使用此来审计设置更改、强制执行安全策略或阻止对配置文件的未授权修改。

ConfigChange hooks 对设置文件、托管策略设置和 skill 文件的更改触发。输入中的 `source` 字段告诉您哪种类型的配置更改，可选的 `file_path` 字段提供更改文件的路径。

匹配器在配置源上过滤：

| 匹配器                | 何时触发                             |
| :----------------- | :------------------------------- |
| `user_settings`    | `~/.claude/settings.json` 更改     |
| `project_settings` | `.claude/settings.json` 更改       |
| `local_settings`   | `.claude/settings.local.json` 更改 |
| `policy_settings`  | 托管策略设置更改                         |
| `skills`           | `.claude/skills/` 中的 skill 文件更改  |

此示例记录所有配置更改以进行安全审计：

```json  theme={null}
{
  "hooks": {
    "ConfigChange": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/audit-config-change.sh"
          }
        ]
      }
    ]
  }
}
```

#### ConfigChange 输入

除了[通用输入字段](#common-input-fields)外，ConfigChange hooks 还接收 `source` 和可选的 `file_path`。`source` 字段指示哪种配置类型更改，`file_path` 提供被修改的特定文件的路径。

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "ConfigChange",
  "source": "project_settings",
  "file_path": "/Users/.../my-project/.claude/settings.json"
}
```

#### ConfigChange 决定控制

ConfigChange hooks 可以阻止配置更改生效。使用退出代码 2 或 JSON `decision` 来防止更改。被阻止时，新设置不应用于运行中的会话。

| 字段         | 描述                                 |
| :--------- | :--------------------------------- |
| `decision` | `"block"` 防止配置更改被应用。省略以允许更改        |
| `reason`   | 当 `decision` 为 `"block"` 时向用户显示的解释 |

```json  theme={null}
{
  "decision": "block",
  "reason": "Configuration changes to project settings require admin approval"
}
```

`policy_settings` 更改无法被阻止。Hooks 仍然对 `policy_settings` 源触发，因此您可以使用它们进行审计日志记录，但任何阻止决定都被忽略。这确保企业管理的设置始终生效。

### CwdChanged

当会话期间工作目录更改时运行，例如当 Claude 执行 `cd` 命令时。使用此来对目录更改做出反应：重新加载环境变量、激活项目特定的工具链或自动运行设置脚本。与[FileChanged](#filechanged)配对，用于[direnv](https://direnv.net/)等管理每个目录环境的工具。

CwdChanged hooks 可以访问 `CLAUDE_ENV_FILE`。写入该文件的变量持久化到会话的后续 Bash 命令中，就像在[SessionStart hooks](#persist-environment-variables)中一样。仅支持 `type: "command"` hooks。

CwdChanged 不支持匹配器，在每次目录更改时触发。

#### CwdChanged 输入

除了[通用输入字段](#common-input-fields)外，CwdChanged hooks 还接收 `old_cwd` 和 `new_cwd`。

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../transcript.jsonl",
  "cwd": "/Users/my-project/src",
  "hook_event_name": "CwdChanged",
  "old_cwd": "/Users/my-project",
  "new_cwd": "/Users/my-project/src"
}
```

#### CwdChanged 输出

除了所有 hooks 可用的[JSON 输出字段](#json-output)外，CwdChanged hooks 还可以返回 `watchPaths` 来动态设置[FileChanged](#filechanged)监视的文件路径：

| 字段           | 描述                                                                     |
| :----------- | :--------------------------------------------------------------------- |
| `watchPaths` | 绝对路径的数组。替换当前动态监视列表（来自您的 `matcher` 配置的路径始终被监视）。返回空数组会清除动态列表，这在进入新目录时很典型 |

CwdChanged hooks 没有决定控制。它们无法阻止目录更改。

### FileChanged

当监视的文件在磁盘上更改时运行。您的 hook 配置中的 `matcher` 字段控制要监视的文件名：它是基名的管道分隔列表（不带目录路径的文件名，例如 `".envrc|.env"`）。当文件更改时，相同的 `matcher` 值也用于过滤哪些 hooks 运行，与更改文件的基名匹配。用于在项目配置文件修改时重新加载环境变量。

FileChanged hooks 可以访问 `CLAUDE_ENV_FILE`。写入该文件的变量持久化到会话的后续 Bash 命令中，就像在[SessionStart hooks](#persist-environment-variables)中一样。仅支持 `type: "command"` hooks。

#### FileChanged 输入

除了[通用输入字段](#common-input-fields)外，FileChanged hooks 还接收 `file_path` 和 `event`。

| 字段          | 描述                                                     |
| :---------- | :----------------------------------------------------- |
| `file_path` | 更改文件的绝对路径                                              |
| `event`     | 发生了什么：`"change"`（文件修改）、`"add"`（文件创建）或 `"unlink"`（文件删除） |

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../transcript.jsonl",
  "cwd": "/Users/my-project",
  "hook_event_name": "FileChanged",
  "file_path": "/Users/my-project/.envrc",
  "event": "change"
}
```

#### FileChanged 输出

除了所有 hooks 可用的[JSON 输出字段](#json-output)外，FileChanged hooks 还可以返回 `watchPaths` 来动态更新监视的文件路径：

| 字段           | 描述                                                                              |
| :----------- | :------------------------------------------------------------------------------ |
| `watchPaths` | 绝对路径的数组。替换当前动态监视列表（来自您的 `matcher` 配置的路径始终被监视）。当您的 hook 脚本根据更改的文件发现要监视的其他文件时使用此项 |

FileChanged hooks 没有决定控制。它们无法阻止文件更改的发生。

### WorktreeCreate

当您运行 `claude --worktree` 或[subagent 使用 `isolation: "worktree"`](/zh-CN/sub-agents#choose-the-subagent-scope)时，Claude Code 使用 `git worktree` 创建隔离的工作副本。如果您配置 WorktreeCreate hook，它替换默认的 git 行为，让您使用不同的版本控制系统，如 SVN、Perforce 或 Mercurial。

因为 hook 完全替换默认行为，[`.worktreeinclude`](/zh-CN/common-workflows#copy-gitignored-files-to-worktrees)不被处理。如果您需要将本地配置文件（如 `.env`）复制到新 worktree，请在您的 hook 脚本内执行。

Hook 必须返回创建的 worktree 目录的绝对路径。Claude Code 使用此路径作为隔离会话的工作目录。命令 hooks 在 stdout 上打印它；HTTP hooks 通过 `hookSpecificOutput.worktreePath` 返回它。

此示例创建 SVN 工作副本并打印路径供 Claude Code 使用。用您自己的替换仓库 URL：

```json  theme={null}
{
  "hooks": {
    "WorktreeCreate": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'NAME=$(jq -r .name); DIR=\"$HOME/.claude/worktrees/$NAME\"; svn checkout https://svn.example.com/repo/trunk \"$DIR\" >&2 && echo \"$DIR\"'"
          }
        ]
      }
    ]
  }
}
```

Hook 从 stdin 上的 JSON 输入读取 worktree `name`，将新副本检出到新目录，并打印目录路径。最后一行的 `echo` 是 Claude Code 读取的 worktree 路径。将任何其他输出重定向到 stderr，以便它不会干扰路径。

#### WorktreeCreate 输入

除了[通用输入字段](#common-input-fields)外，WorktreeCreate hooks 还接收 `name` 字段。这是新 worktree 的 slug 标识符，由用户指定或自动生成（例如，`bold-oak-a3f2`）。

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "WorktreeCreate",
  "name": "feature-auth"
}
```

#### WorktreeCreate 输出

WorktreeCreate hooks 不使用标准的允许/阻止决定模型。相反，hook 的成功或失败决定结果。Hook 必须返回创建的 worktree 目录的绝对路径：

* **命令 hooks**（`type: "command"`）：在 stdout 上打印路径。
* **HTTP hooks**（`type: "http"`）：在响应体中返回 `{ "hookSpecificOutput": { "hookEventName": "WorktreeCreate", "worktreePath": "/absolute/path" } }`。

如果 hook 失败或不产生路径，worktree 创建失败并出现错误。

### WorktreeRemove

[WorktreeCreate](#worktreecreate) 的清理对应物。此 hook 在 worktree 被移除时触发，要么当您退出 `--worktree` 会话并选择移除它时，要么当具有 `isolation: "worktree"` 的 subagent 完成时。对于基于 git 的 worktrees，Claude 使用 `git worktree remove` 自动处理清理。如果您为非 git 版本控制系统配置了 WorktreeCreate hook，将其与 WorktreeRemove hook 配对以处理清理。没有它，worktree 目录留在磁盘上。

Claude Code 将 WorktreeCreate 返回的路径作为 `worktree_path` 在 hook 输入中传递。此示例读取该路径并移除目录：

```json  theme={null}
{
  "hooks": {
    "WorktreeRemove": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'jq -r .worktree_path | xargs rm -rf'"
          }
        ]
      }
    ]
  }
}
```

#### WorktreeRemove 输入

除了[通用输入字段](#common-input-fields)外，WorktreeRemove hooks 还接收 `worktree_path` 字段，这是被移除的 worktree 的绝对路径。

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "WorktreeRemove",
  "worktree_path": "/Users/.../my-project/.claude/worktrees/feature-auth"
}
```

WorktreeRemove hooks 没有决定控制。它们无法阻止 worktree 移除，但可以执行清理任务，如移除版本控制状态或存档更改。Hook 失败仅在调试模式下记录。

### PreCompact

在 Claude Code 即将运行压缩操作之前运行。

匹配器值指示压缩是手动还是自动触发：

| 匹配器      | 何时触发         |
| :------- | :----------- |
| `manual` | `/compact`   |
| `auto`   | 当上下文窗口满时自动压缩 |

#### PreCompact 输入

除了[通用输入字段](#common-input-fields)外，PreCompact hooks 还接收 `trigger` 和 `custom_instructions`。对于 `manual`，`custom_instructions` 包含用户传入 `/compact` 的内容。对于 `auto`，`custom_instructions` 为空。

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "PreCompact",
  "trigger": "manual",
  "custom_instructions": ""
}
```

### PostCompact

在 Claude Code 完成压缩操作后运行。使用此事件对新的压缩状态做出反应，例如记录生成的摘要或更新外部状态。

与 `PreCompact` 相同的匹配器值适用：

| 匹配器      | 何时触发           |
| :------- | :------------- |
| `manual` | 在 `/compact` 后 |
| `auto`   | 在上下文窗口满时自动压缩后  |

#### PostCompact 输入

除了[通用输入字段](#common-input-fields)外，PostCompact hooks 还接收 `trigger` 和 `compact_summary`。`compact_summary` 字段包含压缩操作生成的对话摘要。

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "PostCompact",
  "trigger": "manual",
  "compact_summary": "Summary of the compacted conversation..."
}
```

PostCompact hooks 没有决定控制。它们无法影响压缩结果，但可以执行后续任务。

### SessionEnd

当 Claude Code 会话结束时运行。用于清理任务、记录会话统计或保存会话状态。支持匹配器以按退出原因过滤。

hook 输入中的 `reason` 字段指示会话为何结束：

| 原因                            | 描述                   |
| :---------------------------- | :------------------- |
| `clear`                       | 会话使用 `/clear` 命令清除   |
| `resume`                      | 通过交互式 `/resume` 切换会话 |
| `logout`                      | 用户登出                 |
| `prompt_input_exit`           | 用户在提示输入可见时退出         |
| `bypass_permissions_disabled` | 绕过权限模式被禁用            |
| `other`                       | 其他退出原因               |

#### SessionEnd 输入

除了[通用输入字段](#common-input-fields)外，SessionEnd hooks 还接收 `reason` 字段，指示会话为何结束。有关所有值，请参阅上面的[原因表](#sessionend)。

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "SessionEnd",
  "reason": "other"
}
```

SessionEnd hooks 没有决定控制。它们无法阻止会话终止，但可以执行清理任务。

SessionEnd hooks 的默认超时为 1.5 秒。这适用于会话退出、`/clear` 和通过交互式 `/resume` 切换会话。如果您的 hooks 需要更多时间，请将 `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` 环境变量设置为毫秒的更高值。任何每个 hook 的 `timeout` 设置也受此值的限制。

```bash  theme={null}
CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS=5000 claude
```

### Elicitation

当 MCP 服务器在任务中途请求用户输入时运行。默认情况下，Claude Code 显示交互式对话供用户响应。Hooks 可以拦截此请求并以编程方式响应，完全跳过对话。

匹配器字段与 MCP 服务器名称匹配。

#### Elicitation 输入

除了[通用输入字段](#common-input-fields)外，Elicitation hooks 还接收 `mcp_server_name`、`message` 和可选的 `mode`、`url`、`elicitation_id` 和 `requested_schema` 字段。

对于 form 模式 elicitation（最常见的情况）：

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "Elicitation",
  "mcp_server_name": "my-mcp-server",
  "message": "Please provide your credentials",
  "mode": "form",
  "requested_schema": {
    "type": "object",
    "properties": {
      "username": { "type": "string", "title": "Username" }
    }
  }
}
```

对于 URL 模式 elicitation（基于浏览器的身份验证）：

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "Elicitation",
  "mcp_server_name": "my-mcp-server",
  "message": "Please authenticate",
  "mode": "url",
  "url": "https://auth.example.com/login"
}
```

#### Elicitation 输出

要以编程方式响应而不显示对话，返回带有 `hookSpecificOutput` 的 JSON 对象：

```json  theme={null}
{
  "hookSpecificOutput": {
    "hookEventName": "Elicitation",
    "action": "accept",
    "content": {
      "username": "alice"
    }
  }
}
```

| 字段        | 值                           | 描述                                       |
| :-------- | :-------------------------- | :--------------------------------------- |
| `action`  | `accept`、`decline`、`cancel` | 是否接受、拒绝或取消请求                             |
| `content` | object                      | 要提交的 form 字段值。仅在 `action` 为 `accept` 时使用 |

退出代码 2 拒绝 elicitation 并向用户显示 stderr。

### ElicitationResult

在用户响应 MCP elicitation 后运行。Hooks 可以观察、修改或阻止响应，然后将其发送回 MCP 服务器。

匹配器字段与 MCP 服务器名称匹配。

#### ElicitationResult 输入

除了[通用输入字段](#common-input-fields)外，ElicitationResult hooks 还接收 `mcp_server_name`、`action` 和可选的 `mode`、`elicitation_id` 和 `content` 字段。

```json  theme={null}
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "ElicitationResult",
  "mcp_server_name": "my-mcp-server",
  "action": "accept",
  "content": { "username": "alice" },
  "mode": "form",
  "elicitation_id": "elicit-123"
}
```

#### ElicitationResult 输出

要覆盖用户的响应，返回带有 `hookSpecificOutput` 的 JSON 对象：

```json  theme={null}
{
  "hookSpecificOutput": {
    "hookEventName": "ElicitationResult",
    "action": "decline",
    "content": {}
  }
}
```

| 字段        | 值                           | 描述                                      |
| :-------- | :-------------------------- | :-------------------------------------- |
| `action`  | `accept`、`decline`、`cancel` | 覆盖用户的操作                                 |
| `content` | object                      | 覆盖 form 字段值。仅在 `action` 为 `accept` 时有意义 |

退出代码 2 阻止响应，将有效操作更改为 `decline`。

## 基于提示的 Hooks

除了命令和 HTTP hooks 外，Claude Code 还支持基于提示的 hooks（`type: "prompt"`），使用 LLM 来评估是否允许或阻止操作，以及代理 hooks（`type: "agent"`），生成具有工具访问权限的代理验证器。并非所有事件都支持每种 hook 类型。

支持所有四种 hook 类型（`command`、`http`、`prompt` 和 `agent`）的事件：

* `PermissionRequest`
* `PostToolUse`
* `PostToolUseFailure`
* `PreToolUse`
* `Stop`
* `SubagentStop`
* `TaskCompleted`
* `TaskCreated`
* `UserPromptSubmit`

仅支持 `command` 和 `http` hooks 但不支持 `prompt` 或 `agent` 的事件：

* `ConfigChange`
* `CwdChanged`
* `Elicitation`
* `ElicitationResult`
* `FileChanged`
* `InstructionsLoaded`
* `Notification`
* `PermissionDenied`
* `PostCompact`
* `PreCompact`
* `SessionEnd`
* `StopFailure`
* `SubagentStart`
* `TeammateIdle`
* `WorktreeCreate`
* `WorktreeRemove`

`SessionStart` 仅支持 `command` hooks。

### 基于提示的 Hooks 如何工作

基于提示的 hooks 不执行 Bash 命令，而是：

1. 将 hook 输入和您的提示发送到 Claude 模型，默认为 Haiku
2. LLM 使用包含决定的结构化 JSON 响应
3. Claude Code 自动处理决定

### 提示 hook 配置

将 `type` 设置为 `"prompt"` 并提供 `prompt` 字符串而不是 `command`。使用 `$ARGUMENTS` 占位符将 hook 的 JSON 输入数据注入到您的提示文本中。Claude Code 将组合的提示和输入发送到快速 Claude 模型，该模型返回 JSON 决定。

此 `Stop` hook 要求 LLM 在允许 Claude 完成之前评估是否应该停止：

```json  theme={null}
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Evaluate if Claude should stop: $ARGUMENTS. Check if all tasks are complete."
          }
        ]
      }
    ]
  }
}
```

| 字段        | 必需 | 描述                                                                                     |
| :-------- | :- | :------------------------------------------------------------------------------------- |
| `type`    | 是  | 必须是 `"prompt"`                                                                         |
| `prompt`  | 是  | 要发送给 LLM 的提示文本。使用 `$ARGUMENTS` 作为 hook 输入 JSON 的占位符。如果 `$ARGUMENTS` 不存在，输入 JSON 被追加到提示 |
| `model`   | 否  | 用于评估的模型。默认为快速模型                                                                        |
| `timeout` | 否  | 超时（秒）。默认值：30                                                                           |

### 响应架构

LLM 必须使用包含以下内容的 JSON 响应：

```json  theme={null}
{
  "ok": true | false,
  "reason": "Explanation for the decision"
}
```

| 字段       | 描述                                  |
| :------- | :---------------------------------- |
| `ok`     | `true` 允许操作，`false` 防止它             |
| `reason` | 当 `ok` 为 `false` 时必需。向 Claude 显示的解释 |

### 示例：多条件 Stop hook

此 `Stop` hook 使用详细提示检查三个条件，然后允许 Claude 停止。如果 `"ok"` 为 `false`，Claude 继续工作，提供的原因作为其下一条指令。`SubagentStop` hooks 使用相同的格式来评估[subagent](/zh-CN/sub-agents)是否应该停止：

```json  theme={null}
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "You are evaluating whether Claude should stop working. Context: $ARGUMENTS\n\nAnalyze the conversation and determine if:\n1. All user-requested tasks are complete\n2. Any errors need to be addressed\n3. Follow-up work is needed\n\nRespond with JSON: {\"ok\": true} to allow stopping, or {\"ok\": false, \"reason\": \"your explanation\"} to continue working.",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

## 基于代理的 Hooks

基于代理的 hooks（`type: "agent"`）类似于基于提示的 hooks，但具有多轮工具访问。代理 hook 生成一个可以读取文件、搜索代码和检查代码库以验证条件的 subagent，而不是单个 LLM 调用。代理 hooks 支持与基于提示的 hooks 相同的事件。

### 基于代理的 Hooks 如何工作

当代理 hook 触发时：

1. Claude Code 生成一个 subagent，带有您的提示和 hook 的 JSON 输入
2. Subagent 可以使用 Read、Grep 和 Glob 等工具进行调查
3. 在最多 50 轮后，subagent 返回结构化的 `{ "ok": true/false }` 决定
4. Claude Code 以与提示 hook 相同的方式处理决定

代理 hooks 在验证需要检查实际文件或测试输出时很有用，而不仅仅是评估 hook 输入数据。

### 代理 hook 配置

将 `type` 设置为 `"agent"` 并提供 `prompt` 字符串。配置字段与[提示 hooks](#prompt-hook-configuration)相同，但超时更长：

| 字段        | 必需 | 描述                                               |
| :-------- | :- | :----------------------------------------------- |
| `type`    | 是  | 必须是 `"agent"`                                    |
| `prompt`  | 是  | 描述要验证的内容的提示。使用 `$ARGUMENTS` 作为 hook 输入 JSON 的占位符 |
| `model`   | 否  | 要使用的模型。默认为快速模型                                   |
| `timeout` | 否  | 超时（秒）。默认值：60                                     |

响应架构与提示 hooks 相同：`{ "ok": true }` 允许或 `{ "ok": false, "reason": "..." }` 阻止。

此 `Stop` hook 验证所有单元测试通过，然后允许 Claude 完成：

```json  theme={null}
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "agent",
            "prompt": "Verify that all unit tests pass. Run the test suite and check the results. $ARGUMENTS",
            "timeout": 120
          }
        ]
      }
    ]
  }
}
```

## 在后台运行 Hooks

默认情况下，hooks 阻止 Claude 的执行，直到它们完成。对于长时间运行的任务，如部署、测试套件或外部 API 调用，设置 `"async": true` 以在后台运行 hook，同时 Claude 继续工作。异步 hooks 无法阻止或控制 Claude 的行为：响应字段如 `decision`、`permissionDecision` 和 `continue` 无效，因为它们会控制的操作已经完成。

### 配置异步 Hook

将 `"async": true` 添加到命令 hook 的配置以在后台运行它而不阻止 Claude。此字段仅在 `type: "command"` hooks 上可用。

此 hook 在每个 `Write` 工具调用后运行测试脚本。Claude 立即继续工作，同时 `run-tests.sh` 执行最多 120 秒。脚本完成时，其输出在下一个对话轮次上传递：

```json  theme={null}
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/run-tests.sh",
            "async": true,
            "timeout": 120
          }
        ]
      }
    ]
  }
}
```

`timeout` 字段设置后台进程的最大时间（秒）。如果未指定，异步 hooks 使用与同步 hooks 相同的 10 分钟默认值。

### 异步 Hooks 如何执行

当异步 hook 触发时，Claude Code 启动 hook 进程并立即继续，不等待其完成。Hook 通过 stdin 接收与同步 hook 相同的 JSON 输入。

后台进程退出后，如果 hook 产生了带有 `systemMessage` 或 `additionalContext` 字段的 JSON 响应，该内容在下一个对话轮次作为上下文传递给 Claude。

异步 hook 完成通知默认被抑制。要查看它们，请使用 `Ctrl+O` 启用详细模式或使用 `--verbose` 启动 Claude Code。

### 示例：文件更改后运行测试

此 hook 在 Claude 写入文件时在后台启动测试套件，然后在测试完成时将结果报告回 Claude。将此脚本保存到项目中的 `.claude/hooks/run-tests-async.sh` 并使用 `chmod +x` 使其可执行：

```bash  theme={null}
#!/bin/bash
# run-tests-async.sh

# 从 stdin 读取 hook 输入
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# 仅对源文件运行测试
if [[ "$FILE_PATH" != *.ts && "$FILE_PATH" != *.js ]]; then
  exit 0
fi

# 运行测试并通过 systemMessage 报告结果
RESULT=$(npm test 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo "{\"systemMessage\": \"Tests passed after editing $FILE_PATH\"}"
else
  echo "{\"systemMessage\": \"Tests failed after editing $FILE_PATH: $RESULT\"}"
fi
```

然后将此配置添加到项目根目录中的 `.claude/settings.json`。`async: true` 标志让 Claude 在测试运行时继续工作：

```json  theme={null}
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/run-tests-async.sh",
            "async": true,
            "timeout": 300
          }
        ]
      }
    ]
  }
}
```

### 限制

异步 hooks 与同步 hooks 相比有几个限制：

* 仅 `type: "command"` hooks 支持 `async`。基于提示的 hooks 无法异步运行。
* 异步 hooks 无法阻止工具调用或返回决定。到 hook 完成时，触发操作已经进行。
* Hook 输出在下一个对话轮次传递。如果会话空闲，响应等待直到下一个用户交互。
* 每次执行创建一个单独的后台进程。同一异步 hook 的多个触发之间没有去重。

## 安全考虑

### 免责声明

命令 hooks 使用您的系统用户的完整权限运行。

<Warning>
  命令 hooks 使用您的完整用户权限执行 shell 命令。它们可以修改、删除或访问您的用户帐户可以访问的任何文件。在将任何 hook 命令添加到您的配置之前，请审查并测试它们。
</Warning>

### 安全最佳实践

编写 hooks 时请记住这些实践：

* **验证和清理输入**：永远不要盲目信任输入数据
* **始终引用 shell 变量**：使用 `"$VAR"` 而不是 `$VAR`
* **阻止路径遍历**：检查文件路径中的 `..`
* **使用绝对路径**：为脚本指定完整路径，使用 `"$CLAUDE_PROJECT_DIR"` 作为项目根目录
* **跳过敏感文件**：避免 `.env`、`.git/`、密钥等

## Windows PowerShell 工具

在 Windows 上，您可以通过在命令 hook 上设置 `"shell": "powershell"` 在 PowerShell 中运行单个 hooks。Hooks 直接生成 PowerShell，因此这适用于是否设置了 `CLAUDE_CODE_USE_POWERSHELL_TOOL`。Claude Code 自动检测 `pwsh.exe`（PowerShell 7+），回退到 `powershell.exe`（5.1）。

```json  theme={null}
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "shell": "powershell",
            "command": "Write-Host 'File written'"
          }
        ]
      }
    ]
  }
}
```

## 调试 Hooks

运行 `claude --debug` 以查看 hook 执行详细信息，包括哪些 hooks 匹配、它们的退出代码和输出。

```text  theme={null}
[DEBUG] Executing hooks for PostToolUse:Write
[DEBUG] Found 1 hook commands to execute
[DEBUG] Executing hook command: <Your command> with timeout 600000ms
[DEBUG] Hook command completed with status 0: <Your stdout>
```

有关更细粒度的 hook 匹配详细信息，设置 `CLAUDE_CODE_DEBUG_LOG_LEVEL=verbose` 以查看额外的日志行，例如 hook 匹配器计数和查询匹配。

有关故障排除常见问题，如 hooks 不触发、无限 Stop hook 循环或配置错误，请参阅指南中的[限制和故障排除](/zh-CN/hooks-guide#limitations-and-troubleshooting)。
