-- Where server time goes: busy routes (1,000+ hits) ranked by total response time, with p95.
SELECT extract(_path, '/Sites/([^/]+)/') AS project,
       replaceRegexpAll(replaceRegexpAll(cutQueryString(extract(line, '"[A-Z]+ ([^ ]+) HTTP')), '/\\d+(/|$)', '/N\\1'), '/\\d+(/|$)', '/N\\1') AS route,
       count() AS hits,
       round(quantileTDigest(0.95)(toUInt64OrZero(extract(line, 'request_time=(\\d+)')) / 1000)) AS p95_ms,
       round(sum(toUInt64OrZero(extract(line, 'request_time=(\\d+)'))) / 3.6e9, 1) AS server_hours
FROM file({root:String} || '/*/20*/*/*.prod.apache-access.log.gz', 'LineAsString', 'line String')
GROUP BY project, route
HAVING hits >= 1000
ORDER BY server_hours DESC
LIMIT 15
FORMAT JSONEachRow
