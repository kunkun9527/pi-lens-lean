// On-demand usage guides returned by `help`. Rewritten from pi-lens 4.3.0
// skills/pi-lens-lsp-navigation and skills/pi-lens-ast-grep for the facade
// call shape; nothing here is sent to the model unless help is called.

export const DIAGNOSTICS_GUIDE = `## Diagnostics recipes
- One or several files: lens op=lens_diagnostics source=lsp paths=["src/a.ts","src/b.ts"] input={"scope":"paths"}
- A folder: lens op=lens_diagnostics source=lsp path="src/" input={"scope":"workspace","severity":"error"}
- Slow servers (Rust, Java): add "waitMs": 2000. Warnings too: "severity": "all".
- source=session only reads cached findings; an empty cache is not proof of clean.
- mode: delta = current turn, all = cache-only session view, full = active scan. With mode=full, refreshRunners ("cached" | "cheap" | "all" | "none") may start analyzers that run up to ~180 s; maxProjectFiles, maxLspFiles and includeGenerated bound full scans.`;

export const LSP_GUIDE = `## lsp_navigation recipes
Call shape: lens op=lsp_navigation path=<file> line=<1-based> symbol=<name> input={"operation":"..."}
symbol resolves the character automatically; pass a positive "character" in input instead when needed ("character": -1 still needs symbol; "symbol#N" picks the Nth match). Without either, upstream falls back to column 1 and position queries such as hover often return empty.

| Need | operation | extra input |
|---|---|---|
| Definition / type / declaration | definition, typeDefinition, declaration | |
| All usages | references (query from the definition site for full coverage) | |
| Type info / call signature | hover, signatureHelp (call-site argument only) | |
| Symbols in a file | documentSymbol | |
| Symbol across project | workspaceSymbol (pass path, unscoped queries often return nothing), findSymbol | query, kinds, exactMatch, topLevelOnly, maxResults |
| Quick fixes | codeAction (quickfix differs from generic refactors) | endLine, endCharacter |
| Rename | rename / rename_file (preview unless "apply": true) | newName / newFilePath |
| Implementations | implementation | |
| Callers / callees | prepareCallHierarchy, then incomingCalls or outgoingCalls | callHierarchyItem from the first call |
| Server commands | capabilities, then executeCommand (dry-run unless "apply": true) | command, commandArguments |
| Pushed diagnostics snapshot | workspaceDiagnostics (not a fresh check; use lens_diagnostics source=lsp) | |

Empty definition: the file may not be open yet; read it and retry. TypeScript "No Project": open a file in scope first. prepareCallHierarchy depends on server support.`;

export const AST_GUIDE = `## ast-grep recipes
Call shape: lens op=ast_grep_search path=<file or dir> input={"pattern":"console.log($MSG)","lang":"typescript"}
ast_grep_replace takes "pattern", "rewrite", "lang" and previews unless "apply": true. ast_grep_outline (lens_code) lists structure with read ranges.

Patterns
- $X matches one node and captures it; $$$ matches zero or more nodes; $$$ARGS captures the list.
- Patterns must be valid code: function $NAME($$$) { $$$ }, not function $NAME(.
- Be specific (fetchMetrics($$$ARGS), not fetchMetrics) and scope paths.
- Metavariables do not work inside strings: from "$PATH" matches the literal text.
- Object patterns: no trailing comma; { runnerId: $RID } does not match shorthand { runnerId }, use { runnerId, $$$REST }.
- Several statements: wrap in a block ({ foo(); bar(); }). Module-level plus block-level mixes (an import and a call) need two searches or a YAML rule.

Structural filters (synthesize a YAML rule)
- insideKind: inside an ancestor of this kind, searched through all ancestors (stopBy: end); scope paths on deeply nested files.
- hasKind: immediate child of this kind; hasDescendantKind: any descendant. They are mutually exclusive.
- follows / precedes: sibling pattern before / after.
- rule: a full YAML rule with id and language for all/any/not, nthChild, regex. nodeKind excludes pattern and rule.
- selector narrows to a node kind and does not extract metavariables.

No matches
1. "strictness": "relaxed" ignores unnamed punctuation.
2. "dump": true with a small snippet shows node kinds.
3. Simplify once, then fall back to rg or lsp_navigation.

Paging: "skip": N when results are truncated. Without the facade, the ast-grep CLI (sg) accepts the same patterns and YAML rules.`;
