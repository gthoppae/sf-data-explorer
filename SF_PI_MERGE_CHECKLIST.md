# SF Pi Merge Checklist — sf-data-explorer

This package is structured to be merged into `github.com/salesforce/sf-pi` as `extensions/sf-data-explorer`.

## Checks already performed in standalone package

- ✅ TypeScript: `npm run typecheck`
- ✅ Unit tests: `npm test`
- ✅ Prettier using sf-pi config: `npx prettier --check . --config /path/to/sf-pi/.prettierrc.json`
- ✅ SPDX headers on all `.ts` files
- ✅ No static heavy Salesforce SDK imports (`@salesforce/core`, SDR, `jsforce`) in extension source
- ✅ Manifest present: `extensions/sf-data-explorer/manifest.json`
- ✅ Extension README present: `extensions/sf-data-explorer/README.md`
- ✅ Extension AGENTS.md present: `extensions/sf-data-explorer/AGENTS.md`
- ✅ Source/tests are under `extensions/sf-data-explorer/{lib,tests}` to match sf-pi extension layout
- ✅ Standard `/sf-*` panel contract is wired in source: `openCommandPanel`, `openInfoPanel`, lifecycle toggle helpers, `closeBeforeAction: isLifecycleToggleAction`, and `withSafeCommandHandler`

Current validation result when this checklist was updated:

```text
typecheck: passed
tests: 7 files passed, 26 tests passed
prettier: passed
SPDX: passed
static heavy import check: passed
```

## Merge-time steps inside salesforce/sf-pi

1. Copy this directory into `extensions/sf-data-explorer/`.
2. Add the extension entry to root `package.json`:

   ```json
   "./extensions/sf-data-explorer/index.ts"
   ```

3. Add/update `catalog/index.json` and generated docs by running:

   ```bash
   npm run generate-catalog
   npm run docs:health:check
   ```

4. Run full sf-pi validation:

   ```bash
   npm run check
   npm test -- extensions/sf-data-explorer
   npm run lint
   ```

5. Confirm the standard `/sf-*` panel contract:

   The standalone package now uses a no-args `/sf-data-explorer` command panel when sf-pi common helpers are available, with actions for `Open SOQL`, `Open SOSL`, `Open Data 360 SQL`, `Help`, `Close`, and lifecycle toggle. It falls back to the direct mode picker only when running outside sf-pi common helper availability.

   During merge, run:

   ```bash
   npm run check:panels
   ```

6. Confirm boot-path behavior remains cache-first:

   ```bash
   npm run check:boot-path
   ```

7. Confirm generated docs/catalog are up to date after adding the extension to root `package.json`.

## Runtime safety expectations

- V1 remains read-only.
- No DML, Apex execution, Metadata API writes, or Data 360 mutation endpoints.
- SOQL/Data 360 SQL validates `SELECT` before execution.
- SOSL validates `FIND` before execution.
- Data 360 field discovery uses `/ssot/metadata?entityName=...`; `/ssot/query-sql` is used only for the visible SQL query.
- Exports go under `.sf-data-explorer/exports/` in the current working directory.
