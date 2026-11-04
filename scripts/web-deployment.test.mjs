import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { parseOptions, WebDeployment } from "./lib/web-deployment.mjs";

const FILES_LABEL = "com.docker.compose.project.config_files";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "web deployment "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ["compose.yml", "compose.override.yml", "extra.yml"]) {
    writeFileSync(join(root, name), "services: {}\n");
  }
  const options = { root, action: "up", "project-name": "existing-web", file: [] };
  const state = {
    options, commands: [],
    config: {
      services: { web: { image: "web:verified", networks: { kong: { aliases: ["codex-switch-web"] } } } },
      networks: { kong: { name: "existing-gateway", external: true } },
    },
    current: {
      Config: { Labels: {} }, Image: "sha256:verified",
      State: { Running: true, Health: { Status: "healthy" } },
      NetworkSettings: { Networks: { "existing-gateway": { Aliases: ["codex-switch-web"] } } },
    },
    run(arguments_) {
      state.commands.push(arguments_);
      if (arguments_[0] === "ps") return state.current ? "container-id" : "";
      if (arguments_[0] === "inspect") return JSON.stringify([state.current]);
      if (arguments_[0] === "image") return "sha256:verified";
      if (arguments_.includes("config")) return JSON.stringify(state.config);
      if (arguments_.includes("up")) return "";
      throw new Error(`Unexpected command: ${arguments_[0]}`);
    },
  };
  state.create = () => new WebDeployment(options, state.run);
  return state;
}

test("requires an explicit Web project and rejects unsupported actions before Docker runs", () => {
  const input = { repository: process.cwd(), action: "up", arguments_: [] };
  assert.throws(() => parseOptions(input), /--project-name/);
  input.arguments_ = ["--project-name", "existing-web", "--force-recreate"];
  assert.throws(() => parseOptions({ ...input, action: "verify" }), /只能用于 up/);
  assert.throws(() => parseOptions({ ...input, action: "down" }), /check、up 或 verify/);
});

test("preserves recorded overrides in order and appends each extra file only once", (t) => {
  const f = fixture(t);
  const recorded = ["compose.yml", "extra.yml", "compose.override.yml"].map((name) => join(f.options.root, name));
  f.current.Config.Labels[FILES_LABEL] = recorded.join(",");
  f.options.file = [recorded[1], recorded[1]];
  assert.deepEqual(f.create().files, recorded);
});

test("missing recorded configuration stops before rendering or updating", (t) => {
  const f = fixture(t);
  f.current.Config.Labels[FILES_LABEL] = ["compose.yml", "missing.yml"]
    .map((name) => join(f.options.root, name)).join(",");
  assert.throws(f.create, /配置文件缺失/);
  assert.equal(f.commands.some((args) => args.includes("config") || args.includes("up")), false);
});

test("a project from another checkout cannot be replaced", (t) => {
  const f = fixture(t);
  f.current.Config.Labels[FILES_LABEL] = join(f.options.root, "other", "compose.yml");
  assert.throws(f.create, /未使用当前 Web 配置/);
});

test("new installations include existing private override and explicit environment file", (t) => {
  const f = fixture(t);
  f.current = undefined;
  f.options["env-file"] = join(f.options.root, "private.env");
  const deployment = f.create();
  assert.deepEqual(deployment.files, ["compose.yml", "compose.override.yml"].map((name) => join(f.options.root, name)));
  const index = deployment.command.indexOf("--env-file");
  assert.equal(deployment.command[index + 1], f.options["env-file"]);
});

test("missing gateway configuration blocks the update", (t) => {
  const f = fixture(t);
  f.config.networks.kong.external = false;
  assert.throws(f.create, /现有 Kong 网络/);
  assert.equal(f.commands.some((args) => args.includes("up")), false);
});

test("only Web is updated, with no dependency restart, build or pull, and health is awaited", (t) => {
  const f = fixture(t);
  f.options["force-recreate"] = true;
  f.create().update();
  const update = f.commands.find((args) => args.includes("up"));
  assert.deepEqual(update.slice(update.indexOf("up")), [
    "up", "-d", "--no-deps", "--no-build", "--pull", "never",
    "--wait", "--wait-timeout", "60", "--force-recreate", "web",
  ]);
  assert.equal(f.commands.filter((args) => args[0] === "inspect").length, 2);
});

test("verification catches stale images, failed health, missing networks and aliases", (t) => {
  const changes = [
    (f) => { f.current.Image = "sha256:old"; },
    (f) => { f.current.State.Health.Status = "unhealthy"; },
    (f) => { f.current.State.Running = false; },
    (f) => { f.current.NetworkSettings.Networks = {}; },
    (f) => { f.current.NetworkSettings.Networks["existing-gateway"].Aliases = []; },
  ];
  for (const change of changes) {
    const f = fixture(t);
    const deployment = f.create();
    change(f);
    assert.throws(() => deployment.verify());
  }
});

test("checks and verification never issue update commands", (t) => {
  const f = fixture(t);
  f.create().verify();
  assert.equal(f.commands.some((args) => args.includes("up")), false);
});

test("failed updates stop without retries and report recovery without private output", (t) => {
  const f = fixture(t);
  const deployment = new WebDeployment(f.options, (args) => {
    if (args.includes("up")) throw new Error("private-environment-value");
    return f.run(args);
  });
  assert.throws(() => deployment.update(), (error) => {
    assert.match(error.message, /镜像回滚/);
    assert.doesNotMatch(error.message, /private-environment-value/);
    return true;
  });
  assert.equal(f.commands.filter((args) => args[0] === "inspect").length, 1);
});

test("Docker launch failures are reported without internal diagnostics", (t) => {
  const f = fixture(t);
  const script = resolve("scripts/deploy.mjs");
  const missing = join(f.options.root, "not-on-path");
  assert.throws(() => execFileSync(process.execPath, [script, "web", "check", "--project-name", "fixture"], {
    encoding: "utf8", env: { ...process.env, PATH: missing }, stdio: "pipe",
  }), (error) => {
    assert.match(error.stderr, /Web 部署检查失败/);
    assert.doesNotMatch(error.stderr, /ENOENT|spawnSync|stack/);
    return true;
  });
});

test("actual Web Compose renders with a custom gateway and image without starting containers", {
  skip: process.env.COMPOSE_CONFIG_TEST !== "1",
}, (t) => {
  const f = fixture(t);
  f.options["env-file"] = join(f.options.root, "test.env");
  f.options.root = resolve("apps/web");
  writeFileSync(f.options["env-file"], "ADMIN_GO_KONG_NETWORK=existing-gateway\nCODEX_WEB_IMAGE=web:verified\n");
  const run = (args) => args.includes("config")
    ? execFileSync("docker", args, { encoding: "utf8", stdio: "pipe" }) : f.run(args);
  const deployment = new WebDeployment(f.options, run);
  deployment.verify();
  assert.equal(deployment.config.services.web.image, "web:verified");
  assert.equal(deployment.config.services.web.build.context, resolve("apps/web"));
  assert.equal(deployment.config.services.web.build.dockerfile, "Dockerfile");
});
