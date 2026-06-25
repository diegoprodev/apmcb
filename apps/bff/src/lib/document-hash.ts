import { createHash } from "crypto";

interface DocumentContent {
  document_type: string;
  document_id: string;
  data: Record<string, unknown>;
}

export function hashDocument(content: DocumentContent): string {
  const sortedKeys = Object.keys(content).sort();
  const sorted = JSON.stringify(content, sortedKeys);
  return createHash("sha256").update(sorted, "utf8").digest("hex");
}
