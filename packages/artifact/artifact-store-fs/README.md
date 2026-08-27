# `@deepseek-ai/dsh-artifact-store-fs`

English | [中文](README.zh.md)

Private filesystem provider for [`dsh-artifact`](../artifact/README.md). It stores sha256-addressed objects and JSON metadata under a deployment-owned root, publishes them atomically, and mounts `LocalArtifactRegistry` as `ctx.artifactRegistry`.

## Configuration and storage

`path` selects the private store root. `maxArtifactBytes`, `maxArtifactsPerSession`, and `maxObjectBytes` bound admission and enumeration. Object bytes are deduplicated by digest; metadata retains artifact kind, source, ownership, media type, size, timestamps, and optional presentation fields.

## Model Experience

Indirectly, through artifact-producing consumers that persist and render references through this backend.

#### KV Cache effect

None. Filesystem placement and deduplication never alter a model request.

## Known Limitations and Deferred Work

- **Single-host storage.** The provider does not coordinate writers across machines or provide remote replication.
- **No garbage collector.** Content-addressed objects remain until deployment-owned retention work removes unreferenced data.
