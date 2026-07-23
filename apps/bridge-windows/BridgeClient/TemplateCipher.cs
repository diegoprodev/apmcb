using System.Security.Cryptography;

namespace BridgeClient;

/// <summary>
/// Cifra/decifra templates biométricos com a chave AES-256-GCM derivada
/// do tenant (GET /tenant-key). Layout do blob — spec Fase 1C, seção 3.2
/// (achado A2): nonce(12 bytes) || ciphertext || tag(16 bytes), CSPRNG a
/// cada cifragem (nunca reusado, nunca derivado de contador). Convenção
/// estável entre TODAS as versões do bridge — um template cifrado por um
/// bridge precisa decifrar em outro bridge, possivelmente versão diferente.
/// </summary>
public static class TemplateCipher
{
    private const int NonceBytes = 12;
    private const int TagBytes = 16;

    public static byte[] Encrypt(byte[] plaintext, byte[] key32Bytes)
    {
        var nonce = RandomNumberGenerator.GetBytes(NonceBytes);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[TagBytes];

        using var aesGcm = new AesGcm(key32Bytes, TagBytes);
        aesGcm.Encrypt(nonce, plaintext, ciphertext, tag);

        var blob = new byte[NonceBytes + ciphertext.Length + TagBytes];
        Buffer.BlockCopy(nonce, 0, blob, 0, NonceBytes);
        Buffer.BlockCopy(ciphertext, 0, blob, NonceBytes, ciphertext.Length);
        Buffer.BlockCopy(tag, 0, blob, NonceBytes + ciphertext.Length, TagBytes);
        return blob;
    }

    public static byte[] Decrypt(byte[] blob, byte[] key32Bytes)
    {
        if (blob.Length < NonceBytes + TagBytes)
        {
            throw new ArgumentException("Blob cifrado menor que o mínimo (nonce + tag)", nameof(blob));
        }

        var nonce = blob[..NonceBytes];
        var tag = blob[^TagBytes..];
        var ciphertext = blob[NonceBytes..^TagBytes];
        var plaintext = new byte[ciphertext.Length];

        using var aesGcm = new AesGcm(key32Bytes, TagBytes);
        aesGcm.Decrypt(nonce, ciphertext, tag, plaintext);
        return plaintext;
    }
}
