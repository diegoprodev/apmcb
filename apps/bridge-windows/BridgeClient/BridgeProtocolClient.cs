namespace BridgeClient;

/// <summary>
/// Camada tipada sobre DeviceAuthClient — um método por endpoint device-auth
/// do BFF (spec Fase 1C, seção 2). Não decide política (retry, timing,
/// captura) — só monta o request certo, envia assinado, e devolve o DTO
/// parseado + o status pra quem chama decidir. Pareamento (/pair) NÃO está
/// aqui: é o único endpoint sem device-auth, tratado por PairingService com
/// um HttpClient simples (o device ainda não tem identidade quando pareia).
/// </summary>
public sealed class BridgeProtocolClient
{
    private readonly DeviceAuthClient _auth;
    private readonly string _reserveId;

    public BridgeProtocolClient(DeviceAuthClient auth, string reserveId)
    {
        _auth = auth;
        _reserveId = reserveId;
    }

    public async Task<BridgeResponse> HeartbeatAsync(HeartbeatRequest request, CancellationToken ct = default)
    {
        var body = BridgeJson.Serialize(request);
        return await _auth.SendAsync(HttpMethod.Post, "/api/biometric-bridge/heartbeat", body, ct);
    }

    public async Task<ChallengeEnvelope> GetNextChallengeAsync(CancellationToken ct = default)
    {
        var path = $"/api/biometric-bridge/challenges/next?reserve_id={Uri.EscapeDataString(_reserveId)}";
        var res = await _auth.SendAsync(HttpMethod.Get, path, null, ct);
        if (!res.Ok)
        {
            throw new BridgeProtocolException("challenges/next", res.StatusCode, res.Body);
        }
        return BridgeJson.Deserialize<ChallengeEnvelope>(res.Body);
    }

    /// <summary>
    /// Submete proof de identify/verify. `proof` é o dicionário já construído
    /// por ProofPayload.Build (mesmo objeto assinado). Retorna o BridgeResponse
    /// cru — 409 (challenge consumido/expirado) NÃO é exceção aqui, é decisão
    /// de idempotência do chamador (spec 2.6: não reenviar em retry cego).
    /// </summary>
    public async Task<BridgeResponse> SubmitProofAsync(
        string challengeId,
        IReadOnlyDictionary<string, object?> proof,
        string bridgeSignature,
        string result,
        string? failureReason,
        CancellationToken ct = default)
    {
        var body = BridgeJson.Serialize(new Dictionary<string, object?>
        {
            ["proof"] = proof,
            ["bridge_signature"] = bridgeSignature,
            ["result"] = result,
            ["failure_reason"] = failureReason,
        });
        return await _auth.SendAsync(
            HttpMethod.Post,
            $"/api/biometric-bridge/challenges/{Uri.EscapeDataString(challengeId)}/proof",
            body, ct);
    }

    public async Task<BridgeResponse> SubmitEnrollmentAsync(
        string challengeId,
        IReadOnlyDictionary<string, object?> proof,
        string encryptedTemplateDataBase64,
        string templateHash,
        string format,
        int quality,
        string bridgeSignature,
        CancellationToken ct = default)
    {
        var body = BridgeJson.Serialize(new Dictionary<string, object?>
        {
            ["proof"] = proof,
            ["encrypted_template_data"] = encryptedTemplateDataBase64,
            ["template_hash"] = templateHash,
            ["format"] = format,
            ["quality"] = quality,
            ["bridge_signature"] = bridgeSignature,
        });
        return await _auth.SendAsync(
            HttpMethod.Post,
            $"/api/biometric-bridge/challenges/{Uri.EscapeDataString(challengeId)}/enrollment",
            body, ct);
    }

    public async Task<TemplateSyncResponse> SyncTemplatesAsync(string? since, CancellationToken ct = default)
    {
        var path = "/api/biometric-bridge/templates/sync";
        if (!string.IsNullOrEmpty(since))
        {
            path += $"?since={Uri.EscapeDataString(since)}";
        }
        var res = await _auth.SendAsync(HttpMethod.Get, path, null, ct);
        if (!res.Ok)
        {
            throw new BridgeProtocolException("templates/sync", res.StatusCode, res.Body);
        }
        return BridgeJson.Deserialize<TemplateSyncResponse>(res.Body);
    }

    public async Task<TenantKeyResponse> GetTenantKeyAsync(CancellationToken ct = default)
    {
        var res = await _auth.SendAsync(HttpMethod.Get, "/api/biometric-bridge/tenant-key", null, ct);
        if (!res.Ok)
        {
            throw new BridgeProtocolException("tenant-key", res.StatusCode, res.Body);
        }
        return BridgeJson.Deserialize<TenantKeyResponse>(res.Body);
    }
}

public sealed class BridgeProtocolException(string endpoint, int statusCode, string body)
    : Exception($"BFF {endpoint} respondeu {statusCode}: {Truncate(body)}")
{
    public string Endpoint { get; } = endpoint;
    public int StatusCode { get; } = statusCode;
    public string Body { get; } = body;

    private static string Truncate(string s) => s.Length <= 200 ? s : s[..200] + "…";
}
