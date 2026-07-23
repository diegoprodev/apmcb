namespace BridgeClient;

/// <summary>
/// Envia heartbeat periódico (spec 2.3) — status de saúde, NÃO detecção de
/// challenge. A cada HeartbeatIntervalSeconds enquanto pareado. device_detected
/// e device_model vêm do adapter do SDK (persistidos no BFF desde a migration
/// device_detected da Fase C). Falha de heartbeat nunca derruba o loop — só
/// loga; o próximo tick tenta de novo.
/// </summary>
/// <summary>
/// MÉDIO de code review (2026-07-23): distingue falha de rede transitória
/// (retry normal, nenhuma ação do operador) de rejeição de autenticação
/// persistente (401/403 — device revogado no painel admin). Sem essa
/// distinção, um PC roubado e revogado pelo admin continuava mostrando ícone
/// verde indefinidamente — exatamente o cenário que a revogação (documentada
/// em KeyStore.cs como "a proteção real contra furto físico") deveria tornar
/// visível pro operador local, e não tornava.
/// </summary>
public enum HeartbeatStatus { Unknown, Ok, AuthRejected, NetworkError }

public sealed class HeartbeatService
{
    private readonly BridgeProtocolClient _client;
    private readonly INitgenAdapter _adapter;
    private readonly BridgeConfig _config;
    private readonly BridgeLogger _log;

    // MÉDIO de code review (2026-07-23): escritas no loop de background,
    // leituras no timer de UI (thread diferente) — volatile garante que a
    // escrita mais recente seja visível pra outra thread sem depender de
    // comportamento não garantido pelo memory model do C#.
    private volatile bool _lastHeartbeatOk;
    private volatile bool _lastDeviceDetected;
    private volatile HeartbeatStatus _lastStatus = HeartbeatStatus.Unknown;

    public HeartbeatService(BridgeProtocolClient client, INitgenAdapter adapter, BridgeConfig config, BridgeLogger log)
    {
        _client = client;
        _adapter = adapter;
        _config = config;
        _log = log;
    }

    /// <summary>Estado do último heartbeat — TrayApp lê pra pintar o ícone.</summary>
    public bool LastHeartbeatOk => _lastHeartbeatOk;
    public bool LastDeviceDetected => _lastDeviceDetected;
    public HeartbeatStatus LastStatus => _lastStatus;

    public HeartbeatRequest BuildPayload(string? lastErrorCode)
    {
        return new HeartbeatRequest(
            BridgeVersion: BridgeConfig.BridgeVersion,
            SdkVersion: _adapter.DeviceModel is null ? null : "eNBSP",
            DriverVersion: null,
            DeviceDetected: _adapter.IsDeviceDetected,
            DeviceModel: _adapter.DeviceModel,
            LastErrorCode: lastErrorCode);
    }

    public async Task RunAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await SendOnceAsync(null, ct);
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(_config.HeartbeatIntervalSeconds), ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    public async Task SendOnceAsync(string? lastErrorCode, CancellationToken ct)
    {
        try
        {
            var payload = BuildPayload(lastErrorCode);
            var res = await _client.HeartbeatAsync(payload, ct);
            _lastHeartbeatOk = res.Ok;
            _lastDeviceDetected = payload.DeviceDetected;
            _lastStatus = res.Ok
                ? HeartbeatStatus.Ok
                : res.StatusCode is 401 or 403 ? HeartbeatStatus.AuthRejected : HeartbeatStatus.NetworkError;
            if (!res.Ok)
            {
                _log.Warn($"heartbeat falhou: {res.StatusCode}");
            }
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            _lastHeartbeatOk = false;
            _lastStatus = HeartbeatStatus.NetworkError;
            _log.Warn($"heartbeat exceção: {ex.GetType().Name}");
        }
    }
}
