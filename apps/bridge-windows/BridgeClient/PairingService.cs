using System.Text;

namespace BridgeClient;

/// <summary>
/// Fluxo de pareamento (spec 2.2/6) — o ÚNICO endpoint sem device-auth
/// (POST /api/biometric-bridge/pair), porque o device ainda não tem
/// identidade. Gera o par Ed25519, envia a chave pública PEM + o código de
/// pareamento (o device_name vem do código, escolhido pelo admin — não é
/// enviado pelo bridge), e no sucesso persiste device_id + chave privada via
/// KeyStore (DPAPI). Usa o mesmo cert pinning do resto (mesmo host).
/// </summary>
public sealed class PairingService
{
    private readonly string _baseUrl;
    private readonly KeyStore _keyStore;
    private readonly BridgeLogger _log;
    private readonly HttpMessageHandler _handler;

    public PairingService(string baseUrl, KeyStore keyStore, BridgeLogger log, HttpMessageHandler? handler = null)
    {
        _baseUrl = baseUrl.TrimEnd('/');
        _keyStore = keyStore;
        _log = log;
        _handler = handler ?? CertificatePinning.CreateHandler();
    }

    public sealed record PairingResult(bool Success, string? DeviceId, string? ReserveId, string? TenantId, int StatusCode, string? Error);

    /// <summary>
    /// Pareia com o código informado pelo operador. Gera a chave, chama /pair,
    /// e SÓ persiste a chave se o BFF confirmar (201). Nunca deixa uma chave
    /// órfã no disco se o pareamento falhar.
    /// </summary>
    public async Task<PairingResult> PairAsync(string pairingCode, CancellationToken ct = default)
    {
        var trimmed = pairingCode.Trim();
        if (trimmed.Length == 0)
        {
            return new PairingResult(false, null, null, null, 0, "Código de pareamento vazio");
        }

        using var keyPair = Ed25519KeyPair.Generate();
        var publicKeyPem = keyPair.ExportPublicKeyPem();

        var request = new PairRequest(
            PairingCode: trimmed,
            PublicKey: publicKeyPem,
            SdkVendor: "nitgen",
            SdkVersion: null,
            BridgeVersion: BridgeConfig.BridgeVersion,
            MachineNameHash: HashOrNull(Environment.MachineName),
            HardwareSerialHash: null);

        using var http = new HttpClient(_handler, disposeHandler: false) { Timeout = TimeSpan.FromSeconds(15) };
        using var content = new StringContent(BridgeJson.Serialize(request), Encoding.UTF8, "application/json");

        HttpResponseMessage response;
        try
        {
            response = await http.PostAsync($"{_baseUrl}/api/biometric-bridge/pair", content, ct);
        }
        catch (Exception ex)
        {
            _log.Warn($"pareamento: falha de rede {ex.GetType().Name}");
            return new PairingResult(false, null, null, null, 0, "Falha de rede ao parear");
        }

        var body = await response.Content.ReadAsStringAsync(ct);
        if (!response.IsSuccessStatusCode)
        {
            _log.Warn($"pareamento rejeitado: {(int)response.StatusCode}");
            return new PairingResult(false, null, null, null, (int)response.StatusCode, MapError((int)response.StatusCode));
        }

        PairResponse parsed;
        try
        {
            parsed = BridgeJson.Deserialize<PairResponse>(body);
        }
        catch
        {
            return new PairingResult(false, null, null, null, (int)response.StatusCode, "Resposta de pareamento inválida");
        }

        _keyStore.SavePairedDevice(parsed.DeviceId, parsed.ReserveId, keyPair.ExportRawPrivateKey());
        _log.Info($"pareado: device {parsed.DeviceId} reserve {parsed.ReserveId}");
        return new PairingResult(true, parsed.DeviceId, parsed.ReserveId, parsed.TenantId, (int)response.StatusCode, null);
    }

    private static string? HashOrNull(string? value)
    {
        if (string.IsNullOrEmpty(value)) return null;
        var hash = System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static string MapError(int status) => status switch
    {
        404 => "Código de pareamento não encontrado",
        410 => "Código já usado, revogado ou expirado",
        409 => "Conflito no pareamento",
        503 => "Pareamento temporariamente indisponível",
        _ => $"Erro de pareamento ({status})",
    };
}
