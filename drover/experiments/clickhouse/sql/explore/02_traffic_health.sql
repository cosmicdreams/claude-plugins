-- Monthly request volume, error rates and response time per site (Apache access logs).
SELECT extract(_path, '/Sites/([^/]+)/') AS project,
       substring(_file, 1, 7) AS month,
       count() AS requests,
       round(100 * countIf(status >= 500) / count(), 3) AS pct_5xx,
       round(100 * countIf(status = 404) / count(), 2) AS pct_404,
       round(quantileTDigest(0.5)(ms)) AS p50_ms,
       round(quantileTDigest(0.95)(ms)) AS p95_ms
FROM (
  SELECT _path, _file,
         toUInt16OrZero(extract(line, '" (\\d{3}) ')) AS status,
         toUInt64OrZero(extract(line, 'request_time=(\\d+)')) / 1000 AS ms
  FROM file({root:String} || '/*/20*/*/*.prod.apache-access.log.gz', 'LineAsString', 'line String')
)
GROUP BY project, month
ORDER BY project, month
FORMAT JSONEachRow
