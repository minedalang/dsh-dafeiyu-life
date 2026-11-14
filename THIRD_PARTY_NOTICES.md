# Third-Party Notices

This repository intentionally keeps third-party origins visible. The product name and repository rename do not erase upstream code ancestry.

## c1overzz/dsh-bili-scroll

- Upstream: https://github.com/c1overzz/dsh-bili-scroll
- Relationship: direct upstream / project ancestry
- License: MIT
- Preserved notice: repository root `LICENSE`

The original DSH Bilibili duty/report plugin forms the historical code base from which this project evolved.

## adoresever/bilibili-mcp

- Upstream: https://github.com/adoresever/bilibili-mcp
- Relationship: vendored and modified Python Bilibili MCP foundation
- License: MIT
- Copyright: Copyright (c) 2026 AGI_Ananas
- Preserved license: `vendor/bilibili-mcp/LICENSE`

Local modifications include restricted tool exposure, send-side policy enforcement, quotas, diagnostics, interaction state, meme/sticker support and additional Bilibili workflows.

## Yuuyuko-uu/dsh-fish-memory

The integrated long-term-memory functionality is derived from the design and portions of **dsh-fish-memory**.

- Upstream: https://github.com/Yuuyuko-uu/dsh-fish-memory
- Original author: Yuuyuko-uu / Yuuyuko
- Relationship: design + portions of implementation integrated and modified
- License: MIT
- Preserved license: `vendor/fish-memory/LICENSE`

Upstream contributions include the core concepts and implementation approach for per-session time-stamped fading memories, stable facts, fact keys, replacement semantics, scoped memory tools and context recall.

Changes made by `dsh-dafeiyu-life` include:

- integration into an explicitly selected “大肥鱼主 Session” instead of a separate plugin lifecycle;
- Claude/Anthropic-compatible ASCII model-facing tool-schema property names;
- deterministic ingestion of DaFeiYu's own Bilibili experiences without additional summarization-model calls;
- unified management UI, backup/restore and old `~/.dsh/fish-memory/<session>.json` import;
- isolation from Bilibili credentials, unrelated DSH sessions and stranger-DM content.

This integration is independently maintained and is not an official release of the upstream author.

## Yuuyuko-uu/dsh-bili-subagent

- Reference: https://github.com/Yuuyuko-uu/dsh-bili-subagent
- Relationship: architectural/product inspiration

Its “long-lived AI companion + going out to Bilibili + bringing experiences back home” model materially inspired this project's later “main Session = home / background plugin = body / local ledger = archive” direction.

No source from this repository is intentionally vendored as third-party code in `dsh-dafeiyu-life`; this notice exists to give clear credit for the architectural inspiration.

## Bilibili relation API documentation and existing SDK (v2.4.89)

- SDK already used by this project: [`bilibili-api-python`](https://github.com/Nemo2011/bilibili-api) (version range specified in `vendor/bilibili-mcp/requirements.txt`). Its public `User.modify_relation` and `RelationType` API is reused via the existing dependency, not copied into the plugin.
- Relationship API protocol reference: [pskdje/bilibili-API-collect](https://github.com/pskdje/bilibili-API-collect/blob/main/docs/user/relation.md) for the **single-target** `GET /x/relation?fid=…` status check. No documentation source code has been copied. The new account-safety gates, local SQLite quotas and opt-in Bilibili MCP tools are independently implemented here.
- Existing upstream `c1overzz/dsh-bili-scroll` and `adoresever/bilibili-mcp` notices and their MIT license files remain retained without modification.

## v2.4.91 independently implemented privacy and social extension

The opt-in per-UID friend interest observations, privacy-isolated interaction batching,
local life-event reflection source, and evidence-based social outreach drafts in this
version are implemented by this repository. The **dsh-fish-memory** credit above still
applies to the integrated memory foundation and its reused design/implementation;
this release does not introduce additional vendored code from another project.


## Community contributors

See `CONTRIBUTORS.md` for fixes and implementation ideas adopted from community reports and pull requests.

## v2.4.92 independently implemented emotion and relationship lifecycle

The persistent role-emotion state, bounded mood decay, whitelist-only relationship metadata,
life timeline, interest-stage presentation, and opt-in public-video sharing intentions in this
release are implemented by this repository. They reuse the existing project modules and do not
vendor or copy new third-party source code. Existing MIT notices for `dsh-bili-scroll`,
`bilibili-mcp`, and `dsh-fish-memory`, and the architectural credit for `dsh-bili-subagent`,
remain in force.
## Qwen3-Embedding-0.6B-GGUF（可选下载的模型权重）

- 上游：<https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF>
- 许可：Apache License 2.0（以模型仓库随附许可为准）。
- 本项目不随 npm 包分发模型权重；用户明确启用后才下载固定 revision 的 `Qwen3-Embedding-0.6B-Q8_0.gguf`，或由用户导入同一文件。Runtime Manager 校验固定文件大小与 SHA-256。

## llama.cpp（可选下载的 CPU 推理 Runtime）

- 上游：<https://github.com/ggml-org/llama.cpp>
- 许可：MIT License（以 release 附带的上游许可文件为准）。
- 本项目不随 npm 包分发平台二进制；用户明确启用后，Runtime Manager 下载固定 `b12110` 平台资产并校验 SHA-256。
