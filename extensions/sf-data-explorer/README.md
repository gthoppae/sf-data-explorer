# SF Data Explorer

Read-only interactive Salesforce data explorer for Pi and SF Pi.

## Command

```text
/sf-data-explorer
/sf-data-explorer soql wh
/sf-data-explorer sosl wh
/sf-data-explorer sql wh
/sf-data-explorer soql Account wh
/sf-data-explorer sosl Contact wh
/sf-data-explorer sql ssot__Individual__dlm wh
```

## Runtime flow

- The extension registers `/sf-data-explorer` at startup and does not perform live org calls on the boot path.
- On explicit command invocation, it lazy-loads sf-pi Salesforce connection internals and resolves the target org/API version.
- The TUI opens a deterministic three-pane explorer: objects, fields, query/result.
- SOQL and Data 360 SQL validators require `SELECT`; SOSL validator requires `FIND`.
- Results can be browsed in-table, opened in detail, copied, or saved as JSON/CSV.

## Files

The package is laid out to match `salesforce/sf-pi` extension conventions:

```text
extensions/sf-data-explorer/index.ts
extensions/sf-data-explorer/manifest.json
extensions/sf-data-explorer/README.md
extensions/sf-data-explorer/AGENTS.md
extensions/sf-data-explorer/lib/**
extensions/sf-data-explorer/tests/**
```

During sf-pi merge, add `./extensions/sf-data-explorer/index.ts` to the root `package.json` `pi.extensions` list and run the catalog/doc generation scripts.

## Safety

V1 is read-only by construction:

- Core Salesforce calls: `/sobjects`, `/sobjects/{name}/describe`, `/query`, `/search`.
- Data 360 calls: `/ssot/metadata-entities`, `/ssot/metadata`, `/ssot/query-sql` with SELECT SQL.
- No DML, Apex execution, Metadata API writes, or Data 360 mutation endpoints.

## Shortcuts

Press `?` in the TUI for the complete shortcut list. Primary bindings are lowercase:

```text
t switch explorer
w WHERE/search term
l LIMIT
e edit query
r run
c copy
s save
f refresh
q close
```
