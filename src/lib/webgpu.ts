type GPULike = { requestAdapter(options?: unknown): Promise<unknown> };

const defaultGpu = (): GPULike | undefined =>
    (globalThis.navigator as unknown as { gpu?: GPULike } | undefined)?.gpu;

/** Requests a high-performance WebGPU adapter; null when unavailable. `features` is always a Set. */
export async function requestWebGPUAdapter(
    gpu: GPULike | undefined = defaultGpu(),
): Promise<{ features: ReadonlySet<string> } | null> {
    if (!gpu) return null;
    try {
        const adapter = (await gpu.requestAdapter({ powerPreference: 'high-performance' })) as
            { features?: Iterable<string> } | null | undefined;
        if (adapter == null) return null;
        return { features: new Set(adapter.features ?? []) };
    } catch {
        return null;
    }
}

/** True when navigator.gpu exists and returns a GPU adapter. */
export async function hasWebGPUAdapter(gpu: GPULike | undefined = defaultGpu()): Promise<boolean> {
    return (await requestWebGPUAdapter(gpu)) != null;
}
