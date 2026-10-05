# pi-lens-lean

<!-- token-benchmark:summary:start -->
> **Token benchmark: Lean 308, upstream `pi-lens@4.3.0` 2,538 — 87.9% fewer.**
<!-- token-benchmark:summary:end -->
> **Full setup reference:** [Pi Lean Setup](https://github.com/kunkun9527/my-lean-pi-setup)

[简体中文](README.zh-CN.md)

A lean wrapper around [`pi-lens`](https://github.com/apmantza/pi-lens). The upstream runtime runs unchanged (post-write checks, LSP, formatting, read-guard, findings delivery); only the context the model sees on every request is cut down.

## Installation

```bash
pi install git:github.com/kunkun9527/pi-lens-lean
```

Not published to npm yet. To pin a release, append a tag: `git:github.com/kunkun9527/pi-lens-lean@v4.3.0-lean.1`. Remove `npm:pi-lens` first; loading both registers pi-lens twice.

## Differences from upstream

* **Two fixed tools instead of 13**: `lens_code` (find and read code) and `lens` (diagnostics, LSP, ast-grep, project and config). Each `op` is the upstream tool name, so hints in pi-lens output such as "call `module_report`" still match.
* **The tool list never changes mid-session**: upstream's `pi_lens_activate_tools` changes the active tools and invalidates the whole prompt cache. The wrapper drops that tool and turns upstream `setActiveTools` calls into no-ops.
* **No skills**: upstream lists four skills in the system prompt through `resources_discover` (about 337 tokens, not counted in the benchmark below). The two usage guides are rewritten into `help`; the two contributor guides for writing pi-lens rules are dropped.
* **No session-start usage note** (about 197 tokens, once per session). Post-write findings, test results and the "files were reformatted, re-read before editing" nudge are kept.
* **Arguments are validated locally**: the host validates only the facade schema, so after mapping fields the wrapper checks them against the upstream schema with pi-ai's `validateToolArguments`. Unknown argument names, malformed JSON and field/`input` conflicts fail before reaching upstream.

## Usage

| Tool | `op` | Common fields |
| --- | --- | --- |
| `lens_code` | `symbol_search` / `module_report` / `read_symbol` / `read_enclosing` / `ast_grep_outline` | `path`, `paths`, `query`, `symbol`, `line` |
| `lens` | `lens_diagnostics` / `lsp_navigation` / `ast_grep_search` / `ast_grep_replace` / `lens_diagnostic_mark` / `project_report` / `effective_config` | the same, plus `source` |

* `path` lands on the matching upstream field: `path`, `filePath`, `file`, or a one-item `paths`.
* Other upstream arguments go in `input` as a JSON object string, for example `{"operation":"definition"}`.
* `op: "help"` with `input` set to an op returns that op's upstream description, full JSON schema and, for diagnostics, LSP and ast-grep, a usage guide.

```json
{ "op": "read_enclosing", "path": "src/app.ts", "line": 42 }
{ "op": "lens_diagnostics", "source": "lsp", "paths": ["src/a.ts"], "input": "{\"scope\":\"paths\"}" }
{ "op": "lsp_navigation", "path": "src/app.ts", "line": 10, "symbol": "foo", "input": "{\"operation\":\"references\"}" }
```

Tools disabled with `tools.<name>.enabled: false` in the pi-lens config make their op report that it is disabled.

## Initialization context comparison

<!-- token-benchmark:benchmark:start -->
With only this extension enabled, its recurring model-facing initialization contribution is:

| Variant | Tool and prompt contribution | Total |
| --- | --- | ---: |
| Lean `pi-lens-lean@4.3.0` | `lens_code` (133) + `lens` (175) | **308** |
| Upstream `pi-lens@4.3.0` | `lens_diagnostics` (613) + `symbol_search` (352) + `effective_config` (194) + `project_report` (235) + `module_report` (470) + `read_symbol` (233) + `read_enclosing` (322) + `pi_lens_activate_tools` (119) | **2,538** |

This saves **2,230 tokens (87.9%)**.
Measured with Pi 1.0.3 in separate temporary processes with empty working directories and configuration. Built-in tools, skills, context files, session history, user messages, unrelated extensions, runtime UI, and slash commands are excluded; `before_agent_start` additions are included. Tokens are a fixed character-proxy estimate using `ceil(characters / 4)`, not provider tokenizer billing.
<!-- token-benchmark:benchmark:end -->

## Version

The upstream runtime is pinned to `pi-lens@4.3.0` from npm. This repository is a fork of upstream: the default `main` branch holds this wrapper, and the `upstream` branch mirrors upstream pi-lens as a source reference.

## Local development

```bash
npm ci
npm run check
```

## License and credits

MIT. Wraps the MIT-licensed [`pi-lens`](https://github.com/apmantza/pi-lens).
