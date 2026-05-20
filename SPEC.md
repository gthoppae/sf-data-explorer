# sf-dataExplorer Specification

Status: Draft implementation spec  
Target repository: <https://github.com/salesforce/sf-pi>  
Primary command: `/sf-data-explorer`  
Primary extension id recommendation: `sf-data-explorer`

## 1. Naming recommendation

Existing `sf-pi` extension conventions are consistent:

- Extension directory: `extensions/sf-browser`, `extensions/sf-data360`, `extensions/sf-agentscript`, etc.
- Manifest id: lower-case kebab case, for example `sf-browser`, `sf-data360`, `sf-agentscript`.
- Display name: title case with `SF`, for example `SF Browser`, `SF Data 360`.
- Slash command: lower-case kebab case, for example `/sf-browser`, `/sf-data360`, `/sf-agentscript`.
- Entry point: `index.ts` in the extension directory.

Recommended implementation naming:

| Surface                          | Recommended name                                                    |
| -------------------------------- | ------------------------------------------------------------------- |
| Extension directory              | `extensions/sf-data-explorer/`                                      |
| Manifest id                      | `sf-data-explorer`                                                  |
| Display name                     | `SF Data Explorer`                                                  |
| Primary command                  | `/sf-data-explorer`                                                 |
| TypeScript factory               | `sfDataExplorer`                                                    |
| Optional standalone package name | `sf-data-explorer`                                                  |
| User-facing project codename     | `sf-dataExplorer` is acceptable in docs, but not as the manifest id |

Rationale: use kebab-case for ids, paths, commands, and package-like names to match the rest of `sf-pi`; use `SF Data Explorer` as the user-facing product label.

This spec file lives at `sf-dataExplorer/SPEC.md` because that was the requested spec location. The implementation should use `extensions/sf-data-explorer/` when merged into `sf-pi`.

## 2. Product goal

Build a deterministic Pi TUI extension for exploring Salesforce data across three read-only query families:

1. **Core SOQL** over standard and custom Salesforce sObjects.
2. **Core SOSL** searches across standard and custom Salesforce sObjects.
3. **Data 360 SQL** over Data Model Objects and Data Lake Objects.

The extension should preserve the UI ethos of `pi-data360-browser`’s `/d360-query-explorer`:

- keyboard-first TUI
- object list pane
- field picker pane
- query preview / editable query / result pane
- fast filtering
- deterministic backend calls
- no LLM required for normal usage

Desired request handoff:

```text
User
  -> pi
  -> sf-data-explorer command / TUI
  -> sf-pi Salesforce transport layer
  -> Salesforce REST APIs
  -> sf-pi
  -> sf-data-explorer TUI
  -> pi
  -> User
```

## 3. Non-goals for first iteration

The first iteration is an **Explorer**, not a data editor.

Out of scope for v1:

- DML or data mutation.
- Composite write APIs.
- Bulk API jobs.
- Metadata deploy/retrieve.
- Tooling API object browsing by default.
- LLM-generated queries in the core path.
- Relationship query builder.
- Aggregate query builder.
- Visual query graph builder.

The architecture should leave clear extension points for these later, but v1 must remain read-only and deterministic.

## 4. Command contract

### 4.1 Primary command

```text
/sf-data-explorer [mode] [target-org] [flags]
/sf-data-explorer [mode] [object-or-table-api-name] [target-org] [flags]
```

Modes:

| Mode   | Meaning                                               |
| ------ | ----------------------------------------------------- |
| `soql` | Core Salesforce SOQL explorer over queryable sObjects |
| `sosl` | Core Salesforce SOSL explorer                         |
| `sql`  | Data 360 SQL explorer over DMO/DLO objects            |

Required examples:

```text
/sf-data-explorer soql wh
/sf-data-explorer sosl wh
/sf-data-explorer sql wh

# Deep-link to an object/table and org:
/sf-data-explorer soql Account wh
/sf-data-explorer sosl Contact wh
/sf-data-explorer sql ssot__Individual__dlm wh
```

Useful variants:

```text
/sf-data-explorer
/sf-data-explorer soql
/sf-data-explorer sosl
/sf-data-explorer sql
/sf-data-explorer soql wh refresh
/sf-data-explorer sql wh --refresh
```

Behavior:

- If no `mode` is supplied and Pi has an interactive UI, show a small mode picker:
  - SOQL Explorer
  - SOSL Explorer
  - Data 360 SQL Explorer
- If no `target-org` is supplied, use sf-pi’s resolved default target org.
- If an object/table API name is supplied before the target org, deep-link to that object after catalog load and preselect default fields.
- `refresh`, `--refresh`, `--force`, and `-f` force catalog/describe cache reloads.
- Unknown mode should show usage and valid examples.

### 4.2 Command completion

`getArgumentCompletions` should provide:

- `soql`
- `sosl`
- `sql`
- `refresh`
- `--refresh`
- optional current default org alias if available from sf-pi environment cache

Do not shell out during completion. Use cached environment state only.

### 4.3 Optional compatibility aliases

Because this project borrows from `pi-data360-browser`, compatibility aliases may be provided later, but they are not required for v1.

Potential aliases:

```text
/sf-soql-explorer -> /sf-data-explorer soql
/sf-sosl-explorer -> /sf-data-explorer sosl
/sf-d360-query-explorer -> /sf-data-explorer sql
```

