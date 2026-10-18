# Phase 1 フォローアップ（最終レビューで後回し可と判定された項目）

最終レビュー（2026-10-18）で OK-TO-DEFER と判定された軽微な指摘。PRIORITY 項目はすべて修正済み。

- Task 1: minor (deferred): cityFromAddress uses includes() after 東京都; startsWith would avoid 23-ward false matches
- Task 1: minor (deferred): npm audit warnings untriaged
- Task 2: minor (deferred): createDb hides postgres client; no close() for Lambda/CLI shutdown (relevant to T11 CLI)
- Task 2: minor (deferred): raw_items.status no CHECK constraint
- Task 2: minor (deferred): unique-violation test asserts bare toThrow
- Task 3: minor (deferred): ingest single insert hits 65k bind param limit at ~7,300 rows; chunk
- Task 3: minor (deferred): log.ts data spread can overwrite level/msg; Error serializes to {}
- Task 3: minor (deferred): registry test order-dependent; unknown SOURCES_DISABLED ids silently ignored
- Task 4: minor (deferred): no lock; concurrent resolves could race (pipeline process step is sequential)
- Task 4: minor (deferred): no RED run (process gap); null-city edge cases untested
- Task 5: minor (deferred): parseClassification untested; lenient reason/signals defaults
- Task 6: minor (deferred): no test for default depth limit 3; seeded/unseeded concurrent insert race may mark a new store non-candidate; permanently failing placeId consumes details slot each run
- Task 6: minor (deferred): DB update failure in details loop still aborts collect
- Task 7: minor (deferred): tokenRefresh maps only 401 (not code 190) to ThreadsAuthError; posts w/o id/permalink not skipped
- Task 8: minor (deferred): short-name containment false listed; only first result page; limit test uses 100 only
- Task 9: minor (deferred): persistent resolve failure retried every run without cap; resolve+status not in one txn (resolveStore idempotent per rawItemId)
- Task 10: minor (deferred): UI_URL not validated; env checked after buildContext; no map-confidence test case
- Task 11: minor (deferred): tz-less first_seen parsed in local time; no CRLF/dup test
- Task 12: minor (deferred): settings perDay derivation roundabout (0 when perDay 0); callback double-invoke in dev strict mode; no settings/auth component tests
