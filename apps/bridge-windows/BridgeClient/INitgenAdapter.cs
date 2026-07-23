namespace BridgeClient;

/// <summary>
/// Isola toda chamada ao SDK NITGEN atrás desta interface — spec Fase 1C,
/// seção 5/7. Só NitgenSdkAdapter referencia NITGEN.SDK.NBioBSP.dll; todo
/// o resto do bridge (protocolo, polling, assinatura, sync) testa contra
/// MockNitgenAdapter, sem hardware.
///
/// LIMITE HONESTO (spec seção 5, achado M3 de revisão): esta interface em
/// si é uma hipótese até validar contra o leitor físico real — se o SDK
/// exigir threading STA, handle aberto/fechado por operação, ou captura
/// assíncrona via callback (em vez da chamada bloqueante que a API real
/// confirmada via reflection sugere), o CONTRATO desta interface muda, não
/// só a implementação concreta. A abstração contém o raio de explosão de
/// uma mudança assim, não o elimina.
/// </summary>
public interface INitgenAdapter : IDisposable
{
    /// <summary>Enumera e abre o primeiro leitor NITGEN detectado (auto-detect).</summary>
    bool TryOpenDevice(out string? errorMessage);

    void CloseDevice();

    /// <summary>Reflete o resultado do último TryOpenDevice/heartbeat check — usado pra reportar device_detected.</summary>
    bool IsDeviceDetected { get; }

    string? DeviceModel { get; }

    /// <summary>
    /// Captura bloqueante pra CADASTRO (qualidade mais rigorosa que Capture)
    /// — espera o dedo no leitor internamente, sem callback de progresso
    /// separado (API real confirmada via reflection: NBioAPI.Enroll).
    /// </summary>
    NitgenCaptureResult Enroll(int timeoutMs);

    /// <summary>
    /// Captura bloqueante mais simples/rápida pra 1:1/1:N (identify) — API
    /// real: NBioAPI.Capture.
    /// </summary>
    NitgenCaptureResult Capture(int timeoutMs);

    /// <summary>
    /// Compara um FIR recém-capturado contra um FIR armazenado (offline,
    /// sem reabrir o device) — API real: NBioAPI.VerifyMatch. Retorna só
    /// bool: o SDK não expõe score contínuo em nenhuma chamada (confirmado
    /// via reflection, zero métodos "Score" na DLL) — o gate de qualidade
    /// real acontece dentro do SDK via SecurityLevel, não um score que o
    /// chamador reavalia depois.
    /// </summary>
    bool VerifyMatch(byte[] capturedFir, byte[] storedFir);
}

/// <summary>
/// Resultado de uma captura (Capture/Enroll). LivenessPassed reflete o LFD
/// real do SDK em três estados (spec 2.6/2.7): true = LFD passou; false =
/// dedo falso rejeitado explicitamente (SDK: CAPTURE_FAKE_SUSPICIOUS);
/// null = LFD indisponível/desconhecido no modelo de leitor. O bridge NUNCA
/// inventa true nem omite um false real — propaga o que o SDK reportou.
/// FirData é o FIR já serializado em texto (FIR_TEXTENCODE.TextFIR em bytes
/// UTF-8), pronto pra cifrar/persistir e pra VerifyMatch offline.
/// </summary>
public sealed record NitgenCaptureResult(
    bool Success,
    byte[]? FirData,
    int Quality,
    bool? LivenessPassed,
    string? ErrorMessage);
