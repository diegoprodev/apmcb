export interface FingerprintTemplate {
  data: Buffer;
  fingerIndex: number;
  quality: number;
}

export interface IdentifyResult {
  userId: string;
  score: number;
}

export interface IFingerprintSDK {
  initialize(): Promise<void>;
  capture(fingerIndex: number): Promise<FingerprintTemplate>;
  identify(
    capturedTemplate: Buffer,
    templates: Array<{ userId: string; templateData: Buffer }>
  ): Promise<IdentifyResult | null>;
  verify(capturedTemplate: Buffer, storedTemplate: Buffer): Promise<boolean>;
  dispose(): Promise<void>;
}