Do not register `/d360-query-explorer` inside `sf-pi` unless explicitly needed, to avoid confusing ownership between `sf-data360` and `sf-data-explorer`.

## 5. Extension manifest

Recommended `extensions/sf-data-explorer/manifest.json`:

```json
{
  "id": "sf-data-explorer",
  "name": "SF Data Explorer",
  "description": "Read-only interactive TUI explorer for SOQL, SOSL, and Data 360 SQL using sf-pi Salesforce transport plumbing.",
  "category": "ui",
  "maturity": "experimental",
  "defaultEnabled": true,
  "configurable": true,
  "commands": ["/sf-data-explorer"],
  "events": ["session_start", "session_shutdown"],
  "docs": {
    "summary": "Keyboard-first read-only Salesforce data explorer with object/field browsing, editable query text, query execution, result detail view, and JSON/CSV export. Uses sf-pi @salesforce/core connection plumbing; no LLM required.",
    "primaryFiles": [
      "index.ts",
      "lib/transport.ts",
      "lib/command.ts",
      "lib/ui/spa.ts",
      "lib/modes/soql.ts",
      "lib/modes/sosl.ts",
      "lib/modes/data360-sql.ts"
    ],
    "safety": [
      "Read-only v1: only REST GET and read-only Data 360 SQL POST calls are issued.",
      "Core SOQL execution validates SELECT-only query text before calling /query or /queryAll.",
      "SOSL execution validates FIND-only query text before calling /search.",
      "Uses sf-pi target-org and API-version resolution; no hardcoded API version.",
      "No raw access tokens are surfaced in UI or logs."
    ]
  }
}
```

Add to root `package.json` `pi.extensions` when implementing in `sf-pi`:

```json
"./extensions/sf-data-explorer/index.ts"
```

## 6. Backend transport design

### 6.1 Immediate approach: dynamic import of sf-pi internals

For the first implementation, use dynamic imports of existing `sf-pi` internals, following the pattern used by `pi-data360-browser/lib/sf-data360-adapter.ts`.

Required internals:

- `lib/common/sf-conn/connection.ts`
  - `connFromAlias`
  - `clearConnectionCache`
- `lib/common/sf-conn/request.ts`
  - `connRequest`
- `lib/common/sf-environment/detect.ts`
  - `detectEnvironment`
- `extensions/sf-data360/lib/target-org.ts`
  - `normalizeTargetOrg`
  - `resolveExplicitTargetOrg`
  - `resolveApiVersion`
  - optionally `resolveOrgType`
- `extensions/sf-data360/lib/path.ts`
  - `buildApiPath`

Even if the extension lives inside `sf-pi`, keep transport initialization lazy so loading the extension does not eagerly initialize `@salesforce/core` or auth state.

### 6.2 Transport interface

`lib/transport.ts` should expose a narrow extension-owned interface:

```ts
export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface TargetContext {
  targetOrg?: string;
  apiVersion: string;
  orgType: "production" | "sandbox" | "scratch" | "unknown" | string;
}

export interface SfDataExplorerTransportInfo {
  mode: "sf-pi-internals";
  sfPiPath?: string;
  sourceCommit?: string;
}

export interface SfDataExplorerTransport {
  info: SfDataExplorerTransportInfo;
  resolveTarget(targetOrg?: string): Promise<TargetContext>;
  callRest<T = unknown>(args: {
    targetOrg?: string;
    method: Method;
    path: string;
    query?: Record<string, unknown>;
    body?: unknown;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<{ status: number; body: T; path: string; context: TargetContext }>;
  querySoql(args: {
    targetOrg?: string;
    soql: string;
    queryAll?: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<CoreQueryResponse>;
  searchSosl(args: {
    targetOrg?: string;
    sosl: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<CoreSearchResponse>;
  queryData360Sql(args: {
    targetOrg?: string;
    sql: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<Data360SqlResponse>;
}
```

All UI strategies call this transport only. No UI component should import sf-pi internals directly.

### 6.3 REST endpoints used

Core Salesforce:

```text
GET /services/data/vXX.X/sobjects
GET /services/data/vXX.X/sobjects/{ObjectApiName}/describe
GET /services/data/vXX.X/query?q=<encoded SOQL>
GET /services/data/vXX.X/queryAll?q=<encoded SOQL>       future / optional
GET /services/data/vXX.X/search?q=<encoded SOSL>
GET /services/data/vXX.X/query/<nextRecordsUrl suffix>    future / pagination
```

Data 360:

```text
GET  /services/data/vXX.X/ssot/metadata-entities?entityType=DataModelObject
GET  /services/data/vXX.X/ssot/metadata-entities?entityType=DataLakeObject
GET  /services/data/vXX.X/ssot/metadata?entityName=<selectedEntityName>
POST /services/data/vXX.X/ssot/query-sql
```

For Data 360 object lists, use `/ssot/metadata-entities`. When a user selects an object, use `/ssot/metadata?entityName=...` to fetch details and fields. Use `/ssot/query-sql` only to run the user's SQL query, not for field discovery.

### 6.4 No hardcoded API version

Do not hardcode `66.0` or any other API version. Always resolve through sf-pi target-org context:

1. Explicit target org if supplied.
2. sf-pi / sf CLI default target org.
3. Project `sourceApiVersion` only as fallback when org detection is unavailable.
4. Error clearly if no version can be resolved.

### 6.5 Future clean sf-pi transport API

