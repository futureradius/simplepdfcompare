// Saving a file: a "Save as" dialog via the File System Access API, falling back to a download.
// Copied from simplepdfclipper's save.ts (ADR 0009), without its folder picker.

interface Writable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}
interface FileHandle {
  createWritable(): Promise<Writable>;
}
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}
type ShowSaveFilePicker = (options: SaveFilePickerOptions) => Promise<FileHandle>;

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

let lastDownloadUrl: string | undefined;

/**
 * Starts a download. The blob URL stays valid until the next download: with the browser set to
 * ask where to save, it is read only once the user confirms that dialog.
 */
export function download(blob: Blob, name: string): void {
  if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl);
  const a = document.createElement("a");
  a.href = lastDownloadUrl = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

/** Asks where to save, then writes; a download if no dialog is available; nothing if the user cancelled. */
export async function saveFile(blob: Blob, suggestedName: string, description: string, mime: string, ext: string): Promise<void> {
  const picker = (window as unknown as { showSaveFilePicker?: ShowSaveFilePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName, types: [{ description, accept: { [mime]: [ext] } }] });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return;
    } catch (e) {
      if (isAbort(e)) return;
      // anything else: fall through to a plain download
    }
  }
  download(blob, suggestedName);
}
