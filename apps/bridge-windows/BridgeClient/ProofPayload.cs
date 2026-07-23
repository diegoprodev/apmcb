namespace BridgeClient;

/// <summary>
/// Monta o dicionário ORDENÁVEL do payload de proof (spec Fase 1C, seção
/// 2.6/2.8) — as 16 chaves do BiometricProofPayload do BFF, todas presentes
/// (null explícito quando não aplicável; o BFF só remove `undefined`, nunca
/// `null`). O mesmo dicionário serve pra: (1) canonicalizar+assinar via
/// BiometricPayloadCanonicalizer; (2) virar o campo `proof` do corpo do
/// request (o BFF re-canonicaliza o que recebe e confere a assinatura, então
/// a ordem no corpo JSON não importa — só o conteúdo).
/// </summary>
public static class ProofPayload
{
    /// <summary>
    /// finger_index no payload: 1-10 (spec 2.6) ou null. Ecoa exatamente o
    /// valor do challenge nos campos de documento; matched_user_id só é
    /// não-nulo em sucesso.
    /// </summary>
    public static Dictionary<string, object?> Build(
        Challenge challenge,
        string deviceId,
        string? matchedUserId,
        double matchScore,
        int? fingerIndex,
        bool? livenessPassed,
        string? sdkVersion,
        string bridgeVersion,
        string timestampIso)
    {
        return new Dictionary<string, object?>
        {
            ["challenge_id"] = challenge.Id,
            ["tenant_id"] = challenge.TenantId,
            ["reserve_id"] = challenge.ReserveId,
            ["device_id"] = deviceId,
            ["actor_id"] = challenge.ActorId,
            ["purpose"] = challenge.Purpose,
            ["matched_user_id"] = matchedUserId,
            ["document_type"] = challenge.DocumentType,
            ["document_id"] = challenge.DocumentId,
            ["document_hash"] = challenge.DocumentHash,
            ["match_score"] = matchScore,
            ["finger_index"] = fingerIndex,
            ["liveness_passed"] = livenessPassed,
            ["sdk_version"] = sdkVersion,
            ["bridge_version"] = bridgeVersion,
            ["timestamp"] = timestampIso,
        };
    }

    /// <summary>
    /// Payload assinado do ENROLLMENT (spec 2.8): proof + template_hash +
    /// format + quality, ordenado. Função DISTINTA da assinatura de proof —
    /// verifyBiometricEnrollmentSignature no BFF canonicaliza este superset.
    /// </summary>
    public static Dictionary<string, object?> WithEnrollmentMetadata(
        Dictionary<string, object?> proof,
        string templateHash,
        string format,
        int quality)
    {
        var merged = new Dictionary<string, object?>(proof)
        {
            ["template_hash"] = templateHash,
            ["format"] = format,
            ["quality"] = quality,
        };
        return merged;
    }

    public static string Sign(Dictionary<string, object?> payload, Ed25519KeyPair keyPair) =>
        keyPair.SignBase64(BiometricPayloadCanonicalizer.Canonicalize(payload));
}