The dynamic-import implementation should be considered a bridge. A future `sf-pi` common transport API could live at:

```text
lib/common/sf-transport/index.ts
```

Desired exported API:

```ts
export interface SfTransport {
  resolveTargetOrgContext(targetOrg?: string): Promise<TargetOrgContext>;
  callRest<T>(request: SfRestRequest): Promise<SfRestResponse<T>>;
  querySoql(request: SoqlRequest): Promise<SoqlResponse>;
  searchSosl(request: SoslRequest): Promise<SoslResponse>;
}

export function getSfTransport(pi: ExtensionAPI, cwd: string): Promise<SfTransport>;
export function clearSfTransportCache(): void;
```

Benefits:

- Avoids `sf-data-explorer` depending on `sf-data360` path helpers.
- Makes generic Salesforce REST usage reusable by future `sf-pi` extensions.
- Centralizes target-org, API-version, org-type, timeout, retry, and error normalization.
- Gives `sf-guardrail` and future audit layers one consistent surface to inspect.

## 7. TUI architecture

### 7.1 Preserve current Data 360 query explorer ethos

Borrow and refactor from `pi-data360-browser/extensions/data360-browser.ts`:

- Generic `Spa<TObject, TField>` concept.
- Three-pane layout.
- Accordion layout fallback.
- Object filter.
- Field filter.
- Field multi-select.
- Query preview.
- Result table.
- Detail view.
- Cache status line.
- Transport pill in title.
- Keyboard-first interactions.

Refactor into smaller modules:

```text
extensions/sf-data-explorer/
  index.ts
  manifest.json
  lib/
    command.ts
    transport.ts
    cache.ts
    result-normalize.ts
    query-validators.ts
    export.ts
    ui/
      explorer-spa.ts
      mode-picker.ts
      result-viewer.ts
      editable-query.ts
      save-dialog.ts
      table.ts
      text.ts
    modes/
      soql.ts
      sosl.ts
      data360-sql.ts
```

### 7.2 Generic mode strategy

Use a mode strategy similar to existing `SpaStrategy<TObject, TField>`, but add first-class editable query support.

```ts
export interface ExplorerStrategy<TObject, TField> {
  mode: "soql" | "sosl" | "sql";
  title(org: string): string;
  objectKindLabel(): string;

  loadCatalog(force: boolean): Promise<CatalogLoad<TObject>>;
  loadFields(obj: TObject, force: boolean): Promise<FieldsLoad<TField>>;

  objectName(obj: TObject): string;
  objectDisplayName(obj: TObject): string;
  objectSubtitle(obj: TObject): string;
  objectQueryHay(obj: TObject): string;

  fieldName(field: TField): string;
  fieldLabel(field: TField): string;
  fieldTypeLabel(field: TField): string;
  fieldQueryHay(field: TField): string;
  defaultFieldSelections(fields: TField[]): string[];

  buildQuery(state: QueryBuildState<TObject, TField>): string;
  validateQuery(queryText: string): QueryValidationResult;
  runQuery(queryText: string, signal?: AbortSignal): Promise<RunResult>;
  normalizeResult(raw: unknown): RunResult;

  exportBaseName(state: QueryBuildState<TObject, TField>): string;
}
```

### 7.3 Editable query text

This is a key improvement over the current `/d360-query-explorer`.

The TUI maintains both:

1. **Builder state**
   - selected object
   - selected fields
   - `WHERE`
   - `LIMIT`
   - mode-specific options
2. **Editable query text**
   - the actual query that will be run

Rules:

- Selecting an object or fields generates a default query.
- Editing `WHERE` or `LIMIT` updates the generated query.
- Pressing `e` opens an in-place query editor inside the custom TUI for the full query text. Do not call Pi's global chat editor while the custom TUI is mounted; that swaps focus away from the explorer and may not restore the custom UI in some clients.
- Once manually edited, set `queryDirty = true`.
- When `queryDirty = true`, object/field changes should ask or clearly indicate that rebuilding will overwrite manual edits.
- Pressing `b` rebuilds query from current object/field/WHERE/LIMIT state.
- Pressing `r` runs the current editable query text, not a hidden regenerated query.
- Pressing `c` copies the current editable query text to Pi’s editor.

Suggested query panel labels:

```text
Query
  SELECT Id, Name
  FROM Account
  WHERE Name LIKE 'A%'
  LIMIT 25

state: generated | edited
```

### 7.4 Keyboard contract

Common keys:

| Key       | Action                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `?`       | Show in-TUI shortcut help overlay                                                                                        |
| `t`       | Open in-TUI explorer switcher: SOQL / SOSL / Data 360 SQL                                                                |
| `←` / `→` | Move between panes                                                                                                       |
| `↑` / `↓` | Move cursor in active pane                                                                                               |
| `/`       | Filter active object/field pane                                                                                          |
| `enter`   | Select object / toggle field / open result detail                                                                        |
| `space`   | Toggle field                                                                                                             |
| `a`       | Select all visible fields                                                                                                |
| `n`       | Select none visible                                                                                                      |
| `i`       | Invert visible field selection                                                                                           |
| `w`       | Edit `WHERE` / SOSL search term depending mode                                                                           |
| `l`       | Edit `LIMIT`                                                                                                             |
| `e`       | Edit full query text                                                                                                     |
| `b`       | Rebuild query from current selections                                                                                    |
| `r`       | Run current query text                                                                                                   |
| `c`       | Close explorer and copy current query text to Pi editor                                                                  |
| `s`       | Open in-TUI save menu for latest result as JSON or CSV under `.sf-data-explorer/exports/`; stay in explorer after saving |
| `f`       | Force refresh active catalog or field describe                                                                           |
| `z`       | Toggle 80% focus pane                                                                                                    |
| `v`       | Toggle columns / accordion layout                                                                                        |
| `q`       | Close, with quit confirmation if query/result is dirty                                                                   |
| `esc`     | Back / clear result / close detail / close explorer                                                                      |

