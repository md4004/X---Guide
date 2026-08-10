# set-based-delete-from

## Infolog
info: 0 components remain

## SQL trace
[savepoint rows=0 tts=1] SAVEPOINT tts_1
[delete rows=1 tts=1] DELETE FROM InventTable WHERE (ItemGroupId = ?) AND DATAAREAID = ?  -- ["COMPONENT","HVND"]
[release rows=0 tts=0] RELEASE SAVEPOINT tts_1
[select rows=0 tts=0] SELECT t0.ItemId, t0.ItemName, t0.ItemGroupId, t0.ItemType, t0.Blocked, t0.StandardCost, t0.RECID, t0.DATAAREAID FROM InventTable AS t0 WHERE (t0.ItemGroupId = ?) AND t0.DATAAREAID = ?  -- ["COMPONENT","HVND"]

## Errors
(none)

## Database
InventTable: -1 rows
statements executed: 7
uncommitted transaction depth: 0
