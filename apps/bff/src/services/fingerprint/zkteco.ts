import type { IFingerprintSDK, FingerprintTemplate, IdentifyResult } from "./interface";

/**
 * ZKTeco SDK implementation.
 * Stub until real libzkfp bindings are available.
 * Swap SDK: create a class implementing IFingerprintSDK → update factory in index.ts only.
 *
 * Production integration:
 *   1. Install ZKFinger SDK (Linux: libzkfp.so, Windows: zkfp.dll)
 *   2. Replace stub methods with Bun.dlopen() FFI calls to:
 *      - ZKFPM_Init()
 *      - ZKFPM_OpenDevice()
 *      - ZKFPM_AcquireFingerprint()
 *      - ZKFPM_DBMatch() for 1:N search
 *      - ZKFPM_Terminate()
 *   Reference: ZKFinger SDK 4.0 Developer Guide
 */
export class ZKTecoSDK implements IFingerprintSDK {
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
    console.log("[ZKTeco] SDK initialized (stub — replace with FFI bindings)");
  }

  async capture(fingerIndex: number): Promise<FingerprintTemplate> {
    if (!this.initialized) throw new Error("SDK not initialized");
    console.log(`[ZKTeco] Capturing finger ${fingerIndex} (stub)`);
    return {
      data: Buffer.from(`stub-template-finger-${fingerIndex}`),
      fingerIndex,
      quality: 85,
    };
  }

  async identify(
    _capturedTemplate: Buffer,
    templates: Array<{ userId: string; templateData: Buffer }>
  ): Promise<IdentifyResult | null> {
    if (!this.initialized) throw new Error("SDK not initialized");
    console.log(`[ZKTeco] 1:N search against ${templates.length} templates (stub)`);
    return null;
  }

  async verify(
    _capturedTemplate: Buffer,
    _storedTemplate: Buffer
  ): Promise<boolean> {
    if (!this.initialized) throw new Error("SDK not initialized");
    return false;
  }

  async dispose(): Promise<void> {
    this.initialized = false;
    console.log("[ZKTeco] SDK disposed");
  }
}