Mode-specific keys may be added but should not conflict with common keys.

## 8. SOQL mode

### 8.1 Scope

Initial version:

- List only queryable sObjects.
- Support standard and custom objects.
- Describe selected object before showing fields.
- Build basic SOQL:

```sql
SELECT
  Id,
  Name
FROM Account
WHERE <optional user text>
LIMIT 25
```

- Full query text is editable.
- Run read-only `SELECT` queries through REST `/query`.

### 8.2 Catalog loading

Call:

```text
GET /sobjects
```

Use response `sobjects` and keep only rows where:

```ts
sobject.queryable === true;
```

Default v1 filter:

- include queryable standard objects
- include queryable custom objects
- exclude deprecated/hidden objects when metadata indicates it
- optionally hide noisy internal/system objects behind a future toggle

Catalog row fields:

```ts
interface CoreSObjectMeta {
  name: string;
  label: string;
  labelPlural?: string;
  custom: boolean;
  queryable: boolean;
  searchable?: boolean;
  deprecatedAndHidden?: boolean;
}
```

Object row display should put API names first, because API names are stable and labels can be missing or duplicated:

```text
ACTIVE  STD   Account · Account · searchable
ACTIVE  CUST  MyObject__c · My Object
```

UX rules:

- Sort standard objects before custom objects, then by API name.
- Color custom object API names differently from standard object API names.
- Suppress Salesforce placeholder labels such as `__MISSING LABEL__...`; do not show them as primary text.
- Show real labels only as secondary muted text when they add useful context.

### 8.3 Field loading

Call:

```text
GET /sobjects/{ObjectApiName}/describe
```

Use `fields[]` from describe. Respect whatever fields are returned by the org/user context. Do not guess field API names.

Field shape:

```ts
interface CoreFieldMeta {
  name: string;
  label: string;
  type: string;
  custom?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  groupable?: boolean;
  calculated?: boolean;
  relationshipName?: string;
  referenceTo?: string[];
}
```

Default field selection heuristic:

1. `Id`
2. `Name` if present
3. common human-readable fields if present:
   - `FirstName`
   - `LastName`
   - `Email`
   - `Phone`
   - `CreatedDate`
   - `LastModifiedDate`
4. otherwise first 5 returned fields

### 8.4 SOQL builder

Builder inputs:

```ts
interface SoqlBuildState {
  objectApiName?: string;
  selectedFields: string[];
  whereClause: string;
  limit: number;
}
```

Builder output:

```sql
SELECT
  Id,
  Name
FROM Account
WHERE Name LIKE 'A%'
LIMIT 25
```

Rules:

- If no fields are selected, use `Id` if present, otherwise `FIELDS(STANDARD)` only if explicitly enabled in a future option. Prefer explicit fields in v1.
- Default `LIMIT` should be 25.
- Max `LIMIT` in UI should default to 2,000 unless overridden by config.
- `WHERE` is raw user text in v1; no visual condition builder required.

### 8.5 Editable raw SOQL

Pressing `e` opens a multi-line editor:

```text
Edit SOQL

SELECT Id, Name
FROM Account
WHERE Name LIKE 'A%'
LIMIT 25
```

On save:

- update `queryText`
- mark `queryDirty = true`
- validate before run

### 8.6 SOQL validation

Before execution:

- Trim comments and whitespace enough to identify the first keyword.
- Require first keyword to be `SELECT`.
- Reject obvious mutation or non-query text:
  - `INSERT`
  - `UPDATE`
  - `UPSERT`
  - `DELETE`
  - `UNDELETE`
  - `MERGE`
  - `CALL`
  - `EXEC`
  - anonymous Apex fragments
- Warn if no `LIMIT` is present and ask for confirmation or auto-append a configured default in v1.

Do not attempt to fully parse SOQL in v1. Validation is a read-only safety gate, not a complete compiler.

### 8.7 SOQL execution

Call:

```text
GET /query?q=<encoded queryText>
```

Transport helper:

```ts
querySoql({ targetOrg, soql: queryText, queryAll: false });
```

Response shape:

```ts
interface CoreQueryResponse {
  totalSize: number;
  done: boolean;
  records: Array<Record<string, unknown>>;
  nextRecordsUrl?: string;
}
```

Normalize records by:

- Removing top-level `attributes` from table columns.
- Preserving nested relationship values as JSON strings in table view.
- Keeping raw row JSON for detail view/export.

### 8.8 SOQL future options

Mentioned but not v1:

- `queryAll` toggle.
- Pagination through `nextRecordsUrl`.
- `ORDER BY` builder.
- Relationship field picker, for example `Owner.Name`, `Account.Name`.
- Child subquery builder.
- Aggregate query builder.
- `GROUP BY` / `HAVING` builder.
- Query plan / explain integration.
- Tooling API object mode.
- Big Object / Async SOQL awareness if applicable.

