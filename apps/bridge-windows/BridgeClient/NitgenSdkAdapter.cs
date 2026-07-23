#if NITGEN_SDK
using System.Text;
using NITGEN.SDK.NBioBSP;

namespace BridgeClient;

/// <summary>
/// Implementação REAL do INitgenAdapter contra NITGEN.SDK.NBioBSP.dll
/// (binding .NET oficial, v5.2 — spec Fase 1C, seção 7). ÚNICA classe do
/// bridge que referencia o SDK: compilada só quando o símbolo NITGEN_SDK
/// está definido (csproj: Condition=Exists da DLL) — em máquina/CI sem o
/// SDK, o projeto compila sem esta classe e o app cai no MockNitgenAdapter.
///
/// LIMITE HONESTO (spec seção 5): esta classe NÃO foi validada contra o
/// leitor físico. A API foi confirmada via reflection + samples oficiais,
/// mas o comportamento real (latência, LFD do modelo específico, acesso USB
/// estável pós sleep/wake) só se confirma no gate de hardware (seção 8.2).
/// Serialização de template: FIR_TEXTENCODE (wide) → string → bytes UTF-8,
/// convenção estável compartilhada entre bridges (um cadastra, outro casa).
/// </summary>
public sealed class NitgenSdkAdapter : INitgenAdapter
{
    private readonly NBioAPI _api;
    private readonly BridgeLogger _log;
    private short _deviceId = -1;
    private bool _lfdEnabled;

    public bool IsDeviceDetected { get; private set; }
    public string? DeviceModel { get; private set; }

    public NitgenSdkAdapter(BridgeLogger log)
    {
        _log = log;
        _api = new NBioAPI();
    }

    public bool TryOpenDevice(out string? errorMessage)
    {
        uint ret = _api.EnumerateDevice(out uint numDevice, out short[] deviceIds, out NBioAPI.Type.DEVICE_INFO_EX[] infoEx);
        if (ret != NBioAPI.Error.NONE || numDevice == 0 || deviceIds is null || deviceIds.Length == 0)
        {
            IsDeviceDetected = false;
            errorMessage = "Nenhum leitor NITGEN detectado";
            return false;
        }

        var id = deviceIds[0];
        ret = _api.OpenDevice(id);
        if (ret != NBioAPI.Error.NONE)
        {
            IsDeviceDetected = false;
            errorMessage = $"Falha ao abrir o leitor (código {ret})";
            return false;
        }

        _deviceId = id;
        IsDeviceDetected = true;
        DeviceModel = infoEx is { Length: > 0 } ? infoEx[0].Name : "NITGEN";

        // LFD (Live Finger Detection) — se o modelo suportar, capturas passam
        // a rejeitar dedo falso (CAPTURE_FAKE_SUSPICIOUS). Nível 1 = mais
        // permissivo; ajuste fino é item de hardware. Se SetLFDLevel falhar,
        // o modelo não suporta LFD → liveness_passed fica null (desconhecido),
        // nunca inventado como true.
        _lfdEnabled = _api.SetLFDLevel(1) == NBioAPI.Error.NONE;
        _log.Info($"leitor aberto: {DeviceModel}, LFD={( _lfdEnabled ? "on" : "indisponível")}");
        errorMessage = null;
        return true;
    }

    public void CloseDevice()
    {
        if (_deviceId >= 0)
        {
            _api.CloseDevice(_deviceId);
            _deviceId = -1;
        }
        IsDeviceDetected = false;
    }

    public NitgenCaptureResult Enroll(int timeoutMs)
    {
        var winOption = InvisibleWindow();
        uint ret = _api.Enroll(null, out NBioAPI.Type.HFIR hFIR, null, timeoutMs, null, winOption);
        return BuildResult(ret, hFIR);
    }

    public NitgenCaptureResult Capture(int timeoutMs)
    {
        var winOption = InvisibleWindow();
        uint ret = _api.Capture(NBioAPI.Type.FIR_PURPOSE.VERIFY, out NBioAPI.Type.HFIR hFIR, timeoutMs, null, winOption);
        return BuildResult(ret, hFIR);
    }

