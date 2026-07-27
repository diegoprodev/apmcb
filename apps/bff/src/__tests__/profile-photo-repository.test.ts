import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createProfilePhotoDependencies } from "../repositories/profile-photo-repository.ts";

describe("profile photo repository", () => {
  it("pagina referências em ordem estável e encontra referência na fronteira", async () => {
    const rows = Array.from({ length: 1_001 }, (_, index) => ({
      id: String(index).padStart(4, "0"),
      foto_url:
        index === 1_000
          ? "shared/boundary.webp"
          : `profile/${index}.webp`,
    }));
    const calls: Array<{ from: number; to: number }> = [];
    let orderedBy: string | null = null;

    const client = {
      from() {
        return {
          select() {
            return {
              not() {
                return {
                  order(column: string) {
                    orderedBy = column;
                    return {
                      async range(from: number, to: number) {
                        calls.push({ from, to });
                        return { data: rows.slice(from, to + 1), error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
      storage: {
        from() {
          throw new Error("Storage não deve ser usado neste teste");
        },
      },
    } as unknown as SupabaseClient;

    const dependencies = createProfilePhotoDependencies(client, {
      supabaseUrl: "https://project-ref.supabase.co",
      warn: () => undefined,
    });

    const count =
      await dependencies.profiles.countNormalizedReferences(
        "shared/boundary.webp",
      );

    assert.equal(orderedBy, "id");
    assert.deepEqual(calls, [
      { from: 0, to: 999 },
      { from: 1_000, to: 1_999 },
    ]);
    assert.equal(count, 1);
  });
});
