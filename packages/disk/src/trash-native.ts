/**
 * Move to Trash through Foundation, for the Mac App Store edition.
 *
 * The direct build asks Finder over Apple Events, which keeps "Put Back"
 * working. The App Sandbox refuses Apple Events to Finder, so there the agent
 * calls `-[NSFileManager trashItemAtURL:resultingItemURL:error:]` itself. It
 * moves the item into the Trash of the volume it lives on, the same place
 * Finder would, and the sandbox allows it for anything the person granted.
 *
 * Reached through `bun:ffi` and the Objective-C runtime: the agent is a Bun
 * process with no Objective-C of its own, and this is one message to one
 * class.
 */

import { CString, dlopen, FFIType, ptr } from 'bun:ffi'
import process from 'node:process'

interface Runtime {
  trash: (path: string) => { ok: boolean, error?: string }
}

let runtime: Runtime | null | undefined

function load(): Runtime | null {
  if (runtime !== undefined) return runtime
  runtime = null
  if (process.platform !== 'darwin') return runtime
  try {
    const objc = dlopen('/usr/lib/libobjc.A.dylib', {
      objc_getClass: { args: [FFIType.cstring], returns: FFIType.ptr },
      sel_registerName: { args: [FFIType.cstring], returns: FFIType.ptr },
      objc_msgSend: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    })
    // Loading Foundation registers NSFileManager, NSURL and NSString with the
    // runtime. Bun's dlopen needs a symbol to bind; any exported one will do.
    dlopen('/System/Library/Frameworks/Foundation.framework/Foundation', {
      NSHomeDirectory: { args: [], returns: FFIType.ptr },
    })

    const send = objc.symbols.objc_msgSend
    const cls = (name: string) => objc.symbols.objc_getClass(Buffer.from(`${name}\0`))
    const sel = (name: string) => objc.symbols.sel_registerName(Buffer.from(`${name}\0`))
    const cstring = (value: string) => Buffer.from(`${value}\0`, 'utf8')

    const manager = send(cls('NSFileManager'), sel('defaultManager'), null, null, null)
    if (!manager) return runtime

    const describe = (error: number | null): string => {
      if (!error) return 'could not move to Trash'
      const text = send(error as never, sel('localizedDescription'), null, null, null)
      const utf8 = text ? send(text, sel('UTF8String'), null, null, null) : null
      return utf8 ? new CString(utf8 as never).toString() : 'could not move to Trash'
    }

    runtime = {
      trash(path: string) {
        const nsPath = send(cls('NSString'), sel('stringWithUTF8String:'), ptr(cstring(path)), null, null)
        const url = nsPath ? send(cls('NSURL'), sel('fileURLWithPath:'), nsPath, null, null) : null
        if (!url) return { ok: false, error: 'invalid path' }
        const errorOut = new BigUint64Array(1)
        // Returns a BOOL; read through a pointer-sized return, only the low
        // byte is defined.
        const moved = send(manager, sel('trashItemAtURL:resultingItemURL:error:'), url, null, ptr(errorOut))
        const ok = (Number(moved ?? 0) & 0xFF) !== 0
        return ok ? { ok: true } : { ok: false, error: describe(Number(errorOut[0]) || null) }
      },
    }
  }
  catch {
    runtime = null
  }
  return runtime
}

/** Move one item to the Trash with Foundation. macOS only. */
export function trashWithFoundation(path: string): { ok: boolean, error?: string } {
  const native = load()
  if (!native) return { ok: false, error: 'Foundation is not available' }
  return native.trash(path)
}
