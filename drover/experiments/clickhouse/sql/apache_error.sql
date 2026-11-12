-- Port of parsers/apache_error.py + aggregate.aggregate() for apache-error.
-- Param: {glob:String} daily files. One row per fingerprint.
WITH parsed AS (
  SELECT _file AS file, _row_number AS rn, line,
         extractGroups(line, '^\\[([^\\]]+)\\]\\s+\\[([^\\]]+)\\]((?:\\s+\\[[^\\]]*\\])*)\\s*(.*)$') AS g,
         notEmpty(g) AS ok,
         position(g[2], ':') > 0 AS has_mod,
         if(ok AND has_mod, drover_strip(substring(g[2], 1, position(g[2], ':') - 1)), NULL) AS module,
         if(ok, drover_strip(if(has_mod, substring(g[2], position(g[2], ':') + 1), g[2])), '') AS level,
         if(ok, drover_severity(level), 'unknown') AS severity,
         if(ok, drover_strip(g[4]), line) AS message,
         -- ch_aggregate resolves 'apache|<timestamp>' with drover's own parse_apache_ts().
         if(ok, concat('apache|', g[1]), 'unknown') AS day_key,
         -- fingerprint_structured('apache', ...) strips these before normalize().
         replaceRegexpAll(replaceRegexpAll(replaceRegexpAll(replaceRegexpAll(message,
             '\\[client [^\\]]+\\]', ''), '\\bclient: \\S+', ''), '(?i)\\bpid \\d+\\b', ''), '\\bAH\\d+:\\s*', '') AS stripped
  -- Python reads text mode (universal newlines), so CRLF arrives as LF.
  -- Python decodes with errors='replace': invalid UTF-8 becomes U+FFFD (see README).
  FROM (SELECT _file, _row_number, toValidUTF8(replaceRegexpOne(line, '\\r$', '')) AS line
        FROM file({glob:String}, 'LineAsString', 'line String'))
  WHERE match(line, '\\S')
)
-- Two-level grouping: per (file, fingerprint, timestamp, severity, module) first, then per fingerprint.
, fine AS (
  SELECT file, drover_fp(concat('apache:', severity, ':', drover_normalize(stripped))) AS fingerprint,
         day_key, severity, module, count() AS n,
         min((file, rn)) AS first_key,
         argMin(substringUTF8(message, 1, 240), (file, rn)) AS first_summary,
         groupArraySorted(3)((file, rn, line)) AS first_samples
  FROM parsed
  GROUP BY file, fingerprint, day_key, severity, module
)
SELECT fingerprint,
       sum(n) AS count,
       argMin(first_summary, first_key) AS summary,
       arrayMap(x -> x.3, arraySlice(arraySort(arrayFlatten(groupArray(first_samples))), 1, 3)) AS samples,
       groupArray((day_key, severity, module, n, first_key)) AS buckets
FROM fine
GROUP BY fingerprint
FORMAT JSONEachRow
