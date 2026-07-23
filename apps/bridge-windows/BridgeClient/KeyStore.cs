using System.Security.Cryptography;

namespace BridgeClient;

/// <summary>
/// Persistência local cifrada via DPAPI (CurrentUser) — chave privada
/// Ed25519 do device pareado + chave AES-256-GCM derivada do tenant
/// (cache de /tenant-key). Nunca grava nada em texto claro no disco.
///
/// LIMITE REAL DESTA PROTEÇÃO (honesto, documentado na spec Fase 1C,
/// seção 3.2/4 — achado ALTO da 4ª rodada de revisão): esta app exige
/// auto-login do Windows (ver runbook de instalação) pra ficar disponível
/// sem intervenção humana após reboot. Auto-login + DPAPI CurrentUser
/// significa que um PC roubado — mesmo desligado no momento do furto —
/// liga direto na sessão já autenticada, e qualquer processo ali chama a
/// mesma API de DPAPI que esta classe usa, sem precisar de senha nenhuma.
/// DPAPI aqui NÃO é proteção real contra furto do dispositivo inteiro — só
/// contra uma cópia isolada do arquivo (ex: disco exfiltrado remotamente,
/// sem a sessão viva junto). A proteção real contra furto físico é
/// REVOGAÇÃO IMEDIATA do device (ver runbook operacional) — não esta
/// classe.
/// </summary>
public sealed class KeyStore
{
    private readonly string _dataDir;

    public KeyStore(string? dataDir = null)
    {
        _dataDir = dataDir ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "APMCB", "BridgeClient");
        Directory.CreateDirectory(_dataDir);
    }

    private string DeviceKeyPath => Path.Combine(_dataDir, "device.key");
    private string DeviceIdPath => Path.Combine(_dataDir, "device.id");
    private string ReserveIdPath => Path.Combine(_dataDir, "reserve.id");
    private string TenantKeyPath => Path.Combine(_dataDir, "tenant.key");
    private string TenantKeyFetchedAtPath => Path.Combine(_dataDir, "tenant.key.fetched_at");

    // Entropia adicional fixa — não é segredo (não protege contra o cenário
    // de auto-login descrito acima, que já tem acesso à API de DPAPI em
    // si), só evita que outro processo qualquer na mesma sessão do usuário
    // descriptografe o blob "por acidente" chamando DPAPI sem saber o
    // propósito. Ver comentário da classe: a garantia real é revogação, não isto.
    private static readonly byte[] Entropy = "apmcb-bridge-client-v1"u8.ToArray();

    public bool HasPairedDevice => File.Exists(DeviceKeyPath) && File.Exists(DeviceIdPath) && File.Exists(ReserveIdPath);

    public void SavePairedDevice(string deviceId, string reserveId, byte[] rawPrivateKey)
    {
        var protectedKey = ProtectedData.Protect(rawPrivateKey, Entropy, DataProtectionScope.CurrentUser);
        File.WriteAllBytes(DeviceKeyPath, protectedKey);
        File.WriteAllText(DeviceIdPath, deviceId);
        File.WriteAllText(ReserveIdPath, reserveId);
    }

    public (string DeviceId, string ReserveId, Ed25519KeyPair KeyPair)? LoadPairedDevice()
    {
        if (!HasPairedDevice) return null;
        var deviceId = File.ReadAllText(DeviceIdPath).Trim();
        var reserveId = File.ReadAllText(ReserveIdPath).Trim();
        var protectedKey = File.ReadAllBytes(DeviceKeyPath);
        var rawKey = ProtectedData.Unprotect(protectedKey, Entropy, DataProtectionScope.CurrentUser);
        return (deviceId, reserveId, Ed25519KeyPair.FromRawPrivateKey(rawKey));
    }

    public void ClearPairedDevice()
    {
        if (File.Exists(DeviceKeyPath)) File.Delete(DeviceKeyPath);
        if (File.Exists(DeviceIdPath)) File.Delete(DeviceIdPath);
        if (File.Exists(ReserveIdPath)) File.Delete(ReserveIdPath);
    }

    public void SaveTenantKey(byte[] rawKey32Bytes)
    {
        var protectedKey = ProtectedData.Protect(rawKey32Bytes, Entropy, DataProtectionScope.CurrentUser);
        File.WriteAllBytes(TenantKeyPath, protectedKey);
        File.WriteAllText(TenantKeyFetchedAtPath, DateTimeOffset.UtcNow.ToString("O"));
    }

    public byte[]? LoadTenantKey()
    {
        if (!File.Exists(TenantKeyPath)) return null;
        var protectedKey = File.ReadAllBytes(TenantKeyPath);
        return ProtectedData.Unprotect(protectedKey, Entropy, DataProtectionScope.CurrentUser);
    }

    /// <summary>
    /// True quando o cache local não existe, corrompeu, ou passou do
    /// intervalo de refresh (BIOMETRIC_TENANT_KEY_REFRESH_DAYS, default 7
    /// — spec Fase 1C, seção 3.2, achado B1) — sinal pro bridge rebuscar
    /// via GET /tenant-key.
    /// </summary>
    public bool TenantKeyNeedsRefresh(int refreshDays)
    {
        if (!File.Exists(TenantKeyPath) || !File.Exists(TenantKeyFetchedAtPath)) return true;
        if (!DateTimeOffset.TryParse(File.ReadAllText(TenantKeyFetchedAtPath), out var fetchedAt)) return true;
        return DateTimeOffset.UtcNow - fetchedAt > TimeSpan.FromDays(refreshDays);
    }
}
