import { describe, expect, it } from "vitest";
import { getSwitchableAccounts } from "./accountSelectors";

const account = (overrides: Partial<{
  id: string;
  localProxyCompatible: boolean;
  directSwitchCompatible: boolean;
  accountSource: string;
}>) => ({
  id: "account-1",
  localProxyCompatible: true,
  directSwitchCompatible: true,
  ...overrides,
});

describe("account selectors", () => {
  it("returns accounts compatible with the active switching mode", () => {
    const accounts = [
      account({ id: "proxy", localProxyCompatible: true, directSwitchCompatible: false }),
      account({ id: "direct", localProxyCompatible: false, directSwitchCompatible: true }),
      account({ id: "both", localProxyCompatible: true, directSwitchCompatible: true }),
    ];

    expect(getSwitchableAccounts(accounts, true).map(({ id }) => id)).toEqual(["proxy", "both"]);
    expect(getSwitchableAccounts(accounts, false).map(({ id }) => id)).toEqual(["direct", "both"]);
  });

  it("keeps native Claude switching available while Codex proxy routing is enabled", () => {
    const claude = account({ id: "claude", accountSource: "claudeCode", localProxyCompatible: false });
    expect(getSwitchableAccounts([claude], true)).toEqual([claude]);
    expect(getSwitchableAccounts([claude], false)).toEqual([claude]);
  });
});
