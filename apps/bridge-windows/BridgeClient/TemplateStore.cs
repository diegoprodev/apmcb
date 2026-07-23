using System.Security.Cryptography;
using System.Text;

namespace BridgeClient;

/// <summary>
/// Cache local dos templates sincronizados (/templates/sync, spec 2.5) +
/// cursor opaco. template_data já é ciphertext AES-256-GCM (cifrado com a
/// tenant key pelo bridge que cadastrou) — mas o arquivo inteiro é
/// DPAPI-protegido em repouso mesmo assim (defesa em profundidade: user_id é
/// PII, e evita que a lista de quem tem biometria cadastrada fique legível em
/// claro no disco). Ver KeyStore pro limite honesto do DPAPI sob auto-login.
///
/// Merge por (user_id, finger_index): sync incremental pode reenviar um
/// template atualizado — a versão mais recente (por updated_at do servidor,
/// carregado na ordem do cursor) substitui a anterior.
/// </summary>
public sealed class TemplateStore
{
    private readonly string _path;
    private readonly object _lock = new();
    private static readonly byte[] Entropy = "apmcb-bridge-template-store-v1"u8.ToArray();

    public TemplateStore(string? path = null)
    {
        _path = path ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "APMCB", "BridgeClient", "templates.dat");
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
    }

    public TemplateStoreState Load()
    {
        lock (_lock)
        {
            if (!File.Exists(_path)) return new TemplateStoreState(null, new List<SyncedTemplate>());
            try
            {
                var protectedBytes = File.ReadAllBytes(_path);
                var json = Encoding.UTF8.GetString(
                    ProtectedData.Unprotect(protectedBytes, Entropy, DataProtectionScope.CurrentUser));
                return BridgeJson.Deserialize<TemplateStoreState>(json);
            }
            catch
            {
                // Corrompido/ilegível — trata como vazio (re-sincroniza do zero).
                return new TemplateStoreState(null, new List<SyncedTemplate>());
            }
        }
    }

    public void Save(TemplateStoreState state)
    {
        lock (_lock)
        {
            var json = BridgeJson.Serialize(state);
            var protectedBytes = ProtectedData.Protect(
                Encoding.UTF8.GetBytes(json), Entropy, DataProtectionScope.CurrentUser);
            File.WriteAllBytes(_path, protectedBytes);
        }
    }

    /// <summary>
    /// Aplica uma página do sync ao estado atual: faz upsert por
    /// (user_id, finger_index) e avança o cursor. Retorna o novo estado.
    /// Pura (não toca disco) — o chamador decide quando persistir.
    /// </summary>
    public static TemplateStoreState Merge(
        TemplateStoreState current,
        IReadOnlyList<SyncedTemplate> page,
        string? nextCursor)
    {
        var byKey = current.Templates.ToDictionary(t => (t.UserId, t.FingerIndex));
        foreach (var t in page)
        {
            byKey[(t.UserId, t.FingerIndex)] = t;
        }
        return new TemplateStoreState(nextCursor, byKey.Values.ToList());
    }
}

public sealed record TemplateStoreState(
    string? Cursor,
    List<SyncedTemplate> Templates);
