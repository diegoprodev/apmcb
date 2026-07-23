using System.Net;
using BridgeClient;

namespace BridgeClient.Tests;

/// <summary>
/// HttpMessageHandler fake — captura os requests e responde com o que a fila
/// de respostas mandar. Permite testar toda a camada de protocolo/serviços
/// sem rede real nem cert pinning (mesma filosofia dos testes com
/// HttpMessageHandler fake citada na spec 8.1).
/// </summary>
public sealed class FakeHttpMessageHandler : HttpMessageHandler
{
    private readonly Queue<Func<HttpRequestMessage, (HttpStatusCode, string)>> _responders = new();
    public List<CapturedRequest> Requests { get; } = new();

    public void Enqueue(HttpStatusCode status, string body) =>
        _responders.Enqueue(_ => (status, body));

    public void Enqueue(Func<HttpRequestMessage, (HttpStatusCode, string)> responder) =>
        _responders.Enqueue(responder);

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
        Requests.Add(new CapturedRequest(
            request.Method.Method,
            request.RequestUri!.PathAndQuery,
            request.Headers.ToDictionary(h => h.Key, h => string.Join(",", h.Value)),
            body));

        if (_responders.Count == 0)
        {
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{}") };
        }
        var (status, respBody) = _responders.Dequeue()(request);
        return new HttpResponseMessage(status) { Content = new StringContent(respBody) };
    }
}

public sealed record CapturedRequest(string Method, string PathAndQuery, Dictionary<string, string> Headers, string Body);
