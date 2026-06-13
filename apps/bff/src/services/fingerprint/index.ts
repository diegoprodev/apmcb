import type { IFingerprintSDK } from "./interface";
import { ZKTecoSDK } from "./zkteco";

let instance: IFingerprintSDK | null = null;

export async function getFingerprintSDK(): Promise<IFingerprintSDK> {
  if (instance) return instance;

  const sdkName = process.env.FINGERPRINT_SDK ?? "zkteco";

  switch (sdkName) {
    case "zkteco":
      instance = new ZKTecoSDK();
      break;
    default:
      throw new Error(`Unknown fingerprint SDK: ${sdkName}`);
  }

  await instance.initialize();
  return instance;
}

export type { IFingerprintSDK, FingerprintTemplate, IdentifyResult } from "./interface";
