import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * Recoverable deletion on Windows.
 *
 * The Trash path on macOS is Finder, driven by AppleScript. Windows has no
 * equivalent you can ask nicely: the Recycle Bin is not a directory you move
 * things into. `C:\$Recycle.Bin` is per-volume and SID-scoped, and an entry
 * only becomes restorable because the shell wrote a matching `$I` metadata
 * record naming the original path. Renaming a file into that folder yourself
 * produces something the Recycle Bin shows and cannot restore, which is worse
 * than either deleting it or leaving it alone.
 *
 * So this goes through the shell API that maintains those records:
 * `SHFileOperation` with `FOF_ALLOWUNDO`. That is what Explorer itself calls.
 *
 * Three things about how it is invoked:
 *
 * **PowerShell directly, not through `exec`.** `exec` runs everything through
 * `sh -c`, and Windows has no `sh`. It is on the PATH of a developer machine
 * with Git for Windows installed and absent from everyone else's, which is the
 * shape of a bug that passes CI and fails for users.
 *
 * **Paths arrive in a file, never interpolated into the script.** Nothing the
 * caller controls is ever parsed as PowerShell. A path is data from the moment
 * it is written to the list file to the moment it reaches the C# function.
 *
 * **`FOF_SILENT | FOF_NOCONFIRMATION | FOF_NOERRORUI`.** The managed
 * `Microsoft.VisualBasic.FileSystem.DeleteFile` wrapper is shorter, but its
 * quietest setting is still `OnlyErrorDialogs` — and a modal dialog raised
 * inside a request handler on a machine nobody is looking at hangs the request
 * until someone clicks it.
 *
 * And one hazard that is the whole reason for the drive check below.
 * `FOF_ALLOWUNDO` is a request, not a guarantee: on a volume with no Recycle
 * Bin — a network share, most removable media — the shell deletes the file
 * permanently instead, and `FOF_NOCONFIRMATION` suppresses the one warning
 * that would have said so. The macOS side of this module goes to some trouble
 * never to turn a failed recoverable delete into a permanent one without the
 * caller opting in, and inheriting that behaviour by accident on Windows would
 * undo it. So anything not on a fixed local drive is refused here, which is
 * the same answer `moveToTrash` gives when Finder is unavailable: the caller
 * has to pass `{ permanent: true }` and mean it.
 *
 * See stacksjs/system-cleaner#23.
 */

/**
 * The inline C# that calls the shell, plus the driver that reads the list.
 *
 * `pFrom` is a double-NUL-terminated list, so one call recycles the whole
 * batch and the ~1s `Add-Type` compile is paid once per batch rather than
 * once per file.
 */
const RECYCLE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ScRecycler {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct SHFILEOPSTRUCT {
    public IntPtr hwnd;
    public uint wFunc;
    [MarshalAs(UnmanagedType.LPWStr)] public string pFrom;
    [MarshalAs(UnmanagedType.LPWStr)] public string pTo;
    public ushort fFlags;
    public int fAnyOperationsAborted;
    public IntPtr hNameMappings;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpszProgressTitle;
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  private static extern int SHFileOperation(ref SHFILEOPSTRUCT lpFileOp);

  private const uint FO_DELETE = 0x0003;
  private const ushort FOF_SILENT = 0x0004;
  private const ushort FOF_NOCONFIRMATION = 0x0010;
  private const ushort FOF_ALLOWUNDO = 0x0040;
  private const ushort FOF_NOERRORUI = 0x0400;

  public static int Recycle(string[] paths) {
    var op = new SHFILEOPSTRUCT();
    op.wFunc = FO_DELETE;
    op.pFrom = string.Join("\0", paths) + "\0\0";
    op.fFlags = (ushort)(FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI);
    int code = SHFileOperation(ref op);
    if (code != 0) return code;
    // Aborted with a zero return is still not success, and silently
    // reporting it as one is how a delete that did nothing gets counted.
    return op.fAnyOperationsAborted != 0 ? -1 : 0;
  }
}
'@
  $listFile = $env:SC_RECYCLE_LIST
  $paths = [System.IO.File]::ReadAllLines($listFile, [System.Text.Encoding]::UTF8) | Where-Object { $_ -ne '' }
  if ($paths.Count -eq 0) { exit 0 }

  # FOF_ALLOWUNDO is a request, not a guarantee. A volume with no Recycle Bin
  # deletes permanently instead and FOF_NOCONFIRMATION hides the warning, so
  # refuse rather than silently make a recoverable delete irreversible.
  foreach ($p in $paths) {
    $root = [System.IO.Path]::GetPathRoot($p)
    if (-not $root) {
      [Console]::Error.Write("Cannot determine the volume for $p")
      exit 1
    }
    $drive = New-Object System.IO.DriveInfo($root)
    if ($drive.DriveType -ne [System.IO.DriveType]::Fixed) {
      [Console]::Error.Write("$root is a $($drive.DriveType) volume, which has no Recycle Bin - a delete there cannot be undone")
      exit 1
    }
  }

  $code = [ScRecycler]::Recycle([string[]]$paths)
  if ($code -ne 0) {
    [Console]::Error.Write("SHFileOperation returned $code")
    exit 1
  }
  exit 0
}
catch {
  [Console]::Error.Write($_.Exception.Message)
  exit 1
}
`

/** Where PowerShell lives when the PATH has been trimmed. */
const POWERSHELL = 'powershell.exe'

export interface RecycleOutcome {
  ok: boolean
  error?: string
}

/**
 * Move paths to the Recycle Bin, recoverably.
 *
 * All-or-nothing per call: `SHFileOperation` reports one status for the whole
 * list, so a caller that needs to know which individual path failed has to
 * retry them singly. `moveManyToTrash` already does exactly that on failure.
 */
export async function recycle(paths: string[], timeoutMs = 120_000): Promise<RecycleOutcome> {
  if (paths.length === 0)
    return { ok: true }

  // A newline in a path would split one entry into two in the list file, and
  // the second half could name something else entirely. Win32 rejects these
  // in filenames, so this is a guard against a crafted string rather than a
  // real file — which is the case worth guarding.
  for (const p of paths) {
    if (p.includes('\n') || p.includes('\r'))
      return { ok: false, error: 'Path contains a line break' }
  }

  const listFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sc-recycle-')), 'paths.txt')

  try {
    fs.writeFileSync(listFile, `${paths.join('\n')}\n`, 'utf8')

    const proc = Bun.spawn([POWERSHELL, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', RECYCLE_SCRIPT], {
      stdout: 'pipe',
      stderr: 'pipe',
      // The one channel the script reads from, and the reason no path is ever
      // interpolated into it.
      env: { ...process.env, SC_RECYCLE_LIST: listFile },
    })

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL') }
      catch { /* already gone */ }
    }, timeoutMs)

    const stderr = await new Response(proc.stderr).text()
    const code = await proc.exited
    clearTimeout(timer)

    if (code === 0)
      return { ok: true }

    return { ok: false, error: stderr.trim() || `powershell exited ${code}` }
  }
  catch (err) {
    // PowerShell missing entirely, or a temp directory that cannot be written.
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  finally {
    try { fs.rmSync(path.dirname(listFile), { recursive: true, force: true }) }
    catch { /* best effort */ }
  }
}
