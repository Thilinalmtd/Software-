// Saving and opening files — native dialogs in the Windows app, downloads in a browser.

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function saveFile(name: string, data: Blob | Uint8Array, filters?: { name: string; extensions: string[] }[]): Promise<boolean> {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart]);
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ defaultPath: name, filters });
    if (!path) return false;
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return true;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}

export async function openExternal(url: string): Promise<void> {
  if (isTauri() && /^https?:/.test(url)) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener');
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
