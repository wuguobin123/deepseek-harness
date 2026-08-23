/**
 * PDF 转换服务 - 把 Office 文档（PPT/Word/Excel）转成 PDF 用于 Electron 内嵌预览。
 *
 * 策略：
 * 1. 只使用 LibreOffice (`/usr/bin/soffice` 或 `libreoffice` in PATH)
 * 2. 不可用时返回 null（渲染端会回退到后端 /preview 端点的 HTML 文本预览）
 *
 * 注意：macOS 版 WPS Office 二进制会忽略 `--convert-to pdf --outdir` CLI 参数，
 * 直接拉起 GUI 进程且不产出 PDF，导致 20s 超时卡顿（2026-07-31 实测），
 * 因此 WPS 不再作为转换工具。
 *
 * 实现要点：
 * - 转换是阻塞的但通常 < 5s，对小文件足够快。
 * - PDF 输出到 `/tmp/workbench-pdf-cache/<file>-<ts>/`，避免重复转换。
 * - 只在主进程内做转换，避免 IPC 反复传大文件。
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SUPPORTED_EXTENSIONS = new Set(['.pptx', '.ppt', '.docx', '.doc', '.xlsx', '.xls']);

/** LibreOffice 候选路径 */
const LIBRE_PATHS = [
  '/usr/bin/soffice',
  '/usr/local/bin/soffice',
  '/opt/homebrew/bin/soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice'
];

interface OfficeTool {
  bin: string;
  args: (input: string, outDir: string) => string[];
}

let cachedTool: OfficeTool | null | undefined;

function findOfficeTool(): OfficeTool | null {
  if (cachedTool !== undefined) return cachedTool;
  for (const path of LIBRE_PATHS) {
    if (existsSync(path)) {
      cachedTool = {
        bin: path,
        args: (input, outDir) => [
          '--headless',
          '--convert-to',
          'pdf',
          '--outdir',
          outDir,
          input
        ]
      };
      return cachedTool;
    }
  }
  cachedTool = null;
  return null;
}

function pdfCacheDir(): string {
  const dir = path.join('/tmp', 'workbench-pdf-cache');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

async function pathToPdfPath(srcPath: string): Promise<string> {
  const dir = path.join(pdfCacheDir(), path.basename(srcPath) + '-' + Date.now());
  await mkdir(dir, { recursive: true });
  return path.join(dir, path.basename(srcPath, path.extname(srcPath)) + '.pdf');
}

export interface ConvertResult {
  ok: boolean;
  pdfPath?: string;
  tool?: string;
  error?: string;
}

export async function convertToPdf(srcPath: string): Promise<ConvertResult> {
  if (!existsSync(srcPath)) {
    return { ok: false, error: '源文件不存在' };
  }
  const ext = path.extname(srcPath).toLowerCase();
  if (ext === '.pdf') {
    return { ok: true, pdfPath: srcPath, tool: 'native' };
  }
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return { ok: false, error: `不支持转换的格式：${ext}` };
  }
  const tool = findOfficeTool();
  if (!tool) {
    return {
      ok: false,
      error:
        '未找到 LibreOffice。\n' +
        '请安装 LibreOffice（brew install --cask libreoffice）以启用 PDF 内嵌预览。'
    };
  }
  const outDir = await pathToPdfPath(srcPath);
  const expectedPdf = path.join(
    outDir,
    path.basename(srcPath, ext) + '.pdf'
  );
  // 缓存命中
  if (existsSync(expectedPdf) && statSync(expectedPdf).size > 0) {
    return { ok: true, pdfPath: expectedPdf, tool: path.basename(tool.bin) };
  }
  try {
    await execFileAsync(tool.bin, tool.args(srcPath, outDir), {
      timeout: 20_000,
      maxBuffer: 1024 * 1024
    });
  } catch (err) {
    return {
      ok: false,
      error: `转换失败（已超时 20s 或工具不可用）：${
        err instanceof Error ? err.message : String(err)
      }`
    };
  }
  if (!existsSync(expectedPdf)) {
    return { ok: false, error: '转换后未找到 PDF 文件' };
  }
  return { ok: true, pdfPath: expectedPdf, tool: path.basename(tool.bin) };
}

export function isConversionSupported(srcPath: string): boolean {
  const ext = path.extname(srcPath).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

export function hasAvailableTool(): boolean {
  return findOfficeTool() !== null;
}