## 9. SOSL mode

### 9.1 Scope

Initial version:

- Simple search term input.
- Choose returning objects from searchable/queryable sObjects.
- Choose fields per object, initially simple.
- Generate editable SOSL.
- Run read-only SOSL through REST `/search`.

### 9.2 Catalog loading

Use the same core sObject catalog from SOQL mode, but default to objects where:

```ts
sobject.searchable === true;
```

If `searchable` is not available or false for objects the user expects, allow future toggle:

```text
m: searchable only / all queryable
```

### 9.3 Simple SOSL builder

Builder inputs:

```ts
interface SoslBuildState {
  searchTerm: string;
  returning: Array<{
    objectApiName: string;
    fields: string[];
    limit: number;
    whereClause?: string; // future
  }>;
  globalLimit: number;
}
```

Generated query:

```sql
FIND {acme}
IN ALL FIELDS
RETURNING Account(Id, Name), Contact(Id, Name, Email)
LIMIT 10
```

Minimum v1 UI may start with one selected object at a time, but the strategy should support multiple returning objects so the UI can expand without changing the backend.

### 9.4 Editable raw SOSL

Pressing `e` opens a multi-line editor:

```text
Edit SOSL

FIND {acme}
IN ALL FIELDS
RETURNING Account(Id, Name)
LIMIT 10
```

On save:

- update `queryText`
- mark `queryDirty = true`
- validate before run

### 9.5 SOSL validation

Before execution:

- Require first keyword to be `FIND`.
- Reject mutation-like keywords as a safety precaution.
- Warn if no `RETURNING` clause is present because results may be broad.
- Enforce or recommend per-object `LIMIT`.

### 9.6 SOSL execution

Call:

```text
GET /search?q=<encoded queryText>
```

Response shape is an array of records. Normalize by:

- Adding a synthetic `_object` column from `attributes.type` when available.
- Removing `attributes` from default table columns.
- Keeping raw rows for detail/export.

### 9.7 SOSL future options

Mentioned but not v1:

- Multiple returning object field pickers in one screen.
- `IN NAME FIELDS`, `IN EMAIL FIELDS`, etc.
- `WITH` clauses.
- Snippets/highlights if exposed by API.
- Search scope presets.
- Search result grouping by object.

## 10. Data 360 SQL mode

### 10.1 Scope

This mode is the refactored version of current `/d360-query-explorer`.

Initial version:

- Load DMO and DLO metadata.
- Toggle catalog filter: All / DMO / DLO.
- Select fields.
- Build SQL.
- Editable SQL text.
- Run through `/ssot/query-sql`.
- Browse rows.
- Save JSON/CSV.

Required command:

```text
/sf-data-explorer sql wh
```

### 10.2 Catalog loading

Call both:

```text
GET /ssot/metadata-entities?entityType=DataModelObject
GET /ssot/metadata-entities?entityType=DataLakeObject
```

Merge and tag rows:

```ts
interface Data360ObjectMeta {
  name: string;
  displayName?: string;
  category?: string;
  type?: string;
  entityType: "DMO" | "DLO";
}
```

Do not broadly call `/ssot/data-model-objects` for list display. Keep compact metadata behavior from `sf-data360` guidance.

### 10.3 Field loading

When the user selects a DMO/DLO, fetch details through the metadata endpoint:

```text
GET /ssot/metadata?entityName=ssot__Individual__dlm
```

Use the response's field arrays as the field list, supporting known shapes such as `fields[]`, `dataFields[]`, `dataModelObject[0].fields[]`, `dataLakeObjects[0].fields[]`, or `items[0].fields[]`.

Do not use `/ssot/query-sql` for field discovery. `/ssot/query-sql` is reserved for executing the user's visible SQL query.

### 10.4 SQL builder

Generated query:

```sql
SELECT
  ssot__Id__c,
  ssot__FirstName__c,
  ssot__LastName__c
FROM ssot__Individual__dlm
WHERE <optional raw where>
LIMIT 25
```

Rules:

- Default `LIMIT` should be 25.
- Field quoting should use existing `quoteIdentifier` logic from `pi-data360-browser`.
- Full SQL is editable through `e`.
- Press `b` to rebuild from selections.

### 10.5 SQL validation

Before execution:

- Require first keyword to be `SELECT`.
- Reject obvious mutating SQL keywords if Data 360 SQL ever supports them.
- Warn or append default `LIMIT` when absent.

### 10.6 SQL execution

Call:

```text
POST /ssot/query-sql
{ "sql": queryText }
```

Normalize response:

```ts
interface Data360SqlResponse {
  data?: unknown[][];
  metadata?: Array<{ name?: string; type?: string; nullable?: boolean }>;
  returnedRows?: number;
  status?: unknown;
}
```

Column names come from `metadata[].name`. Rows are arrays mapped to objects.

## 11. Caching

Use in-memory cache with default TTL 15 minutes, preserving current `pi-data360-browser` behavior.

Cache keys should include:

- mode
- target org
- API version if available
- catalog type
- object name for describes/fields

Examples:

```text
catalog|soql|wh|66.0
fields|soql|wh|66.0|Account
catalog|sql|wh|66.0|DMO+DLO
fields|sql|wh|66.0|ssot__Individual__dlm
```

Refresh behavior:

- Command flag `refresh` forces initial catalog refresh.
- Key `f` refreshes active pane:
  - object pane -> reload catalog
  - field pane -> reload selected object describe/fields
