# CC Switch Codex catalog publication

On 2026-11-01, 79 platforms from CC Switch were published as 84 public community
configurations through the signed-in Remote AI application's existing Provider market API.
All 84 entries were read back individually and compared with the prepared public drafts.
The final paginated public listing contained all 84 entries. A subsequent dry run found
zero missing entries and 84 identical publications.

## Source

- Repository: <https://github.com/farion1231/cc-switch>
- Local checkout: `F:/projects/cc-switch`
- Revision: `8be840557bacd89d592f13ddc1bee0586afaea14`
- Presets: `src/config/codexProviderPresets.ts`
- Picker classification and family grouping: `src/components/providers/forms/presetGroups.ts`
- License: [MIT notice](cc-switch-LICENSE), copyright 2025 Jason Young.
- [Public catalog and source metadata](cc-switch-codex.json)
- [Publication IDs and verification receipt](cc-switch-publication.json)

The picker combines `aggregator`, `third_party`, and other uncategorized presets into
its third-party group after excluding login, vendor, cloud, local and plugin categories.
Hidden and custom-template entries are excluded. Its custom-entry button is not counted.
The resulting 84 presets form 79 families because these five families each have two versions:

| Platform | Preserved versions |
| --- | --- |
| Compshare | Standard and Coding Plan |
| OpenCode | Go and Zen |
| SiliconFlow | China and international |
| SoruxGPT | Standard and Coding Plan |
| SudoCode | `.chat` and `.us` |

The market has one service address per entry, so these versions remain separate publications.
There are 70 Responses configurations and 14 Chat Completions configurations, with 139 model
associations in total. The source default model is first; additional explicit catalog models
follow in source order. Source API formats are preserved rather than inferred from model names.

## Mapping and limits

Provider names, main API addresses, website links and model identifiers come from the source
snapshot. Alternate endpoint candidates and API-key signup links are retained only as source
metadata; they are not silently substituted into the published service address. The public
drafts contain no credentials, promotion flags, custom headers or balance scripts.

All prices are `null` because the preset catalog provides no price data. The required currency
is the market's default USD and the default tier multiplier is 1; neither asserts a quoted
price or the vendor's billing currency. There were no existing market entries to overwrite.
No personal Provider was created, activated or modified.

Azure OpenAI is a resource-specific template. Its legacy `/openai` endpoint and dated query
parameter were adapted to `/openai/v1`, following the
[Microsoft v1 API documentation](https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle).
Its published description tells users to replace the resource and model deployment names.
The description in [azure-template.txt](azure-template.txt) is editable publication content,
not an application translation resource.

Publication and schema verification do not establish that every upstream service or model is
currently available. No vendor API key or paid inference request was used.

## Reproduce and resume

From the repository root, with dependencies installed:

```powershell
node scripts/provider-market/build-cc-switch.mjs F:/projects/cc-switch
node --test scripts/provider-market/catalog.test.mjs
node scripts/provider-market/publish-catalog.mjs
node scripts/provider-market/publish-catalog.mjs --publish
```

The build rejects changed platform/configuration counts. Review the generated diff before
publishing a different source revision. The publisher validates every draft using the actual
shared schema, reads every public and owned market page, and fails on differing, duplicated
or unpublished matches before writing. Without `--publish`, it performs read-only preflight.

Publication uses the running application's signed-in identity at `http://127.0.0.1:9999`.
Credentials remain in the application's existing authentication flow. Entries are published
sequentially, with an identity check before each write and anonymous readback afterwards.
A request failure stops the batch. Rerunning first discovers existing publications and skips
identical entries, including a save whose response was lost; it does not blindly retry writes.
Per-run receipts are saved under ignored `.codex-tmp/provider-import/`.

The initial run published 76 entries before a public readback returned `market.unavailable`.
A second preflight found those 76 unchanged entries, published the remaining 8, and verified
all 84. The checked-in publication receipt combines the two runs' created IDs.

No application UI, backend routes, database schema or deployment was changed by this import.
The existing desktop local, remote and Web market clients consume the same cloud catalog.
