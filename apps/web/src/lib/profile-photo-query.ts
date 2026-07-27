"use client";

import {
  queryOptions,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const BFF_URL =
  process.env.NEXT_PUBLIC_BFF_URL ?? "https://api.apmcb.pmpb.online";

export type ProfilePhotoUrlResponse = {
  profileId: string;
  photoPath: string | null;
  signedUrl: string | null;
  expiresAt: string | null;
};

export class ProfilePhotoVersionMismatch extends Error {
  readonly code = "PROFILE_PHOTO_VERSION_MISMATCH";

  constructor() {
    super("A versão da foto mudou");
    this.name = "ProfilePhotoVersionMismatch";
  }
}

export function profilePhotoQueryKey(
  profileId: string,
  photoPath: string | null,
) {
  return ["profile-photo-url", profileId, photoPath] as const;
}

function normalizedLegacyPhotoPath(reference: string) {
  try {
    const pathname = new URL(reference).pathname;
    const markers = [
      "/storage/v1/object/public/profile-photos/",
      "/storage/v1/object/sign/profile-photos/",
    ];
    const marker = markers.find((candidate) => pathname.startsWith(candidate));
    return marker ? decodeURIComponent(pathname.slice(marker.length)) : reference;
  } catch {
    return reference;
  }
}

export function setCanonicalProfilePhotoResponse(
  queryClient: QueryClient,
  expectedPhotoPath: string,
  response: ProfilePhotoUrlResponse,
) {
  if (response.photoPath !== normalizedLegacyPhotoPath(expectedPhotoPath)) {
    queryClient.setQueryData(
      profilePhotoQueryKey(response.profileId, response.photoPath),
      response,
    );
    throw new ProfilePhotoVersionMismatch();
  }
  return response;
}

export function profilePhotoQueryOptions(
  queryClient: QueryClient,
  profileId: string,
  photoPath: string | null,
) {
  return queryOptions({
    queryKey: profilePhotoQueryKey(profileId, photoPath),
    enabled: Boolean(profileId && photoPath),
    queryFn: async () => {
      const response = await fetch(
        `${BFF_URL}/api/profiles/${encodeURIComponent(profileId)}/photo-url`,
        {
          credentials: "include",
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error("PROFILE_PHOTO_URL_FAILED");
      const payload = (await response.json()) as ProfilePhotoUrlResponse;
      return setCanonicalProfilePhotoResponse(
        queryClient,
        photoPath as string,
        payload,
      );
    },
    staleTime: 50 * 60 * 1_000,
    gcTime: 60 * 60 * 1_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: true,
    refetchInterval: false,
    retry: (failureCount, error) =>
      !(error instanceof ProfilePhotoVersionMismatch) && failureCount < 1,
  });
}

export function useProfilePhotoUrl(
  profileId: string,
  photoPath: string | null,
) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const refreshedMismatch = useRef<string | null>(null);
  const query = useQuery(
    profilePhotoQueryOptions(queryClient, profileId, photoPath),
  );

  useEffect(() => {
    if (
      query.error instanceof ProfilePhotoVersionMismatch &&
      refreshedMismatch.current !== photoPath
    ) {
      refreshedMismatch.current = photoPath;
      router.refresh();
    }
  }, [photoPath, query.error, router]);

  return query;
}

export function clearProfilePhotoQueries(queryClient: QueryClient) {
  return queryClient.removeQueries({
    queryKey: ["profile-photo-url"],
  });
}

export function synchronizeProfilePhotoAuthState(
  queryClient: QueryClient,
  transition: {
    event: string;
    previousUserId: string | null;
    nextUserId: string | null;
  },
) {
  if (
    transition.event === "SIGNED_OUT" ||
    (
      transition.previousUserId !== null &&
      transition.nextUserId !== null &&
      transition.previousUserId !== transition.nextUserId
    )
  ) {
    clearProfilePhotoQueries(queryClient);
  }

  return transition.nextUserId;
}