- Show status:
  - `Serving SOQL catalog from cache (age 2m, TTL 15m). Use refresh to force reload.`
  - `Refreshed Account describe cache at 10:24:13 AM (TTL 15m).`

Clear connection cache on `session_start` and `session_shutdown` by delegating to sf-pi common connection cache.

## 12. Results UX

### 12.1 Table view

Use current result table behavior:

- Show limited visible columns based on terminal width.
- Use `↑↓` to move row cursor.
- Press `enter` in result pane to open record detail.
- Show `… N more columns hidden` when needed.

### 12.2 Detail view

Detail view should show:

```text
Record 3 of 25 · Account
↑↓ scroll · ←→ prev/next record · c copy JSON · esc back
────────────────────────────────────────────────────────
Id          001...
Name        Acme
Owner       {"Name":"Jane User", ...}
```

### 12.3 Export

Press `S` to open save dialog:

```text
Save result as
  JSON
  CSV
  Cancel
```

Default file names:

```text
sf-data-explorer-soql-Account-20260520-142501.json
sf-data-explorer-soql-Account-20260520-142501.csv
sf-data-explorer-sosl-search-20260520-142501.json
sf-data-explorer-sql-ssot__Individual__dlm-20260520-142501.csv
```

Default output directory:

```text
.sf-data-explorer/exports/
```

This avoids writing into protected `.sf/**` or `.sfdx/**` locations.

JSON export:

```json
{
  "mode": "soql",
  "targetOrg": "wh",
  "apiVersion": "66.0",
  "query": "SELECT Id, Name FROM Account LIMIT 25",
  "exportedAt": "2026-05-20T14:25:01.000Z",
  "totalReturned": 25,
  "rows": []
}
```

CSV export:

- Use normalized table columns.
- Escape quotes and newlines according to CSV rules.
- Serialize object/array cell values as compact JSON.

Export safety:

- Never overwrite without confirmation.
- Keep paths under cwd unless user explicitly enters an absolute path and confirms.
- Do not export access tokens, auth headers, or connection details.

## 13. Read-only safety model

v1 must only issue read-only calls:

| Mode         | Allowed calls                                                     |
| ------------ | ----------------------------------------------------------------- |
| SOQL         | `GET /sobjects`, `GET /sobjects/{name}/describe`, `GET /query`    |
| SOSL         | `GET /sobjects`, `GET /sobjects/{name}/describe`, `GET /search`   |
| Data 360 SQL | compact metadata `GET`s, `POST /ssot/query-sql` with `SELECT` SQL |

Safety requirements:

- No `POST`, `PATCH`, `PUT`, or `DELETE` against core data APIs in v1.
- No DML generation or execution.
- No Apex execution.
- No Metadata API writes.
- No Data 360 mutation endpoints.
- Query validators run before every query execution.
- If validation fails, show error in TUI and do not call Salesforce.
- If running in production, no additional confirmation is required for validated read-only queries, but status should clearly show target org.

Optional future safety enhancements:

- Configurable max row limit.
- Confirmation for queries without `LIMIT`.
- Query cost/explain warning for SOQL if query plan integration is added.
- Audit session entry when exporting data.

## 14. LLM hook points, deferred

No LLM is needed for basic use. v1 should not depend on model availability.

Future optional hooks can be implemented as commands or keybindings that call Pi only when explicitly invoked:

| Hook             | Possible key | Description                                                                                   |
| ---------------- | ------------ | --------------------------------------------------------------------------------------------- |
| Generate query   | `g`          | Prompt LLM with selected object/fields and user intent; write draft into editable query text. |
| Explain query    | `x`          | Explain current SOQL/SOSL/SQL.                                                                |
| Suggest fields   | `?`          | Suggest useful fields for selected object based on labels/types.                              |
| Summarize sample | `u`          | Summarize visible result sample.                                                              |
| Fix query error  | `F`          | Provide current query and Salesforce error to LLM and ask for corrected draft.                |

LLM hook constraints:

- Must be opt-in per action.
- Must never auto-run generated queries.
- Must show generated query in editable query pane first.
- Must not include full result exports by default; use visible sample or user-confirmed subset.

## 15. Settings

Potential settings under `sfPi.dataExplorer`:

```ts
interface SfDataExplorerSettings {
  defaultMode?: "soql" | "sosl" | "sql";
  defaultLimit: number; // default 25
  maxInlineRows: number; // default 2000
  cacheTtlMs: number; // default 15m
  exportDir: string; // default .sf-data-explorer/exports
  showInternalObjects: boolean; // default false, future
  includeToolingApi: boolean; // default false, future
  confirmNoLimitQueries: boolean; // default true
}
```

v1 can hardcode defaults and defer a config panel, but the module boundaries should make settings easy to add.

## 16. Implementation phases

### Phase 0: Refactor foundation

- Create `extensions/sf-data-explorer/`.
- Add manifest.
- Add root package `pi.extensions` entry.
- Extract reusable TUI pieces from `pi-data360-browser`:
  - generic SPA component
  - result table/detail view
  - cache helpers
  - text helpers
  - result normalization
- Add lazy sf-pi transport wrapper.

Acceptance:

- `/sf-data-explorer` opens mode picker.
- `/sf-data-explorer sql <org>` opens refactored Data 360 SQL explorer.
- Behavior matches current `/d360-query-explorer` plus editable SQL.

