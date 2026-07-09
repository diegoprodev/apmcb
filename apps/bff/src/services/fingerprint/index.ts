import type { IFingerprintSDK } from "./interface";
import { ZKTecoSDK } from "./zkteco";
import { MockFingerprintSDK } from "./mock";

let instance: IFingerprintSDK | null = null;

export async function getFingerprintSDK(): Promise<IFingerprintSDK> {
  if (instance) return instance;

  const sdkName = process.env.FINGERPRINT_SDK ?? "zkteco";

  if (sdkName === "mock" && process.env.NODE_ENV === "production") {
    throw new Error("FINGERPRINT_SDK=mock não é permitido em produção");
  }

  switch (sdkName) {
    case "zkteco":
      instance = new ZKTecoSDK();
      break;
    case "mock":
      instance = new MockFingerprintSDK();
      break;
    default:
      throw new Error(`Unknown fingerprint SDK: ${sdkName}`);
  }

  await instance.initialize();
  return instance;
}

export type { IFingerprintSDK, FingerprintTemplate, IdentifyResult } from "./interface";
