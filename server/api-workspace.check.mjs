import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  mkdir,
  rmdir,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createApiWorkspace } from "./api-workspace.mjs";
import { initialApiState, newApiEndpoint } from "../shared/api-workspace.mjs";
async function temporary(work) {
  const folder = await mkdtemp(path.join(tmpdir(), "devkit-api-"));
  try {
    await work(folder);
  } finally {
    assert.equal(path.dirname(path.resolve(folder)), path.resolve(tmpdir()));
    assert.ok(path.basename(folder).startsWith("devkit-api-"));
    await rm(folder, { recursive: true, force: true });
  }
}
const fixture = () => ({
  ...initialApiState(),
  projects: [
    {
      id: "project",
      name: "接口项目",
      description: "",
      baseUrl: "http://localhost:9000",
      groups: [],
      environments: [],
      endpoints: [newApiEndpoint("endpoint")],
    },
  ],
});
test("API files serialize saves, reject stale revisions, preserve snapshots and survive reopen", () =>
  temporary(async (folder) => {
    let store = await createApiWorkspace(folder);
    const initial = await store.get();
    assert.equal(initial.canRestore, false);
    const results = await Promise.allSettled([
      store.save(fixture(), 0),
      store.save(initialApiState(), 0),
    ]);
    assert.equal(
      results.filter((item) => item.status === "fulfilled").length,
      1,
    );
    assert.match(
      results.find((item) => item.status === "rejected").reason.message,
      /已被更新/,
    );
    const state = (await store.get()).state;
    state.projects[0].name = "outside";
    assert.equal((await store.get()).state.projects[0].name, "接口项目");
    const result = await store.restore(1);
    assert.equal(result.state.projects.length, 0);
    assert.equal(result.state.revision, 2);
    await store.close();
    store = await createApiWorkspace(folder);
    assert.equal((await store.get()).canRestore, true);
    assert.equal((await store.restore(2)).state.projects.length, 1);
    await store.close();
  }));
test("bad data is preserved, invalid writes do not commit and a second process cannot open the folder", () =>
  temporary(async (folder) => {
    const store = await createApiWorkspace(folder);
    await assert.rejects(createApiWorkspace(folder), /正在/);
    await assert.rejects(store.save({ ...fixture(), revision: -1 }, 0));
    assert.equal((await store.get()).state.revision, 0);
    await store.close();
    const file = path.join(folder, "http/api-workspace.json");
    await writeFile(file, "{broken");
    await assert.rejects(createApiWorkspace(folder), /原文件已保留/);
    assert.equal(await readFile(file, "utf8"), "{broken");
  }));
test("failed atomic writes keep the prior in-memory state and can be retried", () =>
  temporary(async (folder) => {
    const store = await createApiWorkspace(folder);
    const file = path.join(folder, "http/api-workspace.json");
    await rm(file);
    await mkdir(file);
    await assert.rejects(store.save(fixture(), 0));
    assert.equal((await store.get()).state.revision, 0);
    await rmdir(file);
    assert.equal((await store.save(fixture(), 0)).state.revision, 1);
    await store.close();
    assert.equal(
      JSON.parse(await readFile(file, "utf8")).current.projects.length,
      1,
    );
  }));
