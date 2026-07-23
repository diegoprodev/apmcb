using BridgeClient;

namespace BridgeClient.Tests;

public static class TestData
{
    public static Challenge Challenge(
        string purpose = "identify",
        string? expectedUserId = null,
        string id = "chal-1") => new(
        Id: id,
        TenantId: "tenant-1",
        ReserveId: "reserve-1",
        ActorId: "actor-1",
        Purpose: purpose,
        ExpectedUserId: expectedUserId,
        DocumentType: null,
        DocumentId: null,
        DocumentHash: null,
        ExpiresAt: DateTimeOffset.UtcNow.AddMinutes(2).ToString("O"));

    public static SyncedTemplate Template(string userId, int finger, string encryptedBase64) => new(
        UserId: userId,
        FingerIndex: finger,
        TemplateData: encryptedBase64,
        TemplateHash: "sha256:deadbeef",
        Format: "eNBSP",
        SdkVersion: "eNBSP",
        Quality: 90,
        UpdatedAt: DateTimeOffset.UtcNow.ToString("O"));
}
