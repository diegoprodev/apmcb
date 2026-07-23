namespace BridgeClient;

/// <summary>
/// Configuração do bridge — lida de variáveis de ambiente com defaults
/// seguros. O host do BFF é fixo por deploy (spec Fase 1C, seção 3.2: cert
/// pinning assume host conhecido). bridge_version é a versão do assembly.
/// </summary>
public sealed record BridgeConfig(
    string BaseUrl,
    int HeartbeatIntervalSeconds,
    int TenantKeyRefreshDays,
    int TemplateSyncIntervalMinutes,
    int CaptureTimeoutMs,
    int EnrollTimeoutMs,
    IReadOnlyList<string> PinnedSpkiSha256Hex)
{
    public static BridgeConfig FromEnvironment()
    {
        var baseUrl = Env("APMCB_BRIDGE_BASE_URL", "https://api.apmcb.pmpb.online");

        // BAIXO de code review (2026-07-23): nada impedia configurar um
        // BaseUrl http:// — sem TLS, o certificate pinning (CertificatePinning)
        // não tem o que pinar, e os headers de assinatura Ed25519 (prova de
        // identidade do device) trafegariam em texto claro. Fail-fast no
        // boot é mais seguro que descobrir isso operando sem TLS.
        if (!baseUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"APMCB_BRIDGE_BASE_URL precisa começar com https:// (valor atual: \"{baseUrl}\") — sem TLS, certificate pinning e assinatura de request perdem o sentido.");
        }

        return new BridgeConfig(
            BaseUrl: baseUrl,
            HeartbeatIntervalSeconds: EnvInt("APMCB_BRIDGE_HEARTBEAT_SECONDS", 30),
            TenantKeyRefreshDays: EnvInt("BIOMETRIC_TENANT_KEY_REFRESH_DAYS", 7),
            TemplateSyncIntervalMinutes: EnvInt("APMCB_BRIDGE_SYNC_MINUTES", 5),
            CaptureTimeoutMs: EnvInt("APMCB_BRIDGE_CAPTURE_TIMEOUT_MS", 10_000),
            EnrollTimeoutMs: EnvInt("APMCB_BRIDGE_ENROLL_TIMEOUT_MS", 30_000),
            PinnedSpkiSha256Hex: EnvList("APMCB_BRIDGE_PINNED_SPKI_SHA256"));
    }

    public static string BridgeVersion =>
        typeof(BridgeConfig).Assembly.GetName().Version?.ToString() ?? "0.0.0";

    private static string Env(string key, string fallback) =>
        Environment.GetEnvironmentVariable(key) is { Length: > 0 } v ? v : fallback;

    private static int EnvInt(string key, int fallback) =>
        int.TryParse(Environment.GetEnvironmentVariable(key), out var v) && v > 0 ? v : fallback;

    // Hashes SHA-256 (hex) da SPKI da CA intermediária, separados por vírgula
    // — não são segredo (certificado é público), mas o valor real depende de
    // qual CA está ativa no momento do deploy (spec Fase 1C, seção 3.2), por
    // isso vem de config/runbook, nunca hardcoded no código-fonte. Ausente =
    // lista vazia = CertificatePinning.ValidateChain cai pra validação padrão
    // do SO (fail-open documentado, não fail-closed silencioso).
    private static IReadOnlyList<string> EnvList(string key) =>
        Environment.GetEnvironmentVariable(key)?
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            ?? [];
}
