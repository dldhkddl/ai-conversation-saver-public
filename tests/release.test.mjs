import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("release main.js loads without local runtime modules", async () => {
  const source = await readFile(
    new URL("../release/ai-conversation-saver/main.js", import.meta.url),
    "utf8"
  );
  const module = { exports: {} };
  const obsidian = {
    Plugin: class {},
    Modal: class {},
    PluginSettingTab: class {},
    Notice: class {},
    Setting: class {},
    TFile: class {}
  };

  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require(specifier) {
      if (specifier === "obsidian") return obsidian;
      throw new Error(`release requested unavailable module: ${specifier}`);
    }
  });

  assert.equal(typeof module.exports.default, "function");
});

test("release CSS styles every custom class used by the recommendation card", async () => {
  const main = await readFile(
    new URL("../release/ai-conversation-saver/main.js", import.meta.url),
    "utf8"
  );
  const styles = await readFile(
    new URL("../release/ai-conversation-saver/styles.css", import.meta.url),
    "utf8"
  );

  assert.match(main, /ai-recommender-execution-mode/);
  assert.match(styles, /\.ai-recommender-execution-mode\s*\{/);
});