### Phase 1: SOQL explorer

- Load queryable sObject catalog.
- Describe selected sObject.
- Show field picker.
- Generate basic SOQL with `WHERE` and `LIMIT`.
- Add full editable SOQL editor.
- Validate `SELECT`-only.
- Execute via `/query`.
- Display table/detail.
- Copy query to Pi editor.

Acceptance:

- `/sf-data-explorer soql wh` can browse Account fields.
- Can run `SELECT Id, Name FROM Account LIMIT 5`.
- Can manually edit query text before running.
- Invalid non-SELECT query is blocked locally.

### Phase 2: SOSL explorer

- Load searchable/queryable object catalog.
- Let user enter search term.
- Generate simple SOSL with selected object and fields.
- Add editable SOSL editor.
- Validate `FIND`-only.
- Execute via `/search`.
- Display grouped/normalized results.

Acceptance:

- `/sf-data-explorer sosl wh` can run a simple `FIND {term} RETURNING Account(Id, Name) LIMIT 10`.
- Invalid non-FIND query is blocked locally.

### Phase 3: Export

- Add save JSON/CSV dialog.
- Add export helpers and tests.
- Add overwrite confirmation.

Acceptance:

- Any latest result can be saved as JSON.
- Flat normalized table can be saved as CSV.
- Export path is shown in TUI notification.

### Phase 4: Polish and tests

- Add command panel/help text.
- Add status/doctor entry if appropriate.
- Add unit tests for builders, validators, normalization, CSV export, arg parsing.
- Add mocked transport tests for each mode.
- Add optional read-only live smoke script guarded by env var.

## 17. Test plan

Testing is a first-class requirement, not a follow-up nice-to-have. Every implementation phase must include tests in the same change set as the feature code. A feature is not considered complete until its deterministic behavior is covered by automated tests.

Minimum test gates for the generated package:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

Required CI/local validation before merge:

```bash
npm run typecheck
npm test
```

When this extension is moved into the main `sf-pi` repository, its tests should also be included in the root `npm test`, `npm run check`, and `npm run validate` flows.

Testing layers:

1. **Pure unit tests** for command parsing, query builders, validators, result normalization, CSV/JSON export, cache helpers, and text/path helpers.
2. **Mocked transport tests** for each mode to prove the UI strategy calls the expected REST surfaces without making live Salesforce calls.
3. **Component smoke tests** for TUI render stability where practical: instantiate the component with fake strategy data, render at common widths, and assert no line exceeds width.
4. **Optional live smoke tests** guarded by explicit environment variables. These must be read-only and skipped by default.

### 17.1 Unit tests

Suggested tests:

```text
extensions/sf-data-explorer/tests/command.test.ts
extensions/sf-data-explorer/tests/soql-builder.test.ts
extensions/sf-data-explorer/tests/soql-validator.test.ts
extensions/sf-data-explorer/tests/sosl-builder.test.ts
extensions/sf-data-explorer/tests/sosl-validator.test.ts
extensions/sf-data-explorer/tests/data360-sql-builder.test.ts
extensions/sf-data-explorer/tests/result-normalize.test.ts
extensions/sf-data-explorer/tests/csv-export.test.ts
extensions/sf-data-explorer/tests/cache.test.ts
extensions/sf-data-explorer/tests/transport-path.test.ts
```

Coverage examples:

- `parseCommandArgs("soql wh refresh")` -> `{ mode: "soql", org: "wh", forceRefresh: true }`.
- SOQL builder includes selected fields, object, where, and limit.
- Manual query validator accepts `SELECT Id FROM Account LIMIT 1`.
- Manual query validator rejects `DELETE FROM Account`.
- SOSL validator accepts `FIND {acme} RETURNING Account(Id, Name) LIMIT 5`.
- SOSL validator rejects `SELECT Id FROM Account`.
- Data 360 SQL validator accepts `SELECT * FROM ssot__Individual__dlm LIMIT 5`.
- CSV export escapes commas, quotes, and newlines.
- Normalizer strips `attributes` but preserves raw row detail.

### 17.2 Mocked transport tests

Mock `SfDataExplorerTransport` and verify:

- SOQL catalog calls `/sobjects`.
- SOQL describe calls `/sobjects/Account/describe`.
- SOQL query calls `/query?q=...`.
- SOSL query calls `/search?q=...`.
- Data 360 SQL catalog calls `/ssot/metadata-entities`, selected-object detail calls `/ssot/metadata?entityName=...`, and execution calls `/ssot/query-sql` with `{ sql }`.

### 17.3 Live smoke tests

Live tests must be opt-in and read-only, for example:

```bash
SF_DATA_EXPLORER_LIVE_ORG=wh npm run test -- extensions/sf-data-explorer/tests/live-smoke.test.ts
```

Live smoke should:

- Resolve target org.
- Load `/sobjects`.
- Describe `Account` only if queryable.
- Run `SELECT Id FROM Account LIMIT 1`.
- Run a tiny SOSL only if a safe search term is configured.
- Run Data 360 SQL only if Data 360 readiness is detected.

No live smoke test should mutate data.

## 18. Documentation

Add `extensions/sf-data-explorer/README.md` with:

- installation / enablement through `sf-pi`
- command examples
- keyboard shortcuts
- safety model
- export behavior
- troubleshooting

Add `/sf-data-explorer help` output with concise usage:

