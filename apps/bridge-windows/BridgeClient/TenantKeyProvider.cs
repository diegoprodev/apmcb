namespace BridgeClient;

/// <summary>
/// Gerencia a chave AES-256-GCM do tenant (GET /tenant-key, spec 3.2). Busca
/// via device-auth, decodifica o base64 (32 bytes), cacheia via KeyStore
/// (DPAPI) e mantém em memória. Re-busca quando o cache não existe/corrompe
/// ou passou de TenantKeyRefreshDays. A chave em claro só vive em memória
/// gerenciada — em repouso, sempre DPAPI-protegida.
/// </summary>
public sealed class TenantKeyProvider
{
    private readonly BridgeProtocolClient _client;
    private readonly KeyStore _keyStore;
    private readonly BridgeConfig _config;
    private readonly BridgeLogger _log;

    // MÉDIO de code review (2026-07-23): escrito no loop de background
    // (RunAsync/EnsureAsync), lido de outra thread via tenantKeyProvider
    // (ChallengePoller → BiometricProcessor). Ver mesmo raciocínio em
    // TemplateSyncService._current.
    private volatile byte[]? _current;

    // Intervalo de checagem do refresh — não precisa ser fino: EnsureAsync já
    // decide internamente (via KeyStore.TenantKeyNeedsRefresh) se um refresh
    // de verdade é necessário; checar a cada poucas horas é suficiente pra
    // TenantKeyRefreshDays (default 7 dias) nunca ficar "esquecido" num
    // processo de longa duração — achado MÉDIO de code review (2026-07-23):
    // antes, EnsureAsync só rodava uma vez no boot (BridgeOrchestrator.Start),
    // então o refresh documentado nunca acontecia em runtime contínuo.
    private static readonly TimeSpan CheckInterval = TimeSpan.FromHours(6);

    public TenantKeyProvider(BridgeProtocolClient client, KeyStore keyStore, BridgeConfig config, BridgeLogger log)
    {
        _client = client;
        _keyStore = keyStore;
        _config = config;
        _log = log;
    }

    /// <summary>Chave atual em memória (null se ainda não carregada). Usada pelo BiometricProcessor.</summary>
    public byte[]? Current => _current;

    /// <summary>Carrega do cache DPAPI na inicialização, se existir e não precisar refresh.</summary>
    public void LoadFromCache()
    {
        if (!_keyStore.TenantKeyNeedsRefresh(_config.TenantKeyRefreshDays))
        {
            _current = _keyStore.LoadTenantKey();
        }
    }

    /// <summary>
    /// Garante uma chave válida em memória: usa o cache se ainda fresco, senão
    /// re-busca do BFF. Retorna false se não conseguiu obter (rede/erro) E não
    /// havia cache — o chamador então não tem como decifrar/cifrar templates.
    /// </summary>
    public async Task<bool> EnsureAsync(CancellationToken ct = default)
    {
        if (_current is not null && !_keyStore.TenantKeyNeedsRefresh(_config.TenantKeyRefreshDays))
        {
            return true;
        }

        if (_current is null && !_keyStore.TenantKeyNeedsRefresh(_config.TenantKeyRefreshDays))
        {
            var cached = _keyStore.LoadTenantKey();
            if (cached is not null)
            {
                _current = cached;
                return true;
            }
        }

        try
        {
            var res = await _client.GetTenantKeyAsync(ct);
            var key = Convert.FromBase64String(res.TenantKey);
            if (key.Length != 32)
            {
                _log.Warn($"tenant key com tamanho inesperado ({key.Length} bytes) — descartada");
                return _current is not null;
            }
            _current = key;
            _keyStore.SaveTenantKey(key);
            _log.Info("tenant key atualizada");
            return true;
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            _log.Warn($"falha ao buscar tenant key: {ex.GetType().Name}");
            // Fallback pro cache existente (mesmo que "vencido") — melhor
            // operar com a chave anterior do que travar biometria inteira.
            _current ??= _keyStore.LoadTenantKey();
            return _current is not null;
        }
    }

    /// <summary>
    /// Loop de background que reavalia o refresh periodicamente — sem isto,
    /// TenantKeyRefreshDays só era honrado uma vez, no boot (achado MÉDIO de
    /// code review, 2026-07-23). Roda ao lado de Heartbeat/sync/poller no
    /// mesmo Task.WhenAll do orquestrador.
    /// </summary>
    public async Task RunAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(CheckInterval, ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            await EnsureAsync(ct);
        }
    }
}
