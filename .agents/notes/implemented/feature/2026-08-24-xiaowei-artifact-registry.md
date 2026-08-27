# Agent Note: Xiaowei right-side artifact preview

Status: implemented

English | [中文](2026-08-24-xiaowei-artifact-registry.zh.md)

## Problem

Generated HTML pages, Markdown documents, slides, tables, and charts need a durable identity and a large rendering surface. Rendering an iframe inside every tool row makes the transcript difficult to scan, while `host.openPath` cannot display a server-side file on a remote desktop client. A stored artifact must also remain private to the account and session that produced it.

## Decision

### Durable artifact service

`@deepseek-ai/dsh-artifact` defines the `ArtifactRegistry` service and the closed product kinds `html`, `slides`, `doc`, `sheet`, and `chart`. Each view carries an opaque `ArtifactId`, producer, media type, byte count, and optional workspace and session ownership.

`@deepseek-ai/dsh-artifact-store-fs` stores bytes below `DSH_HOME/artifacts/v1/objects` and JSON metadata below `DSH_HOME/artifacts/v1/meta`. The SHA-256 digest is the artifact id. Reads verify the digest and byte count before returning data. RPC reads encode bytes as base64 because the current envelope is JSON.

### Producers and assembly

The standard preset conditionally mounts `html_build`, `slides_build`, `doc_build`, `sheet_build`, `mermaid_build`, and `svg_build` when the host provides `artifactRegistry`. Each tool requires an Agent session and records that `sessionId` on write. `doc_build` accepts `format: 'html' | 'markdown'`; Markdown remains Markdown in storage instead of being converted to HTML.

Successful tools place the artifact id, media type, and byte count in the existing durable tool-result presentation metadata. This preserves the card after history replay without adding artifact bytes or a new event to the session log.

### Desktop presentation

Artifact tool rows are compact cards. Clicking a card calls the typed `openArtifact` owner action, selects the artifact in the per-session conversation store, and opens the existing resizable details column. `ui-conversation` declares `conversation.details.artifact`; the desktop registers `DocumentPreviewPanel` in that seat. The outer details header names the surface once, and artifact mode gives the viewer an edge-to-edge body rather than nesting another framed panel. The viewer lists the active session's artifacts, selects the clicked item, and lets the user switch among other items. Switching sessions closes the details column through the existing layout lifecycle.

The compact toolbar shows the active artifact identity and uses labeled icon controls so browser handoff, full-screen preview, download, and refresh fit a narrow column. It can portal the same mounted viewer into a frame-wide dialog, and Escape returns it to the details column. The list count, selected row, transient status, preview canvas, and transcript cards use the shared `--dsw-*` theme aliases in light and dark themes.

The HTML viewer gives narrow details columns a 960 CSS pixel isolated page viewport and scales it to the available canvas. This preserves desktop dashboard layout instead of triggering a mobile breakpoint or cropping the page. Frame-wide preview uses the available native width once it reaches 960 pixels.

The renderer handles the supported media types as follows:

- HTML, slides, documents, sheets, and Mermaid pages use an iframe with `sandbox="allow-scripts"`. The packaged desktop loads the frame through an independently served `xiaowei-artifact:` response. The main process re-runs the authorized artifact read and validates its identity, media type, byte count, and bytes before returning HTML with a CSP that permits self-contained scripts while denying network connections, frames, objects, forms, top navigation, and non-data media. The parent renderer keeps its stricter script policy; browser development uses the sandboxed `srcDoc` fallback.
- Markdown uses `react-markdown` with GFM. Raw HTML is disabled, links are inert, remote images become labels, and data image URLs remain renderable.
- SVG is loaded as an image data URL and never inserted into the parent DOM. PNG and JPEG use image data URLs. PDF uses PDF.js.

Native file actions send only the content-addressed artifact id over IPC. The main process re-runs the authorized `artifact.read`, validates the returned id, media type, byte count, and base64 payload, and derives the filename. Download uses the operating system save dialog. External HTML preview applies the same no-network CSP, writes a private file below a random `0700` temporary directory with mode `0600`, and passes that file to the default application. The desktop removes temporary preview directories after a fixed lifetime and before process exit.

### Account authorization

An account caller must pass a session filter to `artifact.list`, and that session must belong to the caller. `artifact.read` and `artifact.remove` read the stored view and authorize its session before returning or deleting bytes. Missing and foreign ids both return `artifact-not-found`. Local callers retain the existing single-user list, read, and idempotent remove behavior.

## Alternatives considered

- **Render the full product inside the transcript** — rejected. Several browsing contexts make long conversations expensive and obscure the conversation. The transcript keeps a compact reopen control and the details column owns rendering.
- **Use `host.openPath`** — rejected. A remote call would open a path on the server rather than on the desktop computer, and Markdown or HTML would not share one consistent product surface.
- **Store artifact bytes in session events** — rejected. Large opaque payloads would increase log and replay cost. Only the small reference belongs in durable tool output.
- **Relax the renderer CSP or use a renderer-created blob URL** — rejected. A nested document inherits the creator or embedding renderer's script restrictions, so allowing artifact inline scripts there would also weaken the application surface. The separately served preview response isolates the two policies.
- **Use a desktop-only `WebContentsView`** — deferred. It provides stronger process isolation but requires main-process view positioning and desktop-only IPC. The sandboxed iframe works in both desktop and web clients; deployments that need untrusted active content should add the isolated viewer before enabling broader capabilities.

## Consequences

The desktop has one ChatGPT-style product viewer for generated HTML, Markdown, documents, sheets, slides, charts, images, and PDFs. It is visually continuous with the conversation details column while retaining side-by-side details, desktop-layout fitting, frame-wide preview, original-byte download, and restricted HTML handoff to the default browser. Preview content is session-scoped and account-authorized, self-contained HTML scripts execute under the isolated artifact policy, and remote media is disabled by default.

The current filesystem layout uses the content digest for both the object and metadata filename. Identical bytes written by different sessions therefore share one metadata row; a later storage migration must separate a unique reference id from the shared digest before cross-session deduplication is relied upon. Base64 also adds wire overhead, and the panel currently reads a complete artifact rather than streaming it.
