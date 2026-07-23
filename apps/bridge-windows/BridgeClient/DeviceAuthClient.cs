using System.Security.Cryptography;
using System.Text;

namespace BridgeClient;

/// <summary>
/// HttpClient autenticado do device — assina cada request com
/// DeviceAuthCanonicalizer + Ed25519KeyPair e anexa os 4 headers
/// (X-Bridge-Device-Id, X-Bridge-Timestamp, X-Bridge-Nonce,
/// X-Bridge-Signature). Certificate pinning via CertificatePinning
/// (compartilhado — spec Fase 1C, seção 3.2, achado A3).
/// </summary>
public sealed class DeviceAuthClient : IDisposable
{
    private readonly HttpClient _http;
    private readonly string _baseUrl;
    private readonly string _deviceId;
    private readonly Ed25519KeyPair _keyPair;

    public DeviceAuthClient(string baseUrl, string deviceId, Ed25519KeyPair keyPair)
        : this(baseUrl, deviceId, keyPair, CertificatePinning.CreateHandler())
    {
    }

    /// <summary>
    /// Injeta um HttpMessageHandler custom — usado nos testes pra plugar um
    /// handler fake (sem rede real nem cert pinning), mesma superfície que
    /// os testes do BFF usam. Em produção, sempre o handler com cert pinning
    /// (construtor público de 3 args).
    /// </summary>
    public DeviceAuthClient(string baseUrl, string deviceId, Ed25519KeyPair keyPair, HttpMessageHandler handler)
    {
        _baseUrl = baseUrl.TrimEnd('/');
        _deviceId = deviceId;
        _keyPair = keyPair;
        _http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(15) };
    }

    public async Task<BridgeResponse> SendAsync(HttpMethod method, string pathWithQuery, string? jsonBody = null, CancellationToken ct = default)
    {
        var bodyUtf8 = jsonBody ?? "";
        var timestamp = DateTimeOffset.UtcNow.ToString("O");
        var nonce = Convert.ToBase64String(RandomNumberGenerator.GetBytes(16))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');

        var canonicalInput = new CanonicalRequestInput(
            method.Method, pathWithQuery, bodyUtf8, timestamp, nonce, _deviceId);
        var signature = _keyPair.SignBase64(DeviceAuthCanonicalizer.Canonicalize(canonicalInput));

        using var request = new HttpRequestMessage(method, _baseUrl + pathWithQuery);
        request.Headers.Add("X-Bridge-Device-Id", _deviceId);
        request.Headers.Add("X-Bridge-Timestamp", timestamp);
        request.Headers.Add("X-Bridge-Nonce", nonce);
        request.Headers.Add("X-Bridge-Signature", signature);
        if (jsonBody is not null)
        {
            request.Content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
        }

        using var response = await _http.SendAsync(request, ct);
        var responseBody = await response.Content.ReadAsStringAsync(ct);
        return new BridgeResponse((int)response.StatusCode, responseBody);
    }

    public void Dispose() => _http.Dispose();
}

public sealed record BridgeResponse(int StatusCode, string Body)
{
    public bool Ok => StatusCode is >= 200 and < 300;
}
