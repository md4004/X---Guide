# transaction-update-forupdate

## Infolog
info: updated

## SQL trace
[savepoint rows=0 tts=1] SAVEPOINT tts_1
[select rows=1 tts=1] SELECT t0.ItemId, t0.ItemName, t0.ItemGroupId, t0.ItemType, t0.Blocked, t0.StandardCost, t0.RECID, t0.DATAAREAID FROM InventTable AS t0 WHERE (t0.ItemId = ?) AND t0.DATAAREAID = ? LIMIT 1  -- ["F-100","HVND"]
[update rows=1 tts=1] UPDATE InventTable SET ItemId = ?, ItemName = ?, ItemGroupId = ?, ItemType = ?, Blocked = ?, StandardCost = ? WHERE RECID = ?  -- ["F-100","Renamed desk","FURNITURE",0,0,184.5,1]
[release rows=0 tts=0] RELEASE SAVEPOINT tts_1

## Errors
(none)

## Database
(no row-count change)
statements executed: 7
uncommitted transaction depth: 0
