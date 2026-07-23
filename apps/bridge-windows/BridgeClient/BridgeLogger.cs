namespace BridgeClient;

/// <summary>
/// Log local mínimo em arquivo — NUNCA loga PII biométrica (template, FIR,
/// nome, matrícula) nem segredo (chave privada, tenant key). Só eventos
/// operacionais: pareamento, heartbeat ok/falho, challenge recebido/processado
/// (só o id + purpose), erros de protocolo. Rotação simples por tamanho.
/// </summary>
public sealed class BridgeLogger
{
    private readonly string _path;
    private readonly object _lock = new();
    private const long MaxBytes = 2 * 1024 * 1024;

    public BridgeLogger(string? path = null)
    {
        _path = path ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "APMCB", "BridgeClient", "bridge.log");
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
    }

    public void Info(string message) => Write("INFO", message);
    public void Warn(string message) => Write("WARN", message);
    public void Error(string message) => Write("ERROR", message);

    private void Write(string level, string message)
    {
        var line = $"{DateTimeOffset.UtcNow:O} [{level}] {message}";
        lock (_lock)
        {
            try
            {
                if (File.Exists(_path) && new FileInfo(_path).Length > MaxBytes)
                {
                    var old = _path + ".1";
                    if (File.Exists(old)) File.Delete(old);
                    File.Move(_path, old);
                }
                File.AppendAllText(_path, line + Environment.NewLine);
            }
            catch
            {
                // Log é best-effort — nunca derruba o bridge por falha de I/O de log.
            }
        }
    }
}
