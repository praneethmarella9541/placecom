/**
 * Pick a local folder for Drive upload without the browser's
 * "Upload N files to this site?" prompt from <input webkitdirectory>.
 * Uses File System Access API where supported; caller falls back to input.
 */

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
};

async function walkDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  pathPrefix: string
): Promise<File[]> {
  const out: File[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const values = (handle as any).values?.() as AsyncIterable<FileSystemHandle> | undefined;
  if (!values) return out;

  for await (const entry of values) {
    const name = entry.name;
    const rel = pathPrefix ? `${pathPrefix}/${name}` : name;
    if (entry.kind === "file") {
      const file = await (entry as FileSystemFileHandle).getFile();
      try {
        Object.defineProperty(file, "webkitRelativePath", {
          value: rel,
          configurable: true,
        });
      } catch {
        /* read-only in some browsers */
      }
      out.push(file);
    } else if (entry.kind === "directory") {
      out.push(...(await walkDirectoryHandle(entry as FileSystemDirectoryHandle, rel)));
    }
  }
  return out;
}

export type PickFolderResult =
  | { ok: true; files: FileList }
  | { ok: false; reason: "cancelled" | "unsupported" };

export async function pickFolderForUpload(): Promise<PickFolderResult> {
  if (typeof window === "undefined" || !("showDirectoryPicker" in window)) {
    return { ok: false, reason: "unsupported" };
  }

  try {
    const dirHandle = await (window as DirectoryPickerWindow).showDirectoryPicker!();
    const files = await walkDirectoryHandle(dirHandle, dirHandle.name);
    const dt = new DataTransfer();
    for (const file of files) dt.items.add(file);
    return { ok: true, files: dt.files };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return { ok: false, reason: "cancelled" };
    }
    throw e;
  }
}