```text
SF Data Explorer

Usage:
  /sf-data-explorer soql [target-org] [refresh]
  /sf-data-explorer sosl [target-org] [refresh]
  /sf-data-explorer sql  [target-org] [refresh]
  /sf-data-explorer soql [object-api-name] [target-org] [refresh]
  /sf-data-explorer sosl [object-api-name] [target-org] [refresh]
  /sf-data-explorer sql  [table-api-name]  [target-org] [refresh]

Examples:
  /sf-data-explorer soql wh
  /sf-data-explorer sosl wh
  /sf-data-explorer sql wh refresh
  /sf-data-explorer soql Account wh
  /sf-data-explorer sosl Contact wh
  /sf-data-explorer sql ssot__Individual__dlm wh

Read-only: v1 only issues describe, query, search, and Data 360 SELECT SQL calls.
```

## 19. Open design choices for implementation

These are intentionally not blockers for the spec:

1. Whether to provide compatibility aliases for the old `pi-data360-browser` commands.
2. Whether export writes should be session-audited in v1 or v2.
3. Whether no-`LIMIT` queries are blocked, confirmed, or auto-limited in v1.
4. Whether multi-object SOSL returning clauses are added to the TUI; current v1 starts with one selected object and an editable raw query for advanced cases.
5. Whether the future `sf-pi` transport API is built before or after first release.

Recommended defaults:

- No compatibility aliases in first `sf-pi` merge.
- Export audit can wait until v2.
- No-`LIMIT` queries should prompt in interactive UI; in headless, block unless a config allows it.
- SOSL v1 starts simple with one selected object; model state and raw editing leave room for multiple returning objects later.
- Dynamic imports now; common sf-pi transport API later.

## 20. Current implementation status

The current package scaffold implements the v1 deterministic explorer flows described above:

- Package manifest, extension manifest, extension README, extension AGENTS.md, TypeScript config, and Pi extension entry point. Source and tests live under `extensions/sf-data-explorer/{lib,tests}` to match sf-pi extension layout.
- Unified `/sf-data-explorer` command with mode picker and direct modes `soql`, `sosl`, and `sql`.
- Deep links of the form `/sf-data-explorer soql Account wh`, `/sf-data-explorer sosl Contact wh`, and `/sf-data-explorer sql ssot__Individual__dlm wh`.
- Lazy dynamic-import transport over sf-pi internals, using `@salesforce/core` connection plumbing and sf-pi target-org/API-version resolution.
- Generic three-pane explorer component with object list, field picker, editable query/result pane, table view, detail view, refresh, focus layout, shortcut help (`?`), explorer switcher (`t`), and JSON/CSV export. Primary keybindings are lowercase (`w` where/search term, `l` limit, `s` save); uppercase `L`/`S` remain accepted as compatibility aliases. Save uses an in-TUI menu and keeps the explorer open after writing a file so users can save another format or go back. Copy actions close the explorer before setting Pi editor text so the global editor update is visible in clients that do not update the editor under a mounted custom TUI.
- In-place query editor inside the custom TUI. This intentionally avoids `ctx.ui.editor()` while the explorer is mounted, because the global Pi editor can steal focus and not restore the custom UI. Arrow navigation includes left/right and up/down across query lines.
- SOQL mode over queryable core sObjects, including object deep-linking, describe-based field loading, editable SELECT-only SOQL, `/query` execution, and stable API-name-first object list display.
- SOSL mode over searchable/queryable core sObjects, including editable FIND-only SOSL and REST `/search` response-envelope normalization. Generated SOSL uses a global `LIMIT` outside the `RETURNING Object(...)` parentheses.
- Data 360 SQL mode over DMO/DLO objects. Catalog loading uses `/ssot/metadata-entities`; selected-object field loading uses `/ssot/metadata?entityName=...`; SQL execution uses `/ssot/query-sql` only for the user's visible SQL query. Field extraction supports the live `/ssot/metadata` envelope shape `metadata[0].fields[]` as well as other known wrapped shapes, maps `displayName` and `businessType`, and surfaces `/ssot/metadata` error bodies instead of silently showing an empty field list.
- In-memory cache with 15-minute TTL. The cache is process-local, not persisted to disk, and is cleared on session start/shutdown or forced refresh.
- Automated tests for command parsing, query builders, read-only validators, result normalization, export helpers, mocked transport endpoint usage, and Data 360 `/ssot/metadata` field extraction/error handling.
- `SF_PI_MERGE_CHECKLIST.md` records merge-time checks and remaining sf-pi integration steps, including standard `/sf-*` command panel requirements.

Current validation command:

```bash
cd sf-dataExplorer
npm run typecheck
npm test
```

Current validation status at the time this section was updated:

```text
typecheck: passed
tests: 7 files passed, 26 tests passed
```

## 21. Success criteria

The implementation is successful when:

- `/sf-data-explorer soql wh` opens a deterministic TUI and can run a basic editable SOQL query.
- `/sf-data-explorer sosl wh` opens a deterministic TUI and can run a basic editable SOSL search.
- `/sf-data-explorer sql wh` preserves the current `/d360-query-explorer` ethos and adds editable SQL.
- All backend calls go through sf-pi `@salesforce/core` connection plumbing, not hand-written curl or raw token handling.
- The extension is read-only by construction in v1.
- Result rows can be browsed, opened in detail, copied, and saved as JSON/CSV.
- No LLM is required for normal browse/build/run/export workflows.
