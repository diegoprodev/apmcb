import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProfilePhotoVersionMismatch,
  clearProfilePhotoQueries,
  profilePhotoQueryKey,
  profilePhotoQueryOptions,
  synchronizeProfilePhotoAuthState,
} from "./profile-photo-query";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("profilePhotoQueryOptions", () => {
  it("deduplica consumidores e reutiliza a query fresca", async () => {
    const queryClient = new QueryClient();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          profileId: "profile-1",
          photoPath: "profile-1/photo.webp",
          signedUrl: "https://signed.example/photo",
          expiresAt: "2026-07-26T12:00:00.000Z",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const options = profilePhotoQueryOptions(
      queryClient,
      "profile-1",
      "profile-1/photo.webp",
    );

    const [first, second] = await Promise.all([
      queryClient.fetchQuery(options),
      queryClient.fetchQuery(options),
    ]);
    const third = await queryClient.fetchQuery(options);

    expect(first).toEqual(second);
    expect(third.signedUrl).toContain("signed.example");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("não armazena resposta B sob a key A e semeia a key B", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            profileId: "profile-1",
            photoPath: "profile-1/b.webp",
            signedUrl: "https://signed.example/b",
            expiresAt: "2026-07-26T12:00:00.000Z",
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      queryClient.fetchQuery(
        profilePhotoQueryOptions(
          queryClient,
          "profile-1",
          "profile-1/a.webp",
        ),
      ),
    ).rejects.toBeInstanceOf(ProfilePhotoVersionMismatch);

    expect(
      queryClient.getQueryData(
        profilePhotoQueryKey("profile-1", "profile-1/a.webp"),
      ),
    ).toBeUndefined();
    expect(
      queryClient.getQueryData<{
        signedUrl: string;
      }>(profilePhotoQueryKey("profile-1", "profile-1/b.webp"))?.signedUrl,
    ).toBe("https://signed.example/b");
  });

  it("limpa somente queries privadas de foto na troca de sessão", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      profilePhotoQueryKey("profile-1", "profile-1/a.webp"),
      { signedUrl: "private" },
    );
    queryClient.setQueryData(["dashboard"], { safe: true });

    clearProfilePhotoQueries(queryClient);

    expect(
      queryClient.getQueryData(
        profilePhotoQueryKey("profile-1", "profile-1/a.webp"),
      ),
    ).toBeUndefined();
    expect(queryClient.getQueryData(["dashboard"])).toEqual({ safe: true });
  });

  it("limpa foto em SIGNED_OUT mesmo quando o redirect for suprimido pela rota de auth", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      profilePhotoQueryKey("profile-a", "profile-a/a.webp"),
      { signedUrl: "private-a" },
    );

    const next = synchronizeProfilePhotoAuthState(queryClient, {
      event: "SIGNED_OUT",
      previousUserId: "profile-a",
      nextUserId: null,
    });

    expect(next).toBeNull();
    expect(
      queryClient.getQueryData(
        profilePhotoQueryKey("profile-a", "profile-a/a.webp"),
      ),
    ).toBeUndefined();
  });

  it("limpa em A→B e preserva no TOKEN_REFRESHED do mesmo usuário", () => {
    const queryClient = new QueryClient();
    const key = profilePhotoQueryKey("profile-a", "profile-a/a.webp");
    queryClient.setQueryData(key, { signedUrl: "private-a" });

    expect(
      synchronizeProfilePhotoAuthState(queryClient, {
        event: "TOKEN_REFRESHED",
        previousUserId: "profile-a",
        nextUserId: "profile-a",
      }),
    ).toBe("profile-a");
    expect(queryClient.getQueryData(key)).toBeDefined();

    expect(
      synchronizeProfilePhotoAuthState(queryClient, {
        event: "SIGNED_IN",
        previousUserId: "profile-a",
        nextUserId: "profile-b",
      }),
    ).toBe("profile-b");
    expect(queryClient.getQueryData(key)).toBeUndefined();
  });
});
