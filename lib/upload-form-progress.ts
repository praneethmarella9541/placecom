export type UploadFormProgress = {
  loaded: number;
  total: number;
};

export class UploadCancelledError extends Error {
  override name = "UploadCancelledError";

  constructor() {
    super("Upload cancelled");
  }
}

export function isUploadCancelledError(error: unknown): boolean {
  return (
    error instanceof UploadCancelledError ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.message === "Upload cancelled")
  );
}

export function throwIfUploadAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new UploadCancelledError();
}

/** Multipart upload with browser-reported byte progress (fetch has no upload events). */
export function uploadFormDataWithProgress(
  url: string,
  formData: FormData,
  options?: {
    method?: string;
    signal?: AbortSignal;
    onProgress?: (progress: UploadFormProgress) => void;
  }
): Promise<{ status: number; responseText: string }> {
  throwIfUploadAborted(options?.signal);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(options?.method ?? "POST", url);

    const cleanup = () => {
      options?.signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      xhr.abort();
    };

    options?.signal?.addEventListener("abort", onAbort);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      options?.onProgress?.({ loaded: event.loaded, total: event.total });
    };
    xhr.onload = () => {
      cleanup();
      resolve({ status: xhr.status, responseText: xhr.responseText });
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error("Network error during upload"));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new UploadCancelledError());
    };
    xhr.send(formData);
  });
}

/** Bytes sent for one file/chunk mapped to 0–99 (100 reserved for server ack). */
export function bytesSentPercent(sentBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) return 0;
  const sent = Math.max(0, Math.min(sentBytes, totalBytes));
  return Math.round((sent / totalBytes) * 99);
}

/** Bytes sent across chunked upload mapped to 0–99. */
export function chunkedFileBytesPercent(
  fileSize: number,
  bytesBeforeChunk: number,
  loadedInChunk: number,
  chunkSize: number
): number {
  if (fileSize <= 0) return 0;
  const sent = Math.max(0, Math.min(loadedInChunk, chunkSize));
  return bytesSentPercent(bytesBeforeChunk + sent, fileSize);
}

/**
 * Smooth progress display when the browser batches xhr upload events.
 * Display never exceeds reported bytes; it eases toward the latest byte target.
 */
export type SmoothedUploadProgress = {
  markStarted: () => void;
  setBytesPercent: (percent: number) => void;
  markBytesComplete: () => void;
  markComplete: () => void;
  stop: () => void;
};

export function createSmoothedUploadProgress(
  onProgress?: (percent: number) => void,
  options?: { tickMs?: number; stepsToTarget?: number }
): SmoothedUploadProgress {
  let display = 0;
  let target = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const tickMs = options?.tickMs ?? 40;
  const stepsToTarget = options?.stepsToTarget ?? 8;

  const emit = (value: number) => {
    display = Math.min(100, Math.max(0, Math.round(value)));
    onProgress?.(display);
  };

  const tick = () => {
    if (display >= target) {
      if (target >= 100 && timer) {
        clearInterval(timer);
        timer = null;
      }
      return;
    }
    const step = Math.max(1, Math.ceil((target - display) / stepsToTarget));
    emit(Math.min(target, display + step));
  };

  const ensureTimer = () => {
    if (!timer) timer = setInterval(tick, tickMs);
  };

  return {
    markStarted() {
      if (display >= 1) return;
      target = Math.max(target, 1);
      emit(1);
    },
    setBytesPercent(percent: number) {
      const next = Math.min(99, Math.max(0, Math.round(percent)));
      if (next <= display) return;
      target = next;
      ensureTimer();
    },
    markBytesComplete() {
      if (display >= 99) {
        target = 99;
        return;
      }
      target = 99;
      ensureTimer();
    },
    markComplete() {
      target = 100;
      ensureTimer();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
