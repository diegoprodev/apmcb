using System.Security.Cryptography;
using System.Text;

namespace BridgeClient;

/// <summary>
/// Espelha byte a byte apps/bff/src/lib/biometric-device-auth.ts
/// (canonicalDeviceRequest) — qualquer divergência aqui quebra TODA
/// autenticação do bridge contra o BFF. Contrato:
///
///   canonical_request =
///     METHOD + "\n" +
///     PATH_WITH_QUERY + "\n" +
///     SHA256_HEX(BODY_UTF8_OR_EMPTY) + "\n" +
///     X-Bridge-Timestamp + "\n" +
///     X-Bridge-Nonce + "\n" +
///     X-Bridge-Device-Id
/// </summary>
public sealed record CanonicalRequestInput(
    string Method,
    string PathWithQuery,
    string BodyUtf8,
    string Timestamp,
    string Nonce,
    string DeviceId
);

public static class DeviceAuthCanonicalizer
{
    public static string Canonicalize(CanonicalRequestInput input)
    {
        return string.Join("\n",
            input.Method.ToUpperInvariant(),
            input.PathWithQuery,
            Sha256Hex(input.BodyUtf8),
            input.Timestamp,
            input.Nonce,
            input.DeviceId);
    }

    private static string Sha256Hex(string bodyUtf8)
    {
        var bytes = Encoding.UTF8.GetBytes(bodyUtf8);
        var hash = SHA256.HashData(bytes);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}
