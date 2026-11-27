import { notifications } from '@stacksjs/desktop/browser'
import { readPref } from './preferences'

export const TRAY_CHANNEL = 'systemcleaner-tray'

let authorization: Promise<boolean> | undefined

export async function postCleanupNotice(title: string, body: string): Promise<void> {
  if (!readPref('notifyOnCleanup')) return
  try {
    authorization ??= notifications.requestPermission().finally(() => {
      authorization = undefined
    })
    if (await authorization && readPref('notifyOnCleanup'))
      await notifications.show({ id: crypto.randomUUID(), title, body })
  }
  catch { /* The system controls notification permissions. */ }
}
