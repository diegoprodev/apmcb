namespace BridgeClient;

/// <summary>
/// Sincronização incremental de templates (spec 2.5). Pagina do cursor
/// armazenado até next_cursor == null, faz merge no TemplateStore e persiste.
/// Cursor é OPACO — nunca interpretado, só reenviado. Roda em background
/// (não bloqueia identify/enroll) a cada TemplateSyncIntervalMinutes +
/// imediatamente após reconectar. Idempotente: se cair no meio, o cursor
/// persistido só avança por página completa aplicada.
/// </summary>
public sealed class TemplateSyncService
{
    private readonly BridgeProtocolClient _client;
    private readonly TemplateStore _store;
    private readonly BridgeLogger _log;

    // MÉDIO de code review (2026-07-23): escrito no loop de background
    // (SyncAsync), lido de outra thread via candidateProvider (ChallengePoller
    // → BiometricProcessor). Reatribuição de referência já é atômica em .NET,
    // mas volatile garante visibilidade formal entre threads sem depender de
    // barreiras de memória implícitas não garantidas pela linguagem.
    private volatile TemplateStoreState _current = new(null, new List<SyncedTemplate>());

    public TemplateSyncService(BridgeProtocolClient client, TemplateStore store, BridgeLogger log)
    {
        _client = client;
        _store = store;
        _log = log;
    }

    /// <summary>Estado em memória — o orquestrador usa pra matching 1:N sem reler disco.</summary>
    public TemplateStoreState Current => _current;

    public void LoadFromDisk() => _current = _store.Load();

    /// <summary>
    /// Uma passada completa: pagina até esgotar. Persiste a cada página
    /// aplicada (não só no fim) — assim uma queda no meio não perde o
    /// progresso já sincronizado nem reprocessa páginas confirmadas.
    /// Retorna quantos templates existem no total após a sincronização.
    /// </summary>
    public async Task<int> SyncAsync(CancellationToken ct = default)
    {
        var state = Current;
        var pages = 0;
        while (!ct.IsCancellationRequested)
        {
            var page = await _client.SyncTemplatesAsync(state.Cursor, ct);
            state = TemplateStore.Merge(state, page.Templates, page.NextCursor);
            _store.Save(state);
            _current = state;
            pages++;

            if (string.IsNullOrEmpty(page.NextCursor))
            {
                break;
            }
        }
        _log.Info($"sync: {pages} página(s), {state.Templates.Count} template(s) em cache");
        return state.Templates.Count;
    }

    public async Task RunAsync(int intervalMinutes, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await SyncAsync(ct);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                _log.Warn($"sync falhou (tenta de novo no próximo ciclo): {ex.GetType().Name}");
            }

            try
            {
                await Task.Delay(TimeSpan.FromMinutes(intervalMinutes), ct);
            }
            catch (OperationCanceledException) { break; }
        }
    }
}
