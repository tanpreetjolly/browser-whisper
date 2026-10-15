interface StoredResponseMetadata {
    url: string;
    fileName: string;
    status: number;
    statusText: string;
    headers: Array<[string, string]>;
}

interface OPFSCacheOptions {
    legacyCacheName: string;
    modelIds?: string[];
    rootName?: string;
}

interface DeleteModelCacheOptions extends OPFSCacheOptions {
    modelId: string;
}

interface CacheLike {
    match(request: RequestInfo | URL): Promise<Response | undefined>;
    put(request: RequestInfo | URL, response: Response): Promise<void>;
    /** Like put() but consumes `response` without a clone; tee would buffer GB-sized models. */
    store(url: string, response: Response): Promise<void>;
}

const DEFAULT_ROOT_NAME = 'browser-whisper-transformers-cache';

/**
 * OPFS-backed cache implementing the subset of the Web Cache API used by
 * transformers.js. It reads OPFS first, migrates legacy Cache API entries on
 * demand, and lets transformers.js fetch remotely when both caches miss.
 */
export function createOPFSCache(options: OPFSCacheOptions): CacheLike {
    const rootName = options.rootName ?? DEFAULT_ROOT_NAME;

    return {
        async match(request: RequestInfo | URL): Promise<Response | undefined> {
            const normalized = normalizeRequest(request);
            const key = await createCacheKey(normalized.url);
            const opfsResponse = await readFromOPFS(rootName, key);

            if (opfsResponse) return opfsResponse;

            const legacyResponse = await readFromLegacyCache(options.legacyCacheName, normalized);
            if (!legacyResponse) return undefined;

            await bestEffortWrite(rootName, key, normalized.url, legacyResponse.clone());
            return legacyResponse;
        },

        async put(request: RequestInfo | URL, response: Response): Promise<void> {
            const normalized = normalizeRequest(request);
            const key = await createCacheKey(normalized.url);
            // Caching is best-effort: a failed write (quota, OOM, aborted stream) must never
            // reject here, or the model load that triggered it would fail/hang.
            await bestEffortWrite(rootName, key, normalized.url, response.clone());
        },

        async store(url: string, response: Response): Promise<void> {
            await bestEffortWrite(rootName, await createCacheKey(url), url, response);
        },
    };
}

/** Remove all browser-whisper model files stored in OPFS and the legacy cache. */
export async function clearOPFSCache(options: OPFSCacheOptions): Promise<void> {
    const rootName = options.rootName ?? DEFAULT_ROOT_NAME;

    if (hasOPFS()) {
        const root = await navigator.storage.getDirectory();
        await removeEntryIfExists(root, rootName, { recursive: true });
    }

    await deleteMatchingLegacyCacheEntries(options.legacyCacheName, options.modelIds ?? []);
}

/** Remove cached files for a single Hugging Face model ID. */
export async function deleteModelFromOPFSCache(options: DeleteModelCacheOptions): Promise<void> {
    const rootName = options.rootName ?? DEFAULT_ROOT_NAME;

    if (hasOPFS()) {
        const originRoot = await navigator.storage.getDirectory();
        const root = await getExistingDirectory(originRoot, rootName);
        if (root) {
            const files = await getExistingDirectory(root, 'files');
            const metadata = await getExistingDirectory(root, 'metadata');

            if (files && metadata) {
                await deleteMatchingOPFSEntries(metadata, files, options.modelId);
            }
        }
    }

    await deleteMatchingLegacyCacheEntries(options.legacyCacheName, options.modelId);
}

function normalizeRequest(request: RequestInfo | URL): Request {
    if (request instanceof Request) return request;
    return new Request(request);
}

async function readFromLegacyCache(
    cacheName: string,
    request: Request,
): Promise<Response | undefined> {
    if (!('caches' in globalThis)) return undefined;

    const cache = await caches.open(cacheName);
    const response = await cache.match(request);
    return response ?? undefined;
}

async function deleteMatchingLegacyCacheEntries(
    cacheName: string,
    modelIds: string | string[],
): Promise<void> {
    if (!('caches' in globalThis)) return;

    const models = Array.isArray(modelIds) ? modelIds : [modelIds];
    if (models.length === 0) return;

    const cache = await caches.open(cacheName);
    const keys = await cache.keys();

    await Promise.all(
        keys
            .filter((request) => models.some((modelId) => isModelUrl(request.url, modelId)))
            .map((request) => cache.delete(request)),
    );
}

async function readFromOPFS(
    rootName: string,
    key: string,
): Promise<Response | undefined> {
    const root = await getCacheRoot(rootName);
    const metadata = await getDirectory(root, 'metadata');

    let fileHandle: FileSystemFileHandle;
    let metadataHandle: FileSystemFileHandle;

    try {
        metadataHandle = await metadata.getFileHandle(`${key}.json`);
    } catch {
        return undefined;
    }

    const metadataFile = await metadataHandle.getFile();
    const responseMetadata = JSON.parse(await metadataFile.text()) as StoredResponseMetadata;
    const files = await getDirectory(root, 'files');

    try {
        fileHandle = await files.getFileHandle(responseMetadata.fileName);
    } catch {
        return undefined;
    }

    const file = await fileHandle.getFile();

    return new Response(file.stream(), {
        status: responseMetadata.status,
        statusText: responseMetadata.statusText,
        headers: responseMetadata.headers,
    });
}

