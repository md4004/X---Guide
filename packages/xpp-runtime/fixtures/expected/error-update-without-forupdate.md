# error-update-without-forupdate

## Infolog
(empty)

## SQL trace
[savepoint rows=0 tts=1] SAVEPOINT tts_1
[select rows=1 tts=1] SELECT t0.ItemId, t0.ItemName, t0.ItemGroupId, t0.ItemType, t0.Blocked, t0.StandardCost, t0.RECID, t0.DATAAREAID FROM InventTable AS t0 WHERE (t0.ItemId = ?) AND t0.DATAAREAID = ? LIMIT 1  -- ["F-100","HVND"]
[rollback rows=0 tts=0] ROLLBACK TO SAVEPOINT tts_1

## Errors
XR101 line 6: The InventTable record cannot be updated because it was not selected for update.
  hint: Add `forupdate` to the select that read this buffer. A buffer read without it is read-only.

## Database
(no row-count change)
statements executed: 5
uncommitted transaction depth: 0
