using NSec.Cryptography;

namespace BridgeClient;

/// <summary>
/// Wrapper fino sobre NSec.Cryptography (libsodium) pra Ed25519 — decisão
/// da spec Fase 1C, seção 1 (achado A6 de revisão): .NET nativo
/// (System.Security.Cryptography) não tem suporte confiável a Ed25519 no
/// Windows. NSec exporta a chave pública em PEM/SPKI
/// (KeyBlobFormat.PkixPublicKeyText) — formato compatível byte a byte com
/// o que o BFF espera (Node crypto.verify(null, data, publicKeyPem, sig)
/// já assume SPKI PEM, mesmo formato usado em toda a Fase 1B).
/// </summary>
public sealed class Ed25519KeyPair : IDisposable
{
    private static readonly SignatureAlgorithm Algorithm = SignatureAlgorithm.Ed25519;

    private readonly Key _key;

    private Ed25519KeyPair(Key key)
    {
        _key = key;
    }

    public static Ed25519KeyPair Generate()
    {
        var creationParameters = new KeyCreationParameters
        {
            ExportPolicy = KeyExportPolicies.AllowPlaintextExport,
        };
        var key = Key.Create(Algorithm, creationParameters);
        return new Ed25519KeyPair(key);
    }

    /// <summary>
    /// Reconstrói a partir da chave privada bruta (32 bytes) — usado ao
    /// carregar a chave já pareada de volta do DPAPI (KeyStore).
    /// </summary>
    public static Ed25519KeyPair FromRawPrivateKey(byte[] rawPrivateKey32Bytes)
    {
        var creationParameters = new KeyCreationParameters
        {
            ExportPolicy = KeyExportPolicies.AllowPlaintextExport,
        };
        var key = Key.Import(Algorithm, rawPrivateKey32Bytes, KeyBlobFormat.RawPrivateKey, creationParameters);
        return new Ed25519KeyPair(key);
    }

    /// <summary>Chave privada bruta (32 bytes) — o que o KeyStore persiste cifrado via DPAPI.</summary>
    public byte[] ExportRawPrivateKey() => _key.Export(KeyBlobFormat.RawPrivateKey);

    /// <summary>Chave pública em PEM/SPKI — exatamente o que /pair envia como `public_key`.</summary>
    public string ExportPublicKeyPem()
    {
        var bytes = _key.PublicKey.Export(KeyBlobFormat.PkixPublicKeyText);
        return System.Text.Encoding.ASCII.GetString(bytes);
    }

    /// <summary>Assina bytes UTF-8 arbitrários (canonical_request ou payload de proof/enrollment) — retorna base64.</summary>
    public string SignBase64(string utf8Payload)
    {
        var data = System.Text.Encoding.UTF8.GetBytes(utf8Payload);
        var signature = Algorithm.Sign(_key, data);
        return Convert.ToBase64String(signature);
    }

    public void Dispose() => _key.Dispose();
}
