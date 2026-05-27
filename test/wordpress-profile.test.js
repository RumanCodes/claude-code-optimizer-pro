import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { analyzeRepository } from "../lib/analyze.js";
import { init } from "../lib/init.js";

async function makeWordPressPluginFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cco-wp-"));
  await fs.writeJson(path.join(dir, "composer.json"), {
    name: "vendor/example-plugin",
    type: "wordpress-plugin",
    autoload: {
      "psr-4": {
        "ExamplePlugin\\": "app/",
      },
    },
  });
  await fs.writeJson(path.join(dir, "package.json"), {
    scripts: {
      dev: "vite",
      build: "vite build",
    },
    dependencies: {
      vue: "latest",
    },
    devDependencies: {
      vite: "latest",
      "@vitejs/plugin-vue": "latest",
    },
  });
  await fs.outputFile(path.join(dir, "example-plugin.php"), `<?php
/**
 * Plugin Name: Example Payments
 * Description: Payment reports for WordPress.
 * Version: 1.2.3
 * Requires PHP: 8.0
 * Text Domain: example-payments
 */
require_once __DIR__ . '/vendor/autoload.php';
new ExamplePlugin\\App();
`);
  await fs.outputFile(path.join(dir, "app/App.php"), `<?php
namespace ExamplePlugin;
class App {
  public function __construct() {
    add_action('init', [$this, 'init']);
  }
  public function init() {}
}
`);
  await fs.outputFile(path.join(dir, "app/Http/Controllers/PaymentsController.php"), `<?php
namespace ExamplePlugin\\Http\\Controllers;
class PaymentsController {
  public function __construct() {
    add_action('wp_ajax_ep_get_reports', [$this, 'getReports']);
  }
  public function getReports() {
    check_ajax_referer('ep_nonce', 'nonce');
    if (!current_user_can('manage_options')) { wp_send_json_error(); }
    $rows = wpFluent()->table('fluentform_transactions')->get();
    wp_send_json_success($rows);
  }
}
`);
  await fs.outputFile(path.join(dir, "app/Models/Reports.php"), `<?php
namespace ExamplePlugin\\Models;
class Reports {
  public function totals() {
    return wpFluent()->table('fluentform_transactions')->select([wpFluent()->raw('SUM(payment_total) as total')])->first();
  }
}
`);
  await fs.outputFile(path.join(dir, "resources/js/AdminApp.vue"), `<template><div /></template>
<script setup>
import { ref } from 'vue';
const nonce = window.ExampleSettings?.nonce;
</script>
`);
  await fs.outputFile(path.join(dir, "vite.config.js"), "export default { root: 'resources' };\n");
  return dir;
}

test("wordpress plugin profile detects PHP, hooks, nonce, composer, and Vue", async () => {
  const dir = await makeWordPressPluginFixture();
  try {
    const analysis = await analyzeRepository(dir, { maxFiles: 200, sampleFiles: 80 });
    assert.equal(analysis.profile, "wordpress-plugin");
    assert.equal(analysis.project.language, "php");
    assert.equal(analysis.project.packageManager, "composer+npm");
    assert.equal(analysis.context.project.name, "Example Payments");
    assert.equal(analysis.patterns.wordpress.namespace, "ExamplePlugin");
    assert.equal(analysis.patterns.wordpress.nonce, "ep_nonce");
    assert.equal(analysis.patterns.wordpress.capabilities.includes("manage_options"), true);
    assert.equal(analysis.patterns.wordpress.tables.includes("fluentform_transactions"), true);
    assert.equal(analysis.patterns.vue.components.includes("AdminApp"), true);
  } finally {
    await fs.remove(dir);
  }
});

test("init --analyze writes WordPress context files and commands", async () => {
  const dir = await makeWordPressPluginFixture();
  const originalCwd = process.cwd();
  try {
    process.chdir(dir);
    await init({ analyze: true, quiet: true, force: false });
    const claude = await fs.readFile(path.join(dir, "CLAUDE.md"), "utf8");
    assert.equal(claude.includes("Project type: wordpress-plugin"), true);
    assert.equal(claude.includes("PHP namespace: ExamplePlugin"), true);
    assert.equal(await fs.pathExists(path.join(dir, ".claude/context-map.md")), true);
    assert.equal(await fs.pathExists(path.join(dir, ".claude/summaries/backend.md")), true);
    assert.equal(await fs.pathExists(path.join(dir, ".claude/context-gaps.json")), true);
    assert.equal(await fs.pathExists(path.join(dir, ".claude/commands/wordpress-rules.md")), true);
    assert.equal(await fs.pathExists(path.join(dir, ".claude/commands/ajax-rules.md")), true);
    assert.equal(await fs.pathExists(path.join(dir, ".claude/commands/vue-dashboard-rules.md")), true);
  } finally {
    process.chdir(originalCwd);
    await fs.remove(dir);
  }
});
