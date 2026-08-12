# transaction-abort-discards-everything

## Infolog
info: 4 furniture items survived the abort

## SQL trace
[savepoint rows=0 tts=1] SAVEPOINT tts_1
[delete rows=4 tts=1] DELETE FROM InventTable WHERE (ItemGroupId = ?) AND DATAAREAID = ?  -- ["FURNITURE","HVND"]
[rollback rows=0 tts=0] ROLLBACK TO SAVEPOINT tts_1
[select rows=4 tts=0] SELECT t0.ItemId, t0.ItemName, t0.ItemGroupId, t0.ItemType, t0.Blocked, t0.StandardCost, t0.DefaultDimension, t0.RECID, t0.DATAAREAID FROM InventTable AS t0 WHERE (t0.ItemGroupId = ?) AND t0.DATAAREAID = ?  -- ["FURNITURE","HVND"]

## Errors
(none)

## Database
(no row-count change)
statements executed: 19
uncommitted transaction depth: 0
