namespace BridgeClient;

/// <summary>
/// Amarra os serviços do bridge quando há device pareado (spec seção 5).
/// Carrega a identidade (KeyStore/DPAPI), abre o leitor, e roda em paralelo:
/// heartbeat (30s), sync de templates (5min), tenant key (refresh 7d) e o
/// loop de polling de challenges. Um cancelamento único derruba todos. NÃO
/// participa do pareamento — só entra em cena depois que o device já existe.
/// </summary>
public sealed class BridgeOrchestrator : IDisposable
{
    private readonly BridgeConfig _config;
    private readonly KeyStore _keyStore;
    private readonly BridgeLogger _log;
    private readonly INitgenAdapter _adapter;

    private CancellationTokenSource? _cts;
    private DeviceAuthClient? _authClient;
    private Ed25519KeyPair? _keyPair;
    private Task? _runTask;
    private BiometricProcessor? _processor;

    public HeartbeatService? Heartbeat { get; private set; }
    public bool IsRunning => _runTask is { IsCompleted: false };

    /// <summary>Ver comentário de BiometricProcessor.IsProcessing — expõe pro TrayApp bloquear repareamento durante um challenge em voo.</summary>
    public bool IsProcessingChallenge => _processor?.IsProcessing ?? false;

    public BridgeOrchestrator(BridgeConfig config, KeyStore keyStore, BridgeLogger log, INitgenAdapter adapter)
    {
        _config = config;
        _keyStore = keyStore;
        _log = log;
        _adapter = adapter;
    }

    /// <summary>
    /// Inicia todos os loops se houver device pareado. Retorna false se não há
    /// pareamento (o app deve então abrir o fluxo de pareamento). Idempotente:
    /// não reinicia se já estiver rodando.
    /// </summary>
    public bool Start()
    {
        if (IsRunning) return true;

        var paired = _keyStore.LoadPairedDevice();
        if (paired is null)
        {
            _log.Info("sem device pareado — orquestrador não iniciado");
            return false;
        }

        var (deviceId, reserveId, keyPair) = paired.Value;
        _keyPair = keyPair;
        _authClient = new DeviceAuthClient(_config.BaseUrl, deviceId, keyPair);
        var protocol = new BridgeProtocolClient(_authClient, reserveId);

        var tenantKey = new TenantKeyProvider(protocol, _keyStore, _config, _log);
        tenantKey.LoadFromCache();

        var store = new TemplateStore();
        var sync = new TemplateSyncService(protocol, store, _log);
        sync.LoadFromDisk();

        Heartbeat = new HeartbeatService(protocol, _adapter, _config, _log);

        var processor = new BiometricProcessor(
            _adapter, keyPair, protocol, _config, _log, deviceId,
            tenantKeyProvider: () => tenantKey.Current,
            candidateProvider: () => sync.Current.Templates);

        var poller = new ChallengePoller(protocol, processor, _log);
        _processor = processor;

        if (!_adapter.TryOpenDevice(out var deviceError))
        {
            _log.Warn($"leitor não abriu na inicialização: {deviceError} (bridge segue; heartbeat reporta device_detected=false)");
        }

        _cts = new CancellationTokenSource();
        var ct = _cts.Token;

        _runTask = Task.Run(async () =>
        {
            // Garante a tenant key antes de processar qualquer challenge de
            // identify/enroll (sem ela não dá pra decifrar/cifrar templates).
            await tenantKey.EnsureAsync(ct);

            await Task.WhenAll(
                Heartbeat.RunAsync(ct),
                sync.RunAsync(_config.TemplateSyncIntervalMinutes, ct),
                tenantKey.RunAsync(ct),
                poller.RunAsync(ct));
        }, ct);

        _log.Info($"orquestrador iniciado: device {deviceId} reserve {reserveId}");
        return true;
    }

    public void Stop()
    {
        try { _cts?.Cancel(); } catch { /* ignore */ }

        // ALTO de code review (2026-07-23): Capture/Enroll (via BiometricProcessor,
        // dentro de poller.RunAsync) são chamadas síncronas bloqueantes no SDK
        // nativo, sem CancellationToken — cancelar _cts não as interrompe. Se
        // o wait abaixo estourar o timeout, uma dessas chamadas ainda pode
        // estar presa dentro do SDK, usando o MESMO device nativo. Fechar o
        // device (ou pior, reabri-lo num BridgeOrchestrator novo, ver
        // TrayApp.IsProcessingChallenge) enquanto isso ainda está em voo é
        // exatamente a corrida que causava o achado original — então, ao
        // contrário de antes, só fecha o device se o task REALMENTE terminou.
        // Task.Wait lança AggregateException se o task terminou cancelado/com
        // falha (mesmo assim "terminado") — IsCompleted (checado DEPOIS,
        // fora do try) é o jeito correto de saber se realmente terminou,
        // independente de Wait ter lançado.
        try { _runTask?.Wait(TimeSpan.FromSeconds(5)); } catch { /* esperado em cancelamento */ }
        var finished = _runTask is null or { IsCompleted: true };
        if (finished)
        {
            _adapter.CloseDevice();
        }
        else
        {
            _log.Warn("orquestrador: captura/enroll ainda em andamento após 5s — NÃO fechando o device nativo (evita corrida com a chamada bloqueante em voo); ficará preso até o SDK atingir seu próprio timeout de captura/enroll");
        }
    }

    public void Dispose()
    {
        Stop();
        _cts?.Dispose();
        _authClient?.Dispose();
        _keyPair?.Dispose();
    }
}
