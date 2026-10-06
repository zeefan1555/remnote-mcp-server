# Read Receipts: Context and Scoped Verification

Version 0.24.0 adds `remnote-cli context --request <path|->` (`remnote_inspect_many` / `inspect_many`) and
`remnote-cli verify scope --expect <path|->` (`remnote_verify_scope` / `verify_scope`). Input is UTF-8 JSON from a file or
stdin, limited to 100 KiB. These commands never mutate RemNote, look up dates, create daily documents, or cache KB data.

## Inspection request

```json
{"schemaVersion":1,"remIds":["selected-rem"],"subtreeRootIds":["required-root"],"tagRemIds":["tag-rem"],"maxRems":1000,"ancestorDepth":20}
```

- `schemaVersion` must be `1`; unknown fields are rejected
- IDs are exact, nonblank strings of at most 256 characters
- `remIds`: optional, at most 100; `subtreeRootIds` and `tagRemIds`: optional, at most 10 each
- At least one ID across the selectors is required
- `maxRems`: integer 1–1000, default 1000; `ancestorDepth`: integer 0–20, default 20
- Subtree scopes include their root and follow actual entity children, not reference/portal edges
- Tag selectors inspect the tag and collect independent inverse membership as `taggedRemIds`

```bash
remnote-cli context --request /tmp/context.json
```

## Receipt and privacy

A receipt contains `schemaVersion:1`, `requestId`, `readWindow:{startedAt,finishedAt}`, `complete`,
`truncation:null|{reason,remainingRemIds}`, `objects`, `scopes:[{rootRemId,remIds,complete}]`, `checks`, and
`errors:[{remId?,code,message}]`. Inspection `checks` is empty. Read windows are **non-atomic live observations**;
request-scoped deduplication does not provide transaction isolation or cross-request content reuse.

Every object contains `remId`, `contentIncluded`, `textHash` (SHA-256 of JSON-serialized raw text), `childrenRemIds`,
`ancestorRemIds`, `remType`, `isFolder`, `isDocument`, `isCardItem`, `hasCardStructure`, `tags`, `references`,
`powerups:{cc,u}`, and native `cards`. `parentRemId`, `updatedAt` (number), and `taggedRemIds` are optional.
Cards contain `cardId`, `remId`, native `type`, `createdAt`, `repetitionHistory`, and optional `lastRepetitionTime`,
`nextRepetitionTime`, `timesWrongInRow`.

Only IDs explicitly listed in `remIds` have `contentIncluded:true` and include `title`, raw `text`, `aliases`, and
optional raw `backText`. Subtree-only and tag-only objects have `contentIncluded:false` and omit all four content
fields. Gather broad metadata first, then request raw text for the exact IDs necessary for semantic review. Never
persist KB titles, text, aliases, or native review-history bodies as workflow evidence; retain IDs, counts, checks,
and hashes instead.

## Fresh scoped verification

```json
{"schemaVersion":1,"inspect":{"schemaVersion":1,"remIds":["item"],"subtreeRootIds":["required-root"],"tagRemIds":["tag"]},"expectations":[{"kind":"parent","remId":"item","value":"required-root"},{"kind":"tag","remId":"item","value":"tag"},{"kind":"zeroCards","remId":"required-root"}]}
```

`expectations` must contain 1–200 entries. Each has `kind` and `remId`. ID-array values permit at most 1000 entries.
All supported kinds and fields:

- `parent`: `value` exact parent ID
- `remType`: `value` one of `folder`, `document`, `dailyDocument`, `concept`, `descriptor`, `portal`, `text`
- `tag`: `value` tag ID; `present` and `inverse` default `true`; inverse proof requires that tag in `inspect.tagRemIds`
- `powerup`: `code` is `cc` or `u`; `value` is boolean
- `references`: `value` ID array; `exact:true` (default) is set equality; `false` requires a subset
- `children`: `value` ID array; `exact:true` (default) is ordered equality; `false` requires an ordered subsequence
- `ancestor`: `value` exact ancestor ID
- `cardRemIds`: `value` set of card-generating Rem IDs, not native card IDs
- `zeroCards`: `noCardStructure:true` (default) also rejects residual card structure

`cardRemIds` and `zeroCards` require explicit `inspect.subtreeRootIds` coverage of their root; selecting only `remIds`
is insufficient. Missing/inaccessible data, truncation, read failures, or missing required inverse/scope evidence
cannot pass. Verification reads fresh evidence rather than accepting an old receipt. It adds overall
`status:passed|failed|incomplete` and checks `{kind,remId,status,expected?,actual?,message?}`.

Both CLI modes preserve the full receipt. Context exits nonzero if incomplete or errors exist. Verification exits zero
only with complete evidence, no errors, and `status:passed`. Keep required whole-WIKI/full-card scopes intact when
retrying; never narrow them merely to obtain a pass. Narrow only optional discovery, otherwise report blocked or
incomplete. The bridge deadline is 60 seconds; the CLI transport timeout is 65 seconds. There is no timeout input.

## SDK metadata cache

SDK commands first request `remnote_get_sdk_capabilities({"identityOnly":true})`. The server answers from a currently
accepted live bridge hello without a WebSocket catalog round trip. It requires connected bridge metadata and returns
SDK version/hash, exact server/bridge versions, `identityOnly:true`, and an empty `capabilities` array.

Only capability metadata is cached, keyed by normalized endpoint plus exact CLI/server/bridge/SDK/hash identity.
The stored key is a digest, so endpoint credentials/query secrets are not saved. Full catalogs are fetched only on
miss. Format 2 validates both the stored payload digest and the official
`SHA256(JSON.stringify({sdkVersion,capabilities}))`, preserving generated property insertion order. Schema-valid
mapping corruption is discarded/refetched; an invalid fetched digest fails closed. Missing live identity never uses
an offline fallback. Every invocation passes `expectedCatalogHash`, checked by the bridge before execution.

Cache files default to `$XDG_CACHE_HOME/remnote-cli`, or `~/.cache/remnote-cli`; `REMNOTE_CLI_CACHE_DIR` overrides the
location. Cache I/O failure still permits freshly verified metadata. No permissions, connectivity, content, context
receipts, SDK return values, or verification results are cached.