    private NitgenCaptureResult BuildResult(uint ret, NBioAPI.Type.HFIR hFIR)
    {
        // hFIR é um handle nativo (aponta pra memória alocada pelo SDK, fora
        // do GC) — "out" obriga a SDK a atribuí-lo em TODO caminho de saída,
        // inclusive falha (ex: CAPTURE_FAKE_SUSPICIOUS ainda captura antes de
        // rejeitar). Sem Dispose() aqui, cada Enroll/Capture vaza um handle —
        // num app de bandeja que fica dias/semanas rodando (spec, seção 4),
        // isso esgota recurso nativo até crashar ou exigir restart manual.
        // finally garante liberação em QUALQUER branch de retorno abaixo.
        try
        {
            if (ret == NBioAPI.Error.CAPTURE_FAKE_SUSPICIOUS)
            {
                return new NitgenCaptureResult(false, null, 0, LivenessPassed: false, "Dedo falso suspeito (LFD)");
            }
            if (ret == NBioAPI.Error.CAPTURE_TIMEOUT)
            {
                return new NitgenCaptureResult(false, null, 0, Liveness(), "Timeout aguardando dedo no leitor");
            }
            if (ret == NBioAPI.Error.USER_CANCEL || ret == NBioAPI.Error.USER_BACK)
            {
                return new NitgenCaptureResult(false, null, 0, Liveness(), "Captura cancelada");
            }
            if (ret == NBioAPI.Error.DEVICE_LOST_DEVICE)
            {
                IsDeviceDetected = false;
                return new NitgenCaptureResult(false, null, 0, Liveness(), "Leitor desconectado");
            }
            if (ret != NBioAPI.Error.NONE || hFIR is null)
            {
                return new NitgenCaptureResult(false, null, 0, Liveness(), $"Falha de captura (código {ret})");
            }

            // Sucesso: extrai o FIR em texto (serializável) + a qualidade do header.
            uint textRet = _api.GetTextFIRFromHandle(hFIR, out NBioAPI.Type.FIR_TEXTENCODE textFir, true);
            if (textRet != NBioAPI.Error.NONE || textFir.TextFIR is null)
            {
                return new NitgenCaptureResult(false, null, 0, Liveness(), "Falha ao extrair o template capturado");
            }

            int quality = 0;
            if (_api.GetHeaderFromHandle(hFIR, out NBioAPI.Type.FIR_HEADER header) == NBioAPI.Error.NONE)
            {
                quality = header.Quality;
            }

            var firBytes = Encoding.UTF8.GetBytes(textFir.TextFIR);
            return new NitgenCaptureResult(true, firBytes, quality, Liveness(), null);
        }
        finally
        {
            hFIR?.Dispose();
        }
    }

    public bool VerifyMatch(byte[] capturedFir, byte[] storedFir)
    {
        var captured = new NBioAPI.Type.FIR_TEXTENCODE { IsWideChar = true, TextFIR = Encoding.UTF8.GetString(capturedFir) };
        var stored = new NBioAPI.Type.FIR_TEXTENCODE { IsWideChar = true, TextFIR = Encoding.UTF8.GetString(storedFir) };
        uint ret = _api.VerifyMatch(captured, stored, out bool result, null);
        return ret == NBioAPI.Error.NONE && result;
    }

    /// <summary>Liveness só é conhecida (true em sucesso) quando o LFD está ativo; senão null.</summary>
    private bool? Liveness() => _lfdEnabled ? true : null;

    private static NBioAPI.Type.WINDOW_OPTION InvisibleWindow() => new()
    {
        WindowStyle = (uint)NBioAPI.Type.WINDOW_STYLE.INVISIBLE,
    };

    public void Dispose()
    {
        CloseDevice();
        _api.Dispose();
    }
}
#endif
