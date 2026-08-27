# @deepseek-ai/dsh-tool-sheet

English | [中文](README.zh.md)

`sheet_build` persists model-supplied rows as a semantic HTML table. `sheet_analyze` resolves an XLSX attachment from the current Session, reads one bounded worksheet, infers text and numeric columns, and persists a self-contained HTML analysis page with a table, bar chart, and pie chart. Both tools write `kind: 'sheet'` through `ctx.artifactRegistry`, so the existing artifact panel reads the persisted bytes and renders them in its sandboxed iframe.

## Model Experience

### System prompt

#### What the model sees

Fixed guidance describes `sheet_build` row and column inputs and directs XLSX analysis or visualization requests to `sheet_analyze` with the uploaded attachment id.

##### XLSX analysis guidance

```markdown
When the user uploads an XLSX file and asks for analysis or visualization, call sheet_analyze with its attachmentId. The tool reads only a file owned by the current session and creates a right-side analysis page with a table, bar chart, and pie chart.
```

#### Token effect

Fixed except for the resolved `maxBytes` value included in sheet-build guidance.

#### KV Cache effect

Prefix-stable while plugin visibility, guidance text, and resolved limits are unchanged.

### Tool schemas and results

#### What the model sees

The generated [`sheet_build` and `sheet_analyze` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-sheet) accept structured rows or a current-Session XLSX attachment id with an optional zero-based worksheet index and title. A successful result reports the persisted sheet artifact and the analyzed row count; presentation metadata opens the sheet card.

#### Token effect

Schemas have fixed cost. Results are short and data-dependent; the HTML artifact bytes are not inserted into model history.

#### KV Cache effect

Tool results append after the reusable prefix; schema, config, or visibility changes may invalidate reuse from the changed definition.

## Known Limitations and Deferred Work

- Charts summarize the first non-negative numeric column against the first other column and display at most twenty categories.
- The page contains inline HTML, CSS, and SVG only; it loads no script or external asset.
