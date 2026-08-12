# select-inner-join

## Infolog
info: SO-0001 / F-100
info: SO-0001 / C-300
info: SO-0002 / F-101
info: SO-0002 / F-100
info: SO-0003 / F-103
info: SO-0003 / S-900

## SQL trace
[select rows=6 tts=0] SELECT t0.SalesId, t0.SalesName, t0.CustAccount, t0.SalesStatus, t0.DeliveryDate, t0.CurrencyCode, t0.DefaultDimension, t0.RECID, t0.DATAAREAID, t1.SalesId, t1.LineNum, t1.ItemId, t1.SalesQty, t1.SalesPrice, t1.LineAmount, t1.InventLocationId, t1.DefaultDimension, t1.RECID, t1.DATAAREAID FROM SalesTable AS t0 INNER JOIN SalesLine AS t1 ON (t1.SalesId = t0.SalesId) AND t1.DATAAREAID = ? WHERE t0.DATAAREAID = ?  -- ["HVND","HVND"]

## Errors
(none)

## Database
(no row-count change)
statements executed: 21
uncommitted transaction depth: 0
