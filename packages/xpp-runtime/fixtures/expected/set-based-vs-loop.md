# set-based-vs-loop

## Infolog
info: blocked the furniture group, one row at a time

## SQL trace
[savepoint rows=0 tts=1] SAVEPOINT tts_1
[select rows=4 tts=1] SELECT t0.ItemId, t0.ItemName, t0.ItemGroupId, t0.ItemType, t0.Blocked, t0.StandardCost, t0.DefaultDimension, t0.RECID, t0.DATAAREAID FROM InventTable AS t0 WHERE (t0.ItemGroupId = ?) AND t0.DATAAREAID = ?  -- ["FURNITURE","HVND"]
[update rows=1 tts=1] UPDATE InventTable SET ItemId = ?, ItemName = ?, ItemGroupId = ?, ItemType = ?, Blocked = ?, StandardCost = ?, DefaultDimension = ? WHERE RECID = ?  -- ["F-100","Ashwood desk 1400","FURNITURE",0,1,184.5,6302,1]
[update rows=1 tts=1] UPDATE InventTable SET ItemId = ?, ItemName = ?, ItemGroupId = ?, ItemType = ?, Blocked = ?, StandardCost = ?, DefaultDimension = ? WHERE RECID = ?  -- ["F-101","Ashwood desk 1600","FURNITURE",0,1,212,0,2]
[update rows=1 tts=1] UPDATE InventTable SET ItemId = ?, ItemName = ?, ItemGroupId = ?, ItemType = ?, Blocked = ?, StandardCost = ?, DefaultDimension = ? WHERE RECID = ?  -- ["F-102","Pedestal drawer unit","FURNITURE",0,1,96.75,0,3]
[update rows=1 tts=1] UPDATE InventTable SET ItemId = ?, ItemName = ?, ItemGroupId = ?, ItemType = ?, Blocked = ?, StandardCost = ?, DefaultDimension = ? WHERE RECID = ?  -- ["F-103","Meeting table 2400","FURNITURE",0,1,341,0,4]
[release rows=0 tts=0] RELEASE SAVEPOINT tts_1

## Errors
(none)

## Database
(no row-count change)
statements executed: 21
uncommitted transaction depth: 0
