import { toast } from 'sonner';
import { isTauri } from './files';

// Checks GitHub Releases for a newer signed version (only in release builds with an updater key).

export async function checkForUpdates(manual = false): Promise<void> {
  if (!isTauri()) {
    if (manual) toast.info('Updates are installed by the Windows app.');
    return;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const enabled = await invoke<boolean>('updater_enabled');
    if (!enabled) {
      if (manual) toast.info('This build was made without automatic updates.');
      return;
    }
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) {
      if (manual) toast.success('You have the latest version.');
      return;
    }
    toast(`Version ${update.version} is available`, {
      description: update.body?.slice(0, 160) || 'Install now; the app restarts in a few seconds.',
      duration: Infinity,
      action: {
        label: 'Install & restart',
        onClick: async () => {
          const id = toast.loading('Downloading update…');
          try {
            await update.downloadAndInstall();
            const { relaunch } = await import('@tauri-apps/plugin-process');
            await relaunch();
          } catch (e) {
            toast.error(`Update failed: ${e instanceof Error ? e.message : String(e)}`, { id });
          }
        },
      },
    });
  } catch (e) {
    if (manual) toast.error(`Could not check for updates: ${e instanceof Error ? e.message : String(e)}`);
  }
}
