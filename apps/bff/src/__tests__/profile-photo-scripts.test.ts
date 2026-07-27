import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseMigrationMode } from "../../scripts/migrate-active-profile-photos.ts";
import { listProfilePhotoSnapshots } from "../../scripts/profile-photo-script-support.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

describe("profile photo administrative scripts", () => {
  it("migração nasce em dry-run e exige confirmação dupla para apply", () => {
    assert.equal(parseMigrationMode([]), "dry-run");
    assert.throws(() => parseMigrationMode(["--apply"]));
    assert.throws(() =>
      parseMigrationMode([
        "--confirmation=APPLY-ACTIVE-PROFILE-PHOTO-MIGRATION",
      ]),
    );
    assert.equal(
      parseMigrationMode([
        "--apply",
        "--confirmation=APPLY-ACTIVE-PROFILE-PHOTO-MIGRATION",
      ]),
      "apply",
    );
  });

  it("relatório de órfãos não contém primitivas destrutivas", () => {
    const source = readFileSync(
      resolve(root, "apps/bff/scripts/report-profile-photo-orphans.ts"),
      "utf8",
    );
    assert.equal(source.includes(".remove("), false);
    assert.equal(source.includes(".update("), false);
    assert.equal(source.includes('method: "DELETE"'), false);
    assert.equal(source.includes("--delete"), false);
  });

  it("inventaria todos os perfis em páginas ordenadas", async () => {
    const rows = Array.from({ length: 1_001 }, (_, index) => ({
      id: String(index).padStart(4, "0"),
      foto_url: `profile/${index}.webp`,
    }));
    const ranges: Array<[number, number]> = [];
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
                        ranges.push([from, to]);
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
    } as unknown as SupabaseClient;

    const snapshots = await listProfilePhotoSnapshots(client);

    assert.equal(orderedBy, "id");
    assert.equal(snapshots.length, 1_001);
    assert.deepEqual(ranges, [
      [0, 999],
      [1_000, 1_999],
    ]);
  });

  it("amarra o apply ao valor bruto inventariado e reutiliza o processamento", () => {
    const source = readFileSync(
      resolve(root, "apps/bff/scripts/migrate-active-profile-photos.ts"),
      "utf8",
    );
    assert.match(
      source,
      /expectedOldPhotoReferenceRaw:\s*profile\.foto_url/,
    );
    assert.match(source, /dependencies\.process\s*=\s*async \(\) => processed/);
  });
});
