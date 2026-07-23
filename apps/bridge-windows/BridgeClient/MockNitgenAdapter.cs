using System.Text;

namespace BridgeClient;

/// <summary>
/// Fake determinístico de INitgenAdapter — permite testar TODO o fluxo
/// challenge→captura→proof assinada→submissão sem hardware algum (spec
/// Fase 1C, seção 8.1). "FIR" aqui é só um blob de bytes arbitrário
/// identificado por um rótulo — VerifyMatch compara por igualdade de
/// bytes, não simula o algoritmo biométrico real.
/// </summary>
public sealed class MockNitgenAdapter : INitgenAdapter
{
    public bool DeviceOpened { get; private set; }
    public bool IsDeviceDetected { get; set; } = true;
    public string? DeviceModel { get; set; } = "Mock Hamster";
    public int NextQuality { get; set; } = 90;
    public bool NextCaptureSucceeds { get; set; } = true;
    public string NextCaptureLabel { get; set; } = "finger-1";
    /// <summary>Liveness que a próxima captura reporta (default null = LFD desconhecido, como um leitor sem LFD real).</summary>
    public bool? NextLivenessPassed { get; set; }

    public bool TryOpenDevice(out string? errorMessage)
    {
        if (!IsDeviceDetected)
        {
            errorMessage = "Nenhum leitor NITGEN detectado";
            return false;
        }
        DeviceOpened = true;
        errorMessage = null;
        return true;
    }

    public void CloseDevice() => DeviceOpened = false;

    public NitgenCaptureResult Enroll(int timeoutMs) => Capture(timeoutMs);

    public NitgenCaptureResult Capture(int timeoutMs)
    {
        if (!NextCaptureSucceeds)
        {
            return new NitgenCaptureResult(false, null, 0, NextLivenessPassed, "Timeout aguardando dedo no leitor");
        }
        var fir = Encoding.UTF8.GetBytes($"mock-fir:{NextCaptureLabel}");
        return new NitgenCaptureResult(true, fir, NextQuality, NextLivenessPassed, null);
    }

    public bool VerifyMatch(byte[] capturedFir, byte[] storedFir) => capturedFir.SequenceEqual(storedFir);

    public void Dispose() { }
}
