import type { Router } from "@stacksjs/bun-router";
import * as fs from "node:fs";
import * as path from "node:path";
import { isPathSafe, getDirSize, HOME } from "@system-cleaner/core";
import { cleanDirectory, emptyTrash } from "@system-cleaner/clean";
import {
  killProcess,
  toggleStartupItem,
  removeStartupItem,
} from "@system-cleaner/uninstall";
import { scanDirectory } from "@system-cleaner/disk";

/**
 * API routes for SystemCleaner.
 *
 * This file is auto-discovered by bun-router from routes/api.ts.
 * The filename "api" becomes the route prefix: /api/*
 *
 * So router.post('/disk-scan', ...) becomes POST /api/disk-scan
 */
export default async function (router: Router) {
  await router.post("/disk-scan", async () => {
    // Run scan in a subprocess to avoid blocking the server
    const worker = new Worker(
      new URL("../workers/disk-scan.ts", import.meta.url).href,
    );

    return new Promise<Response>((resolve) => {
      const timeout = setTimeout(() => {
        worker.terminate();
        resolve(Response.json({ success: false, error: "Scan timed out" }));
      }, 15000);

      worker.onmessage = (e: MessageEvent) => {
        clearTimeout(timeout);
        worker.terminate();
        resolve(Response.json(e.data));
      };

      worker.onerror = (e: ErrorEvent) => {
        clearTimeout(timeout);
        worker.terminate();
        resolve(
          Response.json({ success: false, error: e.message || "Scan failed" }),
        );
      };

      worker.postMessage({ home: HOME, maxDepth: 6, timeoutMs: 12000 });
    });
  });

  await router.post("/delete-path", async (req) => {
    const { path: target } = (await req.json()) as { path: string };
    if (!target)
      return Response.json(
        { success: false, error: "No path provided" },
        { status: 400 },
      );
    const check = isPathSafe(target);
    if (!check.safe)
      return Response.json(
        { success: false, error: check.reason },
        { status: 403 },
      );
    const resolved = path.resolve(target);
    const size = await getDirSize(resolved);
    fs.rmSync(resolved, { recursive: true, force: true });
    return Response.json({ success: true, freedBytes: size });
  });

  await router.post("/clean-dir", async (req) => {
    const { path: target } = (await req.json()) as { path: string };
    if (!target)
      return Response.json(
        { success: false, error: "No path provided" },
        { status: 400 },
      );
    const result = await cleanDirectory(target);
    return Response.json({
      success: result.errors.length === 0,
      freedBytes: result.freedBytes,
      errors: result.errors.length ? result.errors : undefined,
    });
  });

  await router.post("/kill-process", async (req) => {
    const { pid } = (await req.json()) as { pid: number };
    if (!pid)
      return Response.json(
        { success: false, error: "No PID provided" },
        { status: 400 },
      );
    const result = await killProcess(pid);
    return Response.json({ ...result, pid });
  });

  await router.post("/toggle-startup", async (req) => {
    const { filepath, action } = (await req.json()) as {
      filepath: string;
      label: string;
      action: "enable" | "disable";
    };
    if (!filepath)
      return Response.json(
        { success: false, error: "No filepath provided" },
        { status: 400 },
      );
    const result = await toggleStartupItem(filepath, action);
    return Response.json({ ...result, action });
  });

  await router.post("/remove-startup", async (req) => {
    const { filepath } = (await req.json()) as { filepath: string };
    if (!filepath)
      return Response.json(
        { success: false, error: "No filepath provided" },
        { status: 400 },
      );
    const result = await removeStartupItem(filepath);
    return Response.json(result);
  });

  await router.post("/dir-sizes", async (req) => {
    const { paths } = (await req.json()) as { paths: string[] };
    if (!paths || !Array.isArray(paths))
      return Response.json(
        { success: false, error: "No paths provided" },
        { status: 400 },
      );
    const results: Record<string, number> = {};
    await Promise.all(
      paths.map(async (p) => {
        const resolved = path.resolve(p);
        if (!resolved.startsWith(HOME)) return;
        try {
          results[p] = await getDirSize(resolved);
        } catch {
          results[p] = 0;
        }
      }),
    );
    return Response.json({ success: true, sizes: results });
  });

  await router.post("/empty-trash", async () => {
    const result = await emptyTrash();
    return Response.json({
      success: result.success,
      freedBytes: result.freedBytes,
    });
  });
}
