import fs from "fs";
import path from "path";

/**
 * Limpa test-results antes de cada run para evitar ENOTEMPTY.
 * Playwright tenta rmdir() o diretório inteiro; se não estiver vazio, crasha.
 * Este setup garante que o diretório exista mas esteja vazio.
 */
export default async function globalSetup() {
  const dir = path.join(process.cwd(), "test-results");
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}
