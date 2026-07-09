import type { IFingerprintSDK, FingerprintTemplate, IdentifyResult } from "./interface";

/**
 * Mock determinístico para testes e desenvolvimento sem hardware ZKTeco.
 * Ativado com FINGERPRINT_SDK=mock.
 *
 * capture() gera template estável por fingerIndex — verify/identify comparam
 * por igualdade de bytes, então um template capturado e registrado pelo mock
 * sempre valida contra si mesmo (fluxo register → verify testável ponta a ponta).
 */
export class MockFingerprintSDK implements IFingerprintSDK {
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async capture(fingerIndex: number): Promise<FingerprintTemplate> {
    if (!this.initialized) throw new Error("SDK not initialized");
    return {
      data: Buffer.from(`mock-template-finger-${fingerIndex}`),
      fingerIndex,
      quality: 0.99,
    };
  }

  async identify(
    capturedTemplate: Buffer,
    templates: Array<{ userId: string; templateData: Buffer }>
  ): Promise<IdentifyResult | null> {
    if (!this.initialized) throw new Error("SDK not initialized");
    const match = templates.find((t) => t.templateData.equals(capturedTemplate));
    return match ? { userId: match.userId, score: 0.99 } : null;
  }

  async verify(capturedTemplate: Buffer, storedTemplate: Buffer): Promise<boolean> {
    if (!this.initialized) throw new Error("SDK not initialized");
    return capturedTemplate.equals(storedTemplate);
  }

  async dispose(): Promise<void> {
    this.initialized = false;
  }
}
