using System.Text;
using BridgeClient;

namespace BridgeClient.Tests;

/// <summary>
/// Garante que os canonicalizadores C# batem BYTE A BYTE com o BFF
/// (apps/bff/src/lib/biometric-device-auth.ts e biometric-proof.ts) —
/// qualquer divergência quebra TODA autenticação/assinatura do bridge.
/// </summary>
[TestFixture]
public class DeviceAuthCanonicalizerTests
{
    [Test]
    public void Canonical_request_junta_6_campos_com_newline_na_ordem_do_contrato()
    {
        var input = new CanonicalRequestInput(
            Method: "get",
            PathWithQuery: "/api/biometric-bridge/challenges/next?reserve_id=abc",
            BodyUtf8: "",
            Timestamp: "2026-07-22T00:00:00.000Z",
            Nonce: "nonce-1",
            DeviceId: "44444444-4444-4444-8444-444444444444");

        var canonical = DeviceAuthCanonicalizer.Canonicalize(input);
        var lines = canonical.Split('\n');

        Assert.That(lines, Has.Length.EqualTo(6));
        Assert.That(lines[0], Is.EqualTo("GET"), "método deve ser maiúsculo");
        Assert.That(lines[1], Is.EqualTo("/api/biometric-bridge/challenges/next?reserve_id=abc"));
        // sha256("") canônico
        Assert.That(lines[2], Is.EqualTo("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));
        Assert.That(lines[3], Is.EqualTo("2026-07-22T00:00:00.000Z"));
        Assert.That(lines[4], Is.EqualTo("nonce-1"));
        Assert.That(lines[5], Is.EqualTo("44444444-4444-4444-8444-444444444444"));
    }

    [Test]
    public void Body_diferente_muda_o_hash()
    {
        var a = DeviceAuthCanonicalizer.Canonicalize(Input(body: "{\"a\":1}"));
        var b = DeviceAuthCanonicalizer.Canonicalize(Input(body: "{\"a\":2}"));
        Assert.That(a, Is.Not.EqualTo(b));
    }

    private static CanonicalRequestInput Input(string body) => new(
        "POST", "/api/biometric-bridge/heartbeat", body,
        "2026-07-22T00:00:00.000Z", "n", "dev");
}

[TestFixture]
public class BiometricPayloadCanonicalizerTests
{
    [Test]
    public void Ordena_chaves_alfabeticamente_e_inclui_null_explicito()
    {
        var payload = new Dictionary<string, object?>
        {
            ["b"] = "second",
            ["a"] = "first",
            ["c"] = null,
        };
        var json = BiometricPayloadCanonicalizer.Canonicalize(payload);
        Assert.That(json, Is.EqualTo("{\"a\":\"first\",\"b\":\"second\",\"c\":null}"));
    }

    [Test]
    public void Double_inteiro_serializa_sem_fracao_como_o_JSON_stringify_do_JS()
    {
        // match_score 1.0 no JS vira "1", não "1.0".
        var payload = new Dictionary<string, object?> { ["match_score"] = 1.0 };
        Assert.That(BiometricPayloadCanonicalizer.Canonicalize(payload), Is.EqualTo("{\"match_score\":1}"));
    }

    [Test]
    public void Bool_e_int_serializam_como_o_JS()
    {
        var payload = new Dictionary<string, object?>
        {
            ["flag"] = true,
            ["off"] = false,
            ["n"] = 42,
        };
        Assert.That(BiometricPayloadCanonicalizer.Canonicalize(payload),
            Is.EqualTo("{\"flag\":true,\"n\":42,\"off\":false}"));
    }

    [Test]
    public void Escapa_apenas_o_que_o_JSON_stringify_do_JS_escapa()
    {
        // & < > NÃO são escapados por JSON.stringify (o encoder padrão do
        // System.Text.Json escaparia — por isso o canonicalizador é à mão).
        var payload = new Dictionary<string, object?> { ["x"] = "a&b<c>d\"e\\f" };
        Assert.That(BiometricPayloadCanonicalizer.Canonicalize(payload),
            Is.EqualTo("{\"x\":\"a&b<c>d\\\"e\\\\f\"}"));
    }

    [Test]
    public void Proof_completo_canoniza_ordenado_com_16_chaves()
    {
        var challenge = TestData.Challenge(purpose: "identify");
        var proof = ProofPayload.Build(
            challenge, "dev-1", matchedUserId: "user-9", matchScore: 1.0,
            fingerIndex: 2, livenessPassed: null, sdkVersion: "eNBSP",
            bridgeVersion: "1.0.0", timestampIso: "2026-07-22T00:00:00.000Z");

        var json = BiometricPayloadCanonicalizer.Canonicalize(proof);
        // Primeira chave ordenada é actor_id; confirma ordenação alfabética.
        Assert.That(json, Does.StartWith("{\"actor_id\":"));
        Assert.That(proof, Has.Count.EqualTo(16));
        Assert.That(json, Does.Contain("\"match_score\":1"));
        Assert.That(json, Does.Contain("\"liveness_passed\":null"));
    }
}