async function bestEffortWrite(
    rootName: string,
    key: string,
    url: string,
    response: Response,
): Promise<void> {
    try {
        await writeToOPFS(rootName, key, url, response);
    } catch (error) {
        console.warn(`[browser-whisper] Unable to cache ${url} in OPFS; continuing without cache.`, error);
        // Release an unread clone so it stops buffering (not awaited; see writeFile).
        if (response.body && !response.body.locked) void response.body.cancel().catch(() => {});
    }
}

async function writeToOPFS(
    rootName: string,
    key: string,
    url: string,
    response: Response,
): Promise<void> {
    if (!response.ok) return;

    const root = await getCacheRoot(rootName);
    const files = await getDirectory(root, 'files');
    const metadata = await getDirectory(root, 'metadata');
    const fileName = `${key}.${crypto.randomUUID()}.bin`;

    try {
        // Stream to disk so multi-GB external-data files never need a second in-memory copy.
        await writeFile(files, fileName, response.body ?? (await response.arrayBuffer()));
    } catch (error) {
        // writeFile already removes partial stream writes; also cover the non-stream path.
        await removeEntryIfExists(files, fileName).catch(() => {});
        throw error;
    }

    const responseMetadata: StoredResponseMetadata = {
        url,
        fileName,
        status: response.status,
        statusText: response.statusText,
        headers: getHeaders(response),
    };

    const metadataBytes = new TextEncoder().encode(JSON.stringify(responseMetadata));
    try {
        await writeFile(metadata, `${key}.json`, metadataBytes);
    } catch (error) {
        await removeEntryIfExists(metadata, `${key}.json`).catch(() => {});
        await removeEntryIfExists(files, fileName).catch(() => {});
        throw error;
    }
}

function getHeaders(response: Response): Array<[string, string]> {
    const headers: Array<[string, string]> = [];
    response.headers.forEach((value, key) => {
        headers.push([key, value]);
    });
    return headers;
}

async function getCacheRoot(rootName: string): Promise<FileSystemDirectoryHandle> {
    if (!navigator.storage?.getDirectory) {
        throw new Error('Origin Private File System is not available in this browser.');
    }

    const root = await navigator.storage.getDirectory();
    return getDirectory(root, rootName);
}

async function getDirectory(
    parent: FileSystemDirectoryHandle,
    name: string,
): Promise<FileSystemDirectoryHandle> {
    return parent.getDirectoryHandle(name, { create: true });
}

async function getExistingDirectory(
    parent: FileSystemDirectoryHandle,
    name: string,
): Promise<FileSystemDirectoryHandle | undefined> {
    try {
        return await parent.getDirectoryHandle(name);
    } catch (error) {
        if (error instanceof DOMException && error.name === 'NotFoundError') return undefined;
        throw error;
    }
}

async function writeFile(
    directory: FileSystemDirectoryHandle,
    name: string,
    data: BufferSource | Blob | ReadableStream<Uint8Array<ArrayBuffer>>,
): Promise<void> {
    const handle = await directory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    if (data instanceof ReadableStream) {
        const reader = data.getReader();
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                await writable.write(value as Uint8Array<ArrayBuffer>);
            }
        } catch (error) {
            // Stop buffering into this tee branch. Don't await: per the Streams spec, cancelling
            // one branch of a cloned Response only settles once the *other* branch is cancelled
            // too, so awaiting here would hang while transformers.js is still reading its copy.
            void reader.cancel().catch(() => {});
            await writable.abort?.().catch(() => {});
            await removeEntryIfExists(directory, name).catch(() => {});
            throw error;
        }
        await writable.close();
        return;
    }
    await writable.write(data);
    await writable.close();
}

async function deleteMatchingOPFSEntries(
    metadata: FileSystemDirectoryHandle,
    files: FileSystemDirectoryHandle,
    modelId: string,
): Promise<void> {
    for await (const [metadataName, handle] of directoryEntries(metadata)) {
        if (handle.kind !== 'file' || !metadataName.endsWith('.json')) continue;

        const metadataHandle = handle as FileSystemFileHandle;
        const metadataFile = await metadataHandle.getFile();
        const responseMetadata = JSON.parse(await metadataFile.text()) as StoredResponseMetadata;

        if (!isModelUrl(responseMetadata.url, modelId)) continue;

        await removeEntryIfExists(files, responseMetadata.fileName);
        await removeEntryIfExists(metadata, metadataName);
    }
}

async function removeEntryIfExists(
    directory: FileSystemDirectoryHandle,
    name: string,
    options?: FileSystemRemoveOptions,
): Promise<void> {
    try {
        await directory.removeEntry(name, options);
    } catch (error) {
        if (error instanceof DOMException && error.name === 'NotFoundError') return;
        throw error;
    }
}

async function* directoryEntries(
    directory: FileSystemDirectoryHandle,
): AsyncIterableIterator<[string, FileSystemHandle]> {
    const iterable = directory as FileSystemDirectoryHandle & {
        entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    };

    yield* iterable.entries();
}

function isModelUrl(url: string, modelId: string): boolean {
    const encodedModelId = modelId.split('/').map(encodeURIComponent).join('/');
    const fullyEncodedModelId = encodeURIComponent(modelId);

    return (
        url.includes(`/${modelId}/`) ||
        url.includes(`/${encodedModelId}/`) ||
        url.includes(`/${fullyEncodedModelId}/`)
    );
}

function hasOPFS(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
}

async function createCacheKey(value: string): Promise<string> {
    const data = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(digest);

    let output = '';
    for (const byte of bytes) {
        output += byte.toString(16).padStart(2, '0');
    }

    return output;
}
