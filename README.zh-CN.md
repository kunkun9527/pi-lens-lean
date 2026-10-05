# pi-lens-lean

<!-- token-benchmark:summary:start -->
> **Token 基准：Lean 394，上游 `pi-lens@4.3.0` 2,538，减少 84.5%。**
<!-- token-benchmark:summary:end -->
> **完整配置参考：** [查看 Pi Lean Setup](https://github.com/kunkun9527/my-lean-pi-setup)

[English](README.md)

基于 [`pi-lens`](https://github.com/apmantza/pi-lens) 的精简封装。上游运行时原样保留（写后自动检查、LSP、格式化、read-guard、诊断回传），只把模型每次请求都要看到的部分压到最小。

## 安装

```bash
pi install git:github.com/kunkun9527/pi-lens-lean
```

暂未发布到 npm。要固定版本，在后面加 tag：`git:github.com/kunkun9527/pi-lens-lean@v4.3.0-lean.2`。安装前先移除 `npm:pi-lens`，两个同时加载会把 pi-lens 注册两遍。npm 可能提示 `@ast-grep/cli` 的安装脚本未批准，不影响 ast-grep 使用，可以忽略。

## 和上游的区别

* **13 个工具变 2 个固定工具**：`lens_code`（找代码、读代码）和 `lens`（诊断、LSP、ast-grep、项目与配置）。`op` 直接用上游工具名，pi-lens 输出里"请调用 `module_report`"之类的提示照样对得上。
* **工具列表全程不变**：上游的 `pi_lens_activate_tools` 会在会话中途改工具列表，让整段 prompt 缓存失效。这里丢掉这个工具，并把上游的 `setActiveTools` 变成空操作。
* **不挂 skill**：上游通过 `resources_discover` 往 system prompt 列 4 个 skill（约 337 token，不在下面的基准里）。两个使用指南改写进 `help`，两个"给 pi-lens 写规则"的贡献者指南去掉。
* **去掉会话开头的用法提示**（约 197 token，一次性）。写后发现的问题、测试结果、"文件被自动格式化，编辑前请重读"的提醒都保留。
* **自己校验参数**：宿主只按外层 schema 校验，所以包装层把字段映射到上游参数后，再用 pi-ai 的 `validateToolArguments` 按上游 schema 校验；拼错的参数名、JSON 写错、字段和 `input` 冲突都会直接报错，不会传给上游。

## 使用方法

| 工具 | `op` | 常用字段 |
| --- | --- | --- |
| `lens_code` | `symbol_search` / `module_report` / `read_symbol` / `read_enclosing` / `ast_grep_outline` | `path`、`paths`、`query`、`symbol`、`line` |
| `lens` | `lens_diagnostics` / `lsp_navigation` / `ast_grep_search` / `ast_grep_replace` / `lens_diagnostic_mark` / `project_report` / `effective_config` | 同上，另加 `source` |

* `path` 会落到上游对应的字段：`path`、`filePath`、`file`，或包成一项的 `paths`。
* 其余上游参数写成 JSON 对象字符串放进 `input`，例如 `{"operation":"definition"}`。
* 工具描述里写明了每个 op 的必填参数，不调 `help` 也能一次调对；有测试对照固定版本的上游 schema 检查这些说明。`lsp_navigation` 按位置查询时要给 `symbol` 或 `character`，否则上游默认用第 1 列，常常查不到结果。
* `op: "help"`、`input` 写某个 op，返回该 op 的上游描述、完整 JSON schema，以及（诊断、LSP、ast-grep）用法指南。

```json
{ "op": "read_enclosing", "path": "src/app.ts", "line": 42 }
{ "op": "lens_diagnostics", "source": "lsp", "paths": ["src/a.ts"], "input": "{\"scope\":\"paths\"}" }
{ "op": "lsp_navigation", "path": "src/app.ts", "line": 10, "symbol": "foo", "input": "{\"operation\":\"references\"}" }
```

在 pi-lens 配置里用 `tools.<name>.enabled: false` 关掉的工具，对应 op 会报"已禁用"。

## 初始化上下文占用对比

<!-- token-benchmark:benchmark:start -->
单独启用本扩展时，模型可见的常驻初始化上下文如下：

| 版本 | 工具与 Prompt 构成 | 合计 |
| --- | --- | ---: |
| Lean `pi-lens-lean@4.3.0` | `lens_code` (160) + `lens` (234) | **394** |
| 上游 `pi-lens@4.3.0` | `lens_diagnostics` (613) + `symbol_search` (352) + `effective_config` (194) + `project_report` (235) + `module_report` (470) + `read_symbol` (233) + `read_enclosing` (322) + `pi_lens_activate_tools` (119) | **2,538** |

节省 **2,144 tokens（84.5%）**。
测量环境为 Pi 1.0.3 的独立临时进程、空白工作目录与空白配置。排除内置工具、Skills、上下文文件、会话历史、用户消息、无关扩展、运行时 UI 与 Slash Commands；计入扩展的 `before_agent_start` 注入。Token 是按 `ceil(字符数 / 4)` 计算的固定字符代理估算，并非模型 tokenizer 实际计费值。
<!-- token-benchmark:benchmark:end -->

## 版本说明

上游运行时锁定为 `pi-lens@4.3.0`（npm 包）。本仓库 fork 自上游：默认的 `main` 分支放这个封装，`upstream` 分支同步上游 pi-lens 源码，作参考用。

## 本地开发

```bash
npm ci
npm run check
```

## 开源协议与致谢

MIT 协议。本项目封装自采用 MIT 协议的 [`pi-lens`](https://github.com/apmantza/pi-lens)。
