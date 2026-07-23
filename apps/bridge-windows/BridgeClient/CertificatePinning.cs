using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace BridgeClient;

/// <summary>
/// Certificate pinning contra a SPKI da CA intermediária (spec Fase 1C,
/// seção 3.2, achado A3) — nunca contra o leaf (renova a cada ~60-90 dias
/// via Let's Encrypt e quebraria todos os bridges simultaneamente). Suporta
/// múltiplos pins (atual + próximo conhecido) pra rotação sem quebrar em
/// produção. Fail-closed: com pins configurados, nenhum elemento da cadeia
/// batendo = conexão rejeitada, nunca fallback pra validação padrão do SO.
/// Compartilhado por DeviceAuthClient e PairingService (mesmo host).
/// </summary>
public static class CertificatePinning
{
    /// <summary>
    /// Hashes SHA-256 (hex minúsculo) da SubjectPublicKeyInfo dos certificados
    /// aceitos (RFC 7469). Vazio até o runbook de deploy popular os pins reais
    /// — NÃO são segredo (são hashes públicos de certificado), mas ficam vazios
    /// de propósito até confirmar quais intermediárias estão em uso no deploy.
    /// </summary>
    public static HashSet<string> PinnedSpkiSha256Hex { get; } = new(StringComparer.OrdinalIgnoreCase);

    public static HttpClientHandler CreateHandler() => new()
    {
        ServerCertificateCustomValidationCallback = ValidateChain,
    };

    public static bool ValidateChain(
        HttpRequestMessage request,
        X509Certificate2? certificate,
        X509Chain? chain,
        SslPolicyErrors errors)
    {
        if (errors != SslPolicyErrors.None) return false;
        if (PinnedSpkiSha256Hex.Count == 0) return true; // pins ainda não configurados: validação padrão já passou
        if (chain is null) return false;

        foreach (var element in chain.ChainElements)
        {
            if (PinnedSpkiSha256Hex.Contains(SpkiSha256Hex(element.Certificate)))
            {
                return true;
            }
        }
        return false;
    }

    public static string SpkiSha256Hex(X509Certificate2 cert)
    {
        var spki = cert.PublicKey.ExportSubjectPublicKeyInfo();
        return Convert.ToHexString(SHA256.HashData(spki)).ToLowerInvariant();
    }
}
