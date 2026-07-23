using System.Text;
using BridgeClient;

namespace BridgeClient.Tests;

[TestFixture]
public class Ed25519KeyPairTests
{
    [Test]
    public void Sign_verifica_com_a_propria_chave_e_falha_com_payload_adulterado()
    {
        using var kp = Ed25519KeyPair.Generate();
        var payload = "canonical-request-abc";
        var sig = kp.SignBase64(payload);

        // Verifica via .NET nativo usando a chave pública PEM exportada — mesmo
        // caminho que o BFF usa (crypto.verify(null, data, pem, sig)).
        Assert.That(VerifyWithPem(kp.ExportPublicKeyPem(), payload, sig), Is.True);
        Assert.That(VerifyWithPem(kp.ExportPublicKeyPem(), "tampered", sig), Is.False);
    }

    [Test]
    public void ExportPublicKeyPem_produz_SPKI_PEM_valido()
    {
        using var kp = Ed25519KeyPair.Generate();
        var pem = kp.ExportPublicKeyPem();
        Assert.That(pem, Does.Contain("-----BEGIN PUBLIC KEY-----"));
        Assert.That(pem, Does.Contain("-----END PUBLIC KEY-----"));
    }

    [Test]
    public void FromRawPrivateKey_reconstroi_a_mesma_identidade()
    {
        using var original = Ed25519KeyPair.Generate();
        var raw = original.ExportRawPrivateKey();
        Assert.That(raw, Has.Length.EqualTo(32));

        using var restored = Ed25519KeyPair.FromRawPrivateKey(raw);
        var payload = "same-identity";
        // Assinatura da chave restaurada verifica com a pública da original.
        Assert.That(VerifyWithPem(original.ExportPublicKeyPem(), payload, restored.SignBase64(payload)), Is.True);
    }

    // .NET 8 no Windows não expõe Ed25519 via System.Security.Cryptography
    // (spec seção 1, achado A6) — verifica via NSec (a lib usada em produção).
    // Ainda é um teste real: verificação é caminho independente da geração, e
    // a pública sai em SPKI PEM (mesmo formato que o BFF consome).
    private static bool VerifyWithPem(string publicKeyPem, string payload, string signatureBase64)
    {
        var algorithm = NSec.Cryptography.SignatureAlgorithm.Ed25519;
        var pubKey = NSec.Cryptography.PublicKey.Import(
            algorithm, Encoding.ASCII.GetBytes(publicKeyPem),
            NSec.Cryptography.KeyBlobFormat.PkixPublicKeyText);
        return algorithm.Verify(pubKey, Encoding.UTF8.GetBytes(payload), Convert.FromBase64String(signatureBase64));
    }
}

[TestFixture]
public class TemplateCipherTests
{
    private static readonly byte[] Key = new byte[32]; // zeros — determinístico pro teste

    [Test]
    public void Encrypt_decrypt_roundtrip_recupera_o_plaintext()
    {
        var plaintext = Encoding.UTF8.GetBytes("template-fir-texto");
        var blob = TemplateCipher.Encrypt(plaintext, Key);
        var recovered = TemplateCipher.Decrypt(blob, Key);
        Assert.That(recovered, Is.EqualTo(plaintext));
    }

    [Test]
    public void Layout_do_blob_e_nonce12_ciphertext_tag16()
    {
        var plaintext = Encoding.UTF8.GetBytes("abc");
        var blob = TemplateCipher.Encrypt(plaintext, Key);
        // 12 (nonce) + 3 (ciphertext, mesmo tamanho do plaintext no GCM) + 16 (tag)
        Assert.That(blob, Has.Length.EqualTo(12 + plaintext.Length + 16));
    }

    [Test]
    public void Cada_cifragem_usa_nonce_diferente()
    {
        var plaintext = Encoding.UTF8.GetBytes("mesmo-plaintext");
        var a = TemplateCipher.Encrypt(plaintext, Key);
        var b = TemplateCipher.Encrypt(plaintext, Key);
        // Nonces aleatórios ⇒ os 12 primeiros bytes diferem (com prob. ~1).
        Assert.That(a[..12], Is.Not.EqualTo(b[..12]));
        Assert.That(a, Is.Not.EqualTo(b));
    }

    [Test]
    public void Blob_adulterado_falha_a_autenticacao_do_GCM()
    {
        var blob = TemplateCipher.Encrypt(Encoding.UTF8.GetBytes("x"), Key);
        blob[^1] ^= 0xFF; // corrompe o tag
        Assert.Throws<System.Security.Cryptography.AuthenticationTagMismatchException>(
            () => TemplateCipher.Decrypt(blob, Key));
    }

    [Test]
    public void Chave_errada_nao_decifra()
    {
        var blob = TemplateCipher.Encrypt(Encoding.UTF8.GetBytes("x"), Key);
        var wrongKey = new byte[32];
        wrongKey[0] = 1;
        Assert.Throws<System.Security.Cryptography.AuthenticationTagMismatchException>(
            () => TemplateCipher.Decrypt(blob, wrongKey));
    }

    [Test]
    public void Blob_menor_que_o_minimo_e_rejeitado()
    {
        Assert.Throws<ArgumentException>(() => TemplateCipher.Decrypt(new byte[10], Key));
    }
}
